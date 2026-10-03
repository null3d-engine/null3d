// The cameras of the frames on screen, for `camera.screenToRay` and `camera.worldToScreen`. In
// pipelined mode the thread that draws shows an older frame than the one the sketch computes, so a
// click tested against the current camera would test a view the user never saw. After each frame
// records, the sketch thread keeps the camera it drew from in a ring of the last four frames: its
// world matrix with a 64-bit translation, its lens as the frame's canvas shaped it, and the canvas's
// size in CSS pixels. A ray from the point of an input event then uses the frame that the event
// names, and any other point uses the camera as it stands. Everything lives in typed arrays made
// once, so neither call nor the per-frame record allocates.

import type { Vec3Like } from '../math/types';
import { type ControlViews, Slot } from '../shared/control';
import type { CoreMemory } from './memory';

/**
 * A ray: a start point and a direction of length 1, in world space.
 *
 * @category api/cameras
 */
export interface Ray {
	/** The point the ray starts from. */
	origin: Vec3Like;
	/** The direction the ray points in, with length 1. */
	direction: Vec3Like;
}

/** Finds the frame that was on screen at the input event at a point, or 0 when no event is there. */
export interface EventFrames {
	frameAt(x: number, y: number): number;
}

/** A camera as the ring keeps it: its handle, its name and its lens. */
export interface FrameLens {
	readonly handle: number;
	/** The camera's name for error messages. */
	readonly label: string;
	/**
	 * The lens, `LENS_FLOATS` numbers at the `LENS_*` offsets, which the camera writes each time the
	 * lens changes. So keeping a frame's camera copies numbers and computes none: a function that
	 * runs once per frame can stay on the browser's slower tiers, where each fraction it computes
	 * makes a new object.
	 */
	readonly lens: Float64Array;
}

/** The lens's numbers. 1 for an orthographic lens, 0 for a perspective one. */
export const LENS_ORTHO = 0;
/**
 * Half the view's height: one unit in front of a perspective camera, or across an orthographic
 * view.
 */
export const LENS_HALF_HEIGHT = 1;
/** Half the width of an orthographic view made from edges, or 0 for a width that follows the canvas. */
export const LENS_HALF_WIDTH = 2;
/** The orthographic view's center, right of and above the camera's axis. */
export const LENS_CENTER_X = 3;
export const LENS_CENTER_Y = 4;
/** The distances along the view to the near and far planes. */
export const LENS_NEAR = 5;
export const LENS_FAR = 6;
export const LENS_FLOATS = 7;

/** The frames whose cameras the ring keeps. */
const RING_FRAMES = 4;
/** Each entry's fields: the frame, the lens, the canvas's sizes, then the camera's world matrix. */
const FRAME = 0;
const LENS = 1;
/** The canvas's size in device pixels, whose shape the frame's projection takes. */
const WIDTH = LENS + LENS_FLOATS;
const HEIGHT = WIDTH + 1;
/** The canvas's size in CSS pixels, which input positions count in. */
const CSS_WIDTH = HEIGHT + 1;
const CSS_HEIGHT = CSS_WIDTH + 1;
/** The camera's world matrix: 12 numbers, row by row, with the translation in 64 bits. */
const MATRIX = CSS_HEIGHT + 1;
const MATRIX_FLOATS = 12;
const ENTRY = MATRIX + MATRIX_FLOATS;

/** The cameras of the last frames, and the math of rays and projections from them. */
export class FrameCameras {
	private readonly ring = new Float64Array(RING_FRAMES * ENTRY);
	/** The camera of each entry of the ring. */
	private readonly ringCameras: (FrameLens | undefined)[] = new Array(RING_FRAMES).fill(undefined);
	/** The entry of the camera as it stands, which each call fills again. */
	private readonly current = new Float64Array(ENTRY);
	private readonly matrix = new Float64Array(MATRIX_FLOATS);
	/** The projection that `worldToScreen` fills again on each call. */
	private readonly view = new Float64Array(VIEW_FLOATS);

	constructor(
		private readonly core: CoreMemory,
		private readonly control: ControlViews,
		private readonly events: EventFrames,
	) {}

	/**
	 * Keeps the camera that frame `frame` drew from, on a canvas of `width` by `height` device
	 * pixels, or forgets the frame when it drew from no camera.
	 */
	record(frame: number, camera: FrameLens | undefined, width: number, height: number): void {
		const index = frame % RING_FRAMES;
		const at = index * ENTRY;
		const ring = this.ring;
		ring[at + FRAME] = 0;
		this.ringCameras[index] = camera;
		if (camera === undefined || this.core.readWorldMatrix(camera.handle, this.matrix) !== 0) return;
		this.fill(ring, at, camera, width, height);
		ring[at + FRAME] = frame;
	}

	/**
	 * Writes the ray from `camera` through the point (`x`, `y`) in CSS pixels into `out`. The frame
	 * that an input event at the point names gives the camera, when the ring still holds it with
	 * this camera; otherwise the camera as it stands gives it, and a camera that is gone throws the
	 * core's error, naming `call`.
	 */
	screenToRay(camera: FrameLens, x: number, y: number, out: Ray, call: string): void {
		const frame = this.events.frameAt(x, y);
		const ring = this.ring;
		const index = frame % RING_FRAMES;
		const at = index * ENTRY;
		if (frame > 0 && ring[at + FRAME] === frame && this.ringCameras[index] === camera)
			writeRay(ring, at, x, y, out);
		else writeRay(this.stand(camera, call), 0, x, y, out);
	}

	/**
	 * Writes where `point` lies on the canvas for `camera` as it stands into `out`: x and y in CSS
	 * pixels from the canvas's top-left corner, then the distance in front of the camera along its
	 * view.
	 */
	worldToScreen(camera: FrameLens, point: Vec3Like, out: Vec3Like, call: string): void {
		const e = this.stand(camera, call);
		const view = this.view;
		writeView(e, 0, view);
		projectPoint(view, point, out);
		out[0] = (((out[0] as number) + 1) / 2) * (e[CSS_WIDTH] as number);
		out[1] = ((1 - (out[1] as number)) / 2) * (e[CSS_HEIGHT] as number);
	}

	/**
	 * Writes the projection of `camera` as it stands, on a canvas of `width` by `height` device
	 * pixels, into `view` (`VIEW_FLOATS` numbers), for `projectPoint`. Returns false, and writes
	 * nothing, when the camera is gone.
	 */
	viewOf(camera: FrameLens, width: number, height: number, view: Float64Array): boolean {
		if (this.core.readWorldMatrix(camera.handle, this.matrix) !== 0) return false;
		this.fill(this.current, 0, camera, width, height);
		writeView(this.current, 0, view);
		return true;
	}

	/** Fills the entry of `camera` as it stands, on the canvas as it is now, and returns it. */
	private stand(camera: FrameLens, call: string): Float64Array {
		const { core } = this;
		core.check(core.readWorldMatrix(camera.handle, this.matrix), call, camera.label, true);
		const { slots } = this.control;
		const width = Math.max(1, Atomics.load(slots, Slot.CanvasWidth));
		const height = Math.max(1, Atomics.load(slots, Slot.CanvasHeight));
		this.fill(this.current, 0, camera, width, height);
		return this.current;
	}

	/**
	 * Writes `camera`'s lens, a canvas of `width` by `height` device pixels, the canvas's CSS size
	 * and the matrix read last at `at`.
	 */
	private fill(
		entry: Float64Array,
		at: number,
		camera: FrameLens,
		width: number,
		height: number,
	): void {
		const { slotFloats } = this.control;
		entry.set(camera.lens, at + LENS);
		entry[at + WIDTH] = width;
		entry[at + HEIGHT] = height;
		entry[at + CSS_WIDTH] = slotFloats[Slot.CanvasCssWidth] as number;
		entry[at + CSS_HEIGHT] = slotFloats[Slot.CanvasCssHeight] as number;
		entry.set(this.matrix, at + MATRIX);
	}
}

/**
 * A camera's projection, made once and used for many points. The first 9 numbers are the inverse
 * of the 3 × 3 part of the camera's world matrix, row by row, then the camera's position. Then come
 * half the view's width and height (one unit in front of a perspective camera, or across an
 * orthographic view), 1 for an orthographic lens or 0, the orthographic view's center, and the
 * distances to the near and far planes.
 */
export const VIEW_FLOATS = 19;
const VIEW_POSITION = 9;
const VIEW_SCALE_X = 12;
const VIEW_SCALE_Y = 13;
const VIEW_ORTHO = 14;
const VIEW_CENTER_X = 15;
const VIEW_CENTER_Y = 16;
/** The distances to the near and far planes in a view that `viewOf` wrote. */
export const VIEW_NEAR = 17;
export const VIEW_FAR = 18;

/** Writes the projection of the camera of the entry at `at` into `view`. */
function writeView(e: Float64Array, at: number, view: Float64Array): void {
	const m = at + MATRIX;
	const a = e[m] as number;
	const b = e[m + 1] as number;
	const c = e[m + 2] as number;
	const d = e[m + 4] as number;
	const f = e[m + 5] as number;
	const g = e[m + 6] as number;
	const h = e[m + 8] as number;
	const i = e[m + 9] as number;
	const j = e[m + 10] as number;
	const inv = 1 / (a * (f * j - g * i) - b * (d * j - g * h) + c * (d * i - f * h));
	view[0] = (f * j - g * i) * inv;
	view[1] = (c * i - b * j) * inv;
	view[2] = (b * g - c * f) * inv;
	view[3] = (g * h - d * j) * inv;
	view[4] = (a * j - c * h) * inv;
	view[5] = (c * d - a * g) * inv;
	view[6] = (d * i - f * h) * inv;
	view[7] = (b * h - a * i) * inv;
	view[8] = (a * f - b * d) * inv;
	view[VIEW_POSITION] = e[m + 3] as number;
	view[VIEW_POSITION + 1] = e[m + 7] as number;
	view[VIEW_POSITION + 2] = e[m + 11] as number;
	const lens = at + LENS;
	writeScaleX(e, at, view, VIEW_SCALE_X);
	view[VIEW_SCALE_Y] = e[lens + LENS_HALF_HEIGHT] as number;
	view[VIEW_ORTHO] = e[lens + LENS_ORTHO] as number;
	view[VIEW_CENTER_X] = e[lens + LENS_CENTER_X] as number;
	view[VIEW_CENTER_Y] = e[lens + LENS_CENTER_Y] as number;
	view[VIEW_NEAR] = e[lens + LENS_NEAR] as number;
	view[VIEW_FAR] = e[lens + LENS_FAR] as number;
}

/**
 * Writes where `point` lies for the camera of `view` into `out`: x and y in normalized device
 * coordinates, from -1 to 1 across the canvas with y up, then the distance in front of the camera
 * along its view. The point is taken relative to the camera in 64 bits first, so it keeps its
 * precision far from the origin.
 */
export function projectPoint(view: Float64Array, point: Vec3Like, out: Vec3Like): void {
	const px = (point[0] as number) - (view[VIEW_POSITION] as number);
	const py = (point[1] as number) - (view[VIEW_POSITION + 1] as number);
	const pz = (point[2] as number) - (view[VIEW_POSITION + 2] as number);
	const lx = (view[0] as number) * px + (view[1] as number) * py + (view[2] as number) * pz;
	const ly = (view[3] as number) * px + (view[4] as number) * py + (view[5] as number) * pz;
	const lz = (view[6] as number) * px + (view[7] as number) * py + (view[8] as number) * pz;
	const sx = view[VIEW_SCALE_X] as number;
	const sy = view[VIEW_SCALE_Y] as number;
	if (view[VIEW_ORTHO] !== 0) {
		out[0] = (lx - (view[VIEW_CENTER_X] as number)) / sx;
		out[1] = (ly - (view[VIEW_CENTER_Y] as number)) / sy;
	} else {
		out[0] = lx / (-lz * sx);
		out[1] = ly / (-lz * sy);
	}
	out[2] = -lz;
}

/**
 * Writes half the view's width in the entry at `at` into `out[index]`: one unit in front of a
 * perspective camera, or across an orthographic view. A view whose width follows the canvas takes
 * the shape of the canvas in device pixels, as the core builds the frame's projection from it. The
 * result goes into an array, not a return value, because the browser makes a new object for each
 * fraction that a function it does not inline returns.
 */
function writeScaleX(e: Float64Array, at: number, out: Float64Array, index: number): void {
	const halfWidth = e[at + LENS + LENS_HALF_WIDTH] as number;
	out[index] =
		halfWidth > 0
			? halfWidth
			: (e[at + LENS + LENS_HALF_HEIGHT] as number) *
				((e[at + WIDTH] as number) / (e[at + HEIGHT] as number));
}

/** The half width that `writeRay` reads, filled again on each call. */
const rayScale = new Float64Array(1);

/**
 * Writes the ray through the point (`x`, `y`) in CSS pixels for the camera of the entry at `at`. A
 * perspective ray starts at the camera, and an orthographic ray on the near plane, as three.js's
 * `Raycaster.setFromCamera` places them. The matrix carries the ray from the camera's space into
 * the world, so a scaled camera's ray still passes through what the frame drew at the point.
 */
function writeRay(e: Float64Array, at: number, x: number, y: number, out: Ray): void {
	const width = e[at + CSS_WIDTH] as number;
	const height = e[at + CSS_HEIGHT] as number;
	const ndcX = width > 0 ? (x / width) * 2 - 1 : 0;
	const ndcY = height > 0 ? 1 - (y / height) * 2 : 0;
	const lens = at + LENS;
	writeScaleX(e, at, rayScale, 0);
	const sx = ndcX * (rayScale[0] as number);
	const sy = ndcY * (e[lens + LENS_HALF_HEIGHT] as number);
	const ortho = e[lens + LENS_ORTHO] !== 0;
	// The point and the direction in the camera's own space, which looks down -Z.
	const ox = ortho ? (e[lens + LENS_CENTER_X] as number) + sx : 0;
	const oy = ortho ? (e[lens + LENS_CENTER_Y] as number) + sy : 0;
	const oz = ortho ? -(e[lens + LENS_NEAR] as number) : 0;
	const dx = ortho ? 0 : sx;
	const dy = ortho ? 0 : sy;
	const m = at + MATRIX;
	const origin = out.origin;
	const direction = out.direction;
	for (let row = 0; row < 3; row++) {
		const r = m + row * 4;
		const a = e[r] as number;
		const b = e[r + 1] as number;
		const c = e[r + 2] as number;
		origin[row] = a * ox + b * oy + c * oz + (e[r + 3] as number);
		direction[row] = a * dx + b * dy - c;
	}
	const dirX = direction[0] as number;
	const dirY = direction[1] as number;
	const dirZ = direction[2] as number;
	const length = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
	direction[0] = dirX / length;
	direction[1] = dirY / length;
	direction[2] = dirZ / length;
}
