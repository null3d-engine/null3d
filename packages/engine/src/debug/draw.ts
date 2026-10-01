// Debug drawing for development builds. Each call adds the lines of its shape to the frame's points
// in engine memory, two points per line, each a 64-bit position and an sRGB color. Before the frame
// records, the runner calls flush, which hands the points to the core. The core draws them over
// the camera's view and forgets them after that frame.
//
// Shapes that follow an object, its axes or a camera's frustum, wait for the flush too. By then the
// frame's transform update has run, so they take the object's place in the frame they draw in and
// never trail it. Each reads the object's transform through the core, as getWorldPosition does.
//
// The arrays grow by doubling, up to a frame's limit, so steady frames make no new arrays.

import * as C from '../generated/core';
import { linearToSrgb } from '../math/color';
import { hexValue, invalidColor } from '../math/hex';
import type { Vec3Like } from '../math/types';
import { type ColorInput, isComponent } from '../scene/color';
import type { CoreMemory } from '../scene/memory';
import {
	type Camera,
	type DirectionalLight,
	Object3D,
	type OrthographicCamera,
	type PerspectiveCamera,
} from '../scene/scene';
import type { Debug, DebugGridOptions, DebugLightOptions } from './debug';

/** The points that the arrays first make room for: 2,048 lines. */
const FIRST_POINTS = 4096;
/** The most points that one frame draws: 131,072 lines. */
export const MAX_POINTS = 1 << 18;
/** The segments of each circle of a sphere. */
const CIRCLE_SEGMENTS = 32;
/** How long an arrow's head is, as a share of the arrow's length. */
const HEAD_LENGTH = 0.2;
/** How far each side of an arrow's head reaches from the shaft, as a share of the head's length. */
const HEAD_RADIUS = 0.3;

/** Packed colors: red in the lowest byte, then green, blue and an opaque alpha. */
const YELLOW = 0xff00ffff;
const ORANGE = 0xff00aaff;
const GRID_GRAY = 0xff888888;
const GRID_CENTER_GRAY = 0xff444444;
/** The colors of the x, y and z axes: red, green and blue. */
const AXIS_COLORS = [0xff0000ff, 0xff00ff00, 0xffff0000] as const;

/** The kinds of shape that follow an object. */
const AXES = 0;
const FRUSTUM = 1;
/** A directional light, drawn where the light is, or at a place that the call gave. */
const LIGHT = 2;
const LIGHT_AT = 3;

/** Cosines and sines around a circle, one pair per segment boundary, the first one repeated last. */
const CIRCLE = new Float64Array(2 * (CIRCLE_SEGMENTS + 1));
for (let s = 0; s <= CIRCLE_SEGMENTS; s++) {
	const angle = (2 * Math.PI * s) / CIRCLE_SEGMENTS;
	CIRCLE[2 * s] = Math.cos(angle);
	CIRCLE[2 * s + 1] = Math.sin(angle);
}

/** One sRGB component from 0 to 1 as a byte. */
const toByte = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);

/** A linear color as a line's packed sRGB color, opaque. */
const packLinear = (r: number, g: number, b: number): number =>
	toByte(linearToSrgb(r)) +
	toByte(linearToSrgb(g)) * 0x100 +
	toByte(linearToSrgb(b)) * 0x10000 +
	0xff000000;

/**
 * A color as the core stores it for a line's point, packed into one number. It throws E1204 for a
 * color that material colors do not take either.
 */
export function packedColor(color: ColorInput, call: string): number {
	if (typeof color === 'string' || typeof color === 'number') {
		const value = hexValue(color);
		if (value < 0) throw invalidColor(color, call);
		return ((value >> 16) & 255) + (value & 0xff00) + (value & 255) * 0x10000 + 0xff000000;
	}
	if (
		color?.length === 3 &&
		isComponent(color[0]) &&
		isComponent(color[1]) &&
		isComponent(color[2])
	)
		return packLinear(color[0], color[1], color[2]);
	throw invalidColor(color, call);
}

export class DebugDraw implements Debug {
	private positions: Float64Array<ArrayBufferLike> = new Float64Array(0);
	private colors: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
	/** The points the arrays have room for. */
	private capacity = 0;
	/** The points written for the next frame. */
	private points = 0;
	/** The memory generation of the arrays' views. */
	private generation = -1;
	private warned = false;
	/** The shapes that follow objects, which the next flush draws. */
	private followedCount = 0;
	private readonly followed: (Object3D | undefined)[] = [];
	private readonly followedKinds: number[] = [];
	/** An axes shape's size, or a frustum's or a light's color. */
	private readonly followedValues: number[] = [];
	/** A light's size, and the place that its call gave: 4 numbers per shape. */
	private readonly followedLights: number[] = [];
	/** An object's world matrix: rows of a 3 x 4 matrix, with the translation in 64 bits. */
	private readonly matrix = new Float64Array(C.CORE_MATRIX_FLOATS);
	/**
	 * Corners in world space: a frustum's near plane's four, then its far plane's, or a light's
	 * square's four.
	 */
	private readonly corners = new Float64Array(24);
	/** Two unit vectors at right angles to a direction and to each other, from `across`. */
	private readonly sides = new Float64Array(6);
	/** The direction a drawn light's light travels. */
	private readonly direction = new Float64Array(3);

	constructor(private readonly core: CoreMemory) {}

	line(from: Vec3Like, to: Vec3Like, color?: ColorInput): void {
		const c = color === undefined ? YELLOW : packedColor(color, 'debug.line');
		if (!this.room(2)) return;
		this.segment(
			from[0] as number,
			from[1] as number,
			from[2] as number,
			to[0] as number,
			to[1] as number,
			to[2] as number,
			c,
		);
	}

	box(min: Vec3Like, max: Vec3Like, color?: ColorInput): void {
		const c = color === undefined ? YELLOW : packedColor(color, 'debug.box');
		if (!this.room(24)) return;
		const x0 = min[0] as number;
		const y0 = min[1] as number;
		const z0 = min[2] as number;
		const x1 = max[0] as number;
		const y1 = max[1] as number;
		const z1 = max[2] as number;
		// Four edges along each axis, one from each corner of the face across from it.
		for (let k = 0; k < 4; k++) {
			const low = (k & 1) === 0;
			const near = (k & 2) === 0;
			this.segment(x0, low ? y0 : y1, near ? z0 : z1, x1, low ? y0 : y1, near ? z0 : z1, c);
			this.segment(low ? x0 : x1, y0, near ? z0 : z1, low ? x0 : x1, y1, near ? z0 : z1, c);
			this.segment(low ? x0 : x1, near ? y0 : y1, z0, low ? x0 : x1, near ? y0 : y1, z1, c);
		}
	}

	sphere(center: Vec3Like, radius: number, color?: ColorInput): void {
		const c = color === undefined ? YELLOW : packedColor(color, 'debug.sphere');
		if (!this.room(6 * CIRCLE_SEGMENTS)) return;
		const x = center[0] as number;
		const y = center[1] as number;
		const z = center[2] as number;
		for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
			const c0 = (CIRCLE[2 * s] as number) * radius;
			const s0 = (CIRCLE[2 * s + 1] as number) * radius;
			const c1 = (CIRCLE[2 * s + 2] as number) * radius;
			const s1 = (CIRCLE[2 * s + 3] as number) * radius;
			this.segment(x + c0, y + s0, z, x + c1, y + s1, z, c);
			this.segment(x + c0, y, z + s0, x + c1, y, z + s1, c);
			this.segment(x, y + c0, z + s0, x, y + c1, z + s1, c);
		}
	}

	arrow(origin: Vec3Like, direction: Vec3Like, length = 1, color?: ColorInput): void {
		const c = color === undefined ? YELLOW : packedColor(color, 'debug.arrow');
		this.arrowFrom(
			origin[0] as number,
			origin[1] as number,
			origin[2] as number,
			direction,
			length,
			c,
		);
	}

	axes(target: Object3D | Vec3Like, size = 1): void {
		if (target instanceof Object3D) {
			this.follow(AXES, target, size);
			return;
		}
		// The world's own axes: a matrix with no rotation, at the position.
		const m = this.matrix;
		m.fill(0);
		m[0] = 1;
		m[5] = 1;
		m[10] = 1;
		m[3] = target[0] as number;
		m[7] = target[1] as number;
		m[11] = target[2] as number;
		this.drawAxes(size);
	}

	grid(size = 10, divisions = 10, options?: DebugGridOptions): void {
		const color = options?.color;
		const centerColor = options?.centerColor;
		const c = color === undefined ? GRID_GRAY : packedColor(color, 'debug.grid');
		const middle =
			centerColor === undefined ? GRID_CENTER_GRAY : packedColor(centerColor, 'debug.grid');
		const cells = Math.floor(divisions);
		if (!(cells >= 1) || !this.room(4 * (cells + 1))) return;
		const center = options?.center;
		const x = center ? (center[0] as number) : 0;
		const y = center ? (center[1] as number) : 0;
		const z = center ? (center[2] as number) : 0;
		const half = size / 2;
		// As three.js's GridHelper: one line along each axis at every step, and the two through the
		// center, where an even number of cells has them, in the center color.
		for (let i = 0; i <= cells; i++) {
			const k = -half + (i * size) / cells;
			const lineColor = 2 * i === cells ? middle : c;
			this.segment(x - half, y, z + k, x + half, y, z + k, lineColor);
			this.segment(x + k, y, z - half, x + k, y, z + half, lineColor);
		}
	}

	frustum(camera: Camera, color?: ColorInput): void {
		const c = color === undefined ? ORANGE : packedColor(color, 'debug.frustum');
		this.follow(FRUSTUM, camera, c);
	}

	light(light: DirectionalLight, options?: DebugLightOptions): void {
		const color = options?.color;
		const c = color === undefined ? lightColor(light) : packedColor(color, 'debug.light');
		const position = options?.position;
		const at = this.followedCount * 4;
		this.follow(position ? LIGHT_AT : LIGHT, light, c);
		const place = this.followedLights;
		place[at] = options?.size ?? 1;
		place[at + 1] = position ? (position[0] as number) : 0;
		place[at + 2] = position ? (position[1] as number) : 0;
		place[at + 3] = position ? (position[2] as number) : 0;
	}

	/**
	 * Draws the shapes that follow objects, from their places in this frame, then hands the frame's
	 * points to the core for the frame that records next. `width` and `height` give the canvas,
	 * whose shape a camera's frustum takes.
	 */
	flush(width: number, height: number): void {
		for (let k = 0; k < this.followedCount; k++) {
			const object = this.followed[k] as Object3D;
			this.followed[k] = undefined;
			// An object destroyed after the call is gone from the core by now.
			if (object.destroyedFrame >= 0) continue;
			if (this.core.glue.worldMatrix(object.handle, this.matrix) !== 0) continue;
			const value = this.followedValues[k] as number;
			const kind = this.followedKinds[k];
			if (kind === FRUSTUM)
				this.drawFrustum(object as PerspectiveCamera | OrthographicCamera, width / height, value);
			else if (kind === AXES) this.drawAxes(value);
			else this.drawLight(k, kind === LIGHT_AT, value);
		}
		this.followedCount = 0;
		if (this.points === 0) return;
		const points = this.points;
		this.points = 0;
		this.core.check(this.core.glue.drawDebugLines(points), 'debug drawing', undefined, true);
	}

	/** Keeps a shape that follows an object for the next flush. */
	private follow(kind: number, object: Object3D, value: number): void {
		const k = this.followedCount++;
		this.followed[k] = object;
		this.followedKinds[k] = kind;
		this.followedValues[k] = value;
	}

	/** Axes along the columns of the world matrix that `matrix` holds, from its translation. */
	private drawAxes(size: number): void {
		if (!this.room(6)) return;
		const m = this.matrix;
		const x = m[3] as number;
		const y = m[7] as number;
		const z = m[11] as number;
		for (let axis = 0; axis < 3; axis++) {
			// A column of the matrix's rotation part, which its scale stretches.
			const ax = m[axis] as number;
			const ay = m[4 + axis] as number;
			const az = m[8 + axis] as number;
			const n = Math.sqrt(ax * ax + ay * ay + az * az);
			const k = n > 0 ? size / n : 0;
			this.segment(x, y, z, x + ax * k, y + ay * k, z + az * k, AXIS_COLORS[axis] as number);
		}
	}

	/**
	 * The frustum of the camera whose world matrix the flush just read: its near and far planes,
	 * in the canvas's shape unless an orthographic view has its own, and the edges between them. A
	 * camera looks down its -z axis.
	 */
	private drawFrustum(
		camera: PerspectiveCamera | OrthographicCamera,
		aspect: number,
		color: number,
	): void {
		if (!this.room(24)) return;
		const m = this.matrix;
		const corners = this.corners;
		// Each plane's half width and half height at a depth: they grow from nothing at the camera
		// for a perspective camera, and stay the same at every depth for an orthographic one, whose
		// box can sit off the camera's axis.
		let centerX = 0;
		let centerY = 0;
		let halfWidth = 0;
		let halfHeight = 0;
		let widthSlope = 0;
		let heightSlope = 0;
		if (camera.isOrthographic) {
			const { view } = camera;
			halfHeight = view.height / 2;
			halfWidth = view.width > 0 ? view.width / 2 : halfHeight * aspect;
			centerX = view.centerX;
			centerY = view.centerY;
		} else {
			heightSlope = Math.tan((camera.fov * Math.PI) / 360);
			widthSlope = heightSlope * aspect;
		}
		for (let k = 0; k < 8; k++) {
			const depth = k < 4 ? camera.near : camera.far;
			const w = halfWidth + depth * widthSlope;
			const h = halfHeight + depth * heightSlope;
			const cx = centerX + ((k & 3) === 0 || (k & 3) === 3 ? -w : w);
			const cy = centerY + ((k & 3) < 2 ? -h : h);
			const cz = -depth;
			for (let row = 0; row < 3; row++) {
				const r = row * 4;
				corners[k * 3 + row] =
					(m[r] as number) * cx +
					(m[r + 1] as number) * cy +
					(m[r + 2] as number) * cz +
					(m[r + 3] as number);
			}
		}
		for (let k = 0; k < 4; k++) {
			const next = (k + 1) & 3;
			this.cornerSegment(k, next, color);
			this.cornerSegment(4 + k, 4 + next, color);
			this.cornerSegment(k, 4 + k, color);
		}
	}

	/** A line between two of the corners that `corners` holds. */
	private cornerSegment(a: number, b: number, color: number): void {
		const p = this.corners;
		this.segment(
			p[a * 3] as number,
			p[a * 3 + 1] as number,
			p[a * 3 + 2] as number,
			p[b * 3] as number,
			p[b * 3 + 1] as number,
			p[b * 3 + 2] as number,
			color,
		);
	}

	/** An arrow from a point in `direction`, `length` meters long, with a head of four lines. */
	/**
	 * Draws the light of followed shape `k` from its world matrix: a square that faces the light,
	 * as three.js's `DirectionalLightHelper` draws one, and an arrow along its -Z axis, the way its
	 * light travels. It stands at the light's place, or at the place its call gave with `given`.
	 */
	private drawLight(k: number, given: boolean, color: number): void {
		const m = this.matrix;
		const place = this.followedLights;
		const size = place[k * 4] as number;
		const x = given ? (place[k * 4 + 1] as number) : (m[3] as number);
		const y = given ? (place[k * 4 + 2] as number) : (m[7] as number);
		const z = given ? (place[k * 4 + 3] as number) : (m[11] as number);
		const d = this.direction;
		d[0] = -(m[2] as number);
		d[1] = -(m[6] as number);
		d[2] = -(m[10] as number);
		const n = Math.sqrt((d[0] as number) ** 2 + (d[1] as number) ** 2 + (d[2] as number) ** 2);
		if (!(n > 0) || !this.room(8)) return;
		const q = this.sides;
		across(q, (d[0] as number) / n, (d[1] as number) / n, (d[2] as number) / n);
		const corners = this.corners;
		const h = size / 2;
		for (let c = 0; c < 4; c++) {
			const a = c === 0 || c === 3 ? -h : h;
			const b = c < 2 ? -h : h;
			for (let axis = 0; axis < 3; axis++) {
				const base = axis === 0 ? x : axis === 1 ? y : z;
				corners[c * 3 + axis] = base + (q[axis] as number) * a + (q[3 + axis] as number) * b;
			}
		}
		for (let c = 0; c < 4; c++) this.cornerSegment(c, (c + 1) & 3, color);
		this.arrowFrom(x, y, z, d, size, color);
	}

	private arrowFrom(
		x: number,
		y: number,
		z: number,
		direction: Vec3Like,
		length: number,
		color: number,
	): void {
		const dx = direction[0] as number;
		const dy = direction[1] as number;
		const dz = direction[2] as number;
		const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (!(n > 0) || !this.room(10)) return;
		const fx = dx / n;
		const fy = dy / n;
		const fz = dz / n;
		const tx = x + fx * length;
		const ty = y + fy * length;
		const tz = z + fz * length;
		this.segment(x, y, z, tx, ty, tz, color);
		const head = length * HEAD_LENGTH;
		const r = head * HEAD_RADIUS;
		const bx = tx - fx * head;
		const by = ty - fy * head;
		const bz = tz - fz * head;
		const q = this.sides;
		across(q, fx, fy, fz);
		// Four lines back from the tip, one to each side of the shaft.
		for (let k = 0; k < 4; k++) {
			const a = k === 0 ? r : k === 1 ? -r : 0;
			const b = k === 2 ? r : k === 3 ? -r : 0;
			this.segment(
				tx,
				ty,
				tz,
				bx + (q[0] as number) * a + (q[3] as number) * b,
				by + (q[1] as number) * a + (q[4] as number) * b,
				bz + (q[2] as number) * a + (q[5] as number) * b,
				color,
			);
		}
	}

	/** Adds a line: two points of one color. */
	private segment(
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		color: number,
	): void {
		const i = this.points;
		const p = this.positions;
		p[i * 3] = ax;
		p[i * 3 + 1] = ay;
		p[i * 3 + 2] = az;
		p[i * 3 + 3] = bx;
		p[i * 3 + 4] = by;
		p[i * 3 + 5] = bz;
		this.colors[i] = color;
		this.colors[i + 1] = color;
		this.points = i + 2;
	}

	/**
	 * Makes room for `count` more points in this frame, and returns false when the frame is full.
	 * It makes the arrays' views again when the engine's memory grew.
	 */
	private room(count: number): boolean {
		const needed = this.points + count;
		if (needed > this.capacity && !this.grow(needed)) return false;
		if (this.generation !== this.core.generation) this.makeViews();
		return true;
	}

	/** Grows the arrays to hold `needed` points, or warns once and returns false past the limit. */
	private grow(needed: number): boolean {
		if (needed > MAX_POINTS) {
			if (!this.warned) {
				this.warned = true;
				const most = (MAX_POINTS / 2).toLocaleString('en-US');
				console.warn(
					`null3D: a frame draws at most ${most} debug lines. This frame left out the lines after the first ${most}.`,
				);
			}
			return false;
		}
		const capacity = Math.min(MAX_POINTS, Math.max(needed, FIRST_POINTS, this.capacity * 2));
		const { core } = this;
		core.checkGrowth(core.glue.reserveDebugLines(capacity), 'debug drawing', undefined, true);
		this.capacity = capacity;
		this.makeViews();
		return true;
	}

	private makeViews(): void {
		const { core } = this;
		const { glue } = core;
		this.positions = core.f64(
			glue.debugLineArrays(C.DEBUG_LINE_FIELD_POSITIONS),
			this.capacity * 3,
		);
		this.colors = core.u32(glue.debugLineArrays(C.DEBUG_LINE_FIELD_COLORS), this.capacity);
		this.generation = core.generation;
	}
}

/**
 * Writes into `out` two unit vectors at right angles to a unit direction and to each other: the
 * first in elements 0 to 2, the second in 3 to 5.
 */
function across(out: Float64Array, fx: number, fy: number, fz: number): void {
	// The first crosses the direction with the world's up axis, or with x for a direction near up.
	const up = Math.abs(fy) < 0.99;
	const ux = up ? -fz : 0;
	const uy = up ? 0 : fz;
	const uz = up ? fx : -fy;
	const n = Math.sqrt(ux * ux + uy * uy + uz * uz);
	out[0] = ux / n;
	out[1] = uy / n;
	out[2] = uz / n;
	out[3] = fy * (out[2] as number) - fz * (out[1] as number);
	out[4] = fz * (out[0] as number) - fx * (out[2] as number);
	out[5] = fx * (out[1] as number) - fy * (out[0] as number);
}

/** A directional light's color as a line's color: its sRGB color before its intensity. */
function lightColor(light: DirectionalLight): number {
	const c = light.linear;
	return packLinear(c[0] as number, c[1] as number, c[2] as number);
}
