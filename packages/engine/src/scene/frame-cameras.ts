// The cameras of the frames on screen, for `camera.screenToRay` and `camera.worldToScreen`. In
// pipelined mode the thread that draws shows an older frame than the one the sketch computes, so a
// click tested against the current camera would test a view the user never saw. After each frame
// records, the sketch thread keeps the camera it drew from in a ring of the last four frames: its
// world matrix with a 64-bit translation, its lens as the frame's canvas shaped it, the canvas's size
// in CSS pixels and the layers it draws. A ray from the point of an input event then uses the frame
// that the event names, and any other point uses the camera as it stands. Pointer events on objects
// name the frame of each event. Everything lives in typed arrays made once, so neither call nor the
// per-frame record allocates.

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
	/** The layers of the objects the camera draws. */
	readonly layers: number;
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
/** The distance along the view to the near plane. */
export const LENS_NEAR = 5;
export const LENS_FLOATS = 6;

/** The frames whose cameras the ring keeps. */
const RING_FRAMES = 4;
/**
 * Each entry's fields: the frame, the camera's layers, the lens, the canvas's sizes, then the
 * camera's world matrix.
 */
const FRAME = 0;
const LAYERS = 1;
const LENS = 2;
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
	/** The point of a `screenToRay` call, which the ray's math reads from an array. */
	private readonly point = new Float64Array(2);

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
		const at = this.entryOf(this.events.frameAt(x, y), camera);
		const { point } = this;
		point[0] = x;
		point[1] = y;
		if (at >= 0) writeRay(this.ring, at, point, out);
		else writeRay(this.stand(camera, call), 0, point, out);
	}

	/**
	 * Writes the ray through the point (`point[0]`, `point[1]`) in CSS pixels from the camera that
	 * frame `frame` drew from into `out`, and returns that camera's layers. A frame that the ring no
	 * longer holds takes `fallback` as it stands. Returns -1 and writes nothing when neither gives a
	 * camera. The point comes in an array, so the call takes no fraction as an argument.
	 */
	frameRay(frame: number, point: Float64Array, out: Ray, fallback: FrameLens | undefined): number {
		let entry: Float64Array = this.ring;
		let at = this.entryOf(frame, undefined);
		if (at < 0) {
			if (fallback === undefined || this.core.readWorldMatrix(fallback.handle, this.matrix) !== 0)
				return -1;
			entry = this.standing(fallback);
			at = 0;
		}
		writeRay(entry, at, point, out);
		return (entry[at + LAYERS] as number) >>> 0;
	}

	/**
	 * Where the ring's entry of frame `frame` starts, when the ring holds the frame and it drew from
	 * `camera`, or from any camera when `camera` is undefined; otherwise -1.
	 */
	private entryOf(frame: number, camera: FrameLens | undefined): number {
		if (frame <= 0) return -1;
		const index = frame % RING_FRAMES;
		const at = index * ENTRY;
		if (this.ring[at + FRAME] !== frame) return -1;
		return camera === undefined || this.ringCameras[index] === camera ? at : -1;
	}

	/**
	 * Writes where `point` lies on the canvas for `camera` as it stands into `out`: x and y in CSS
	 * pixels from the canvas's top-left corner, then the distance in front of the camera along its
	 * view.
	 */
	worldToScreen(camera: FrameLens, point: Vec3Like, out: Vec3Like, call: string): void {
		const e = this.stand(camera, call);
		const m = MATRIX;
		const a = e[m] as number;
		const b = e[m + 1] as number;
		const c = e[m + 2] as number;
		const d = e[m + 4] as number;
		const f = e[m + 5] as number;
		const g = e[m + 6] as number;
		const h = e[m + 8] as number;
		const i = e[m + 9] as number;
		const j = e[m + 10] as number;
		// The point relative to the camera, subtracted in 64 bits first so it keeps its precision far
		// from the origin, then through the inverse of the matrix's 3 × 3 part.
		const px = (point[0] as number) - (e[m + 3] as number);
		const py = (point[1] as number) - (e[m + 7] as number);
		const pz = (point[2] as number) - (e[m + 11] as number);
		const inv = 1 / (a * (f * j - g * i) - b * (d * j - g * h) + c * (d * i - f * h));
		const lx = ((f * j - g * i) * px + (c * i - b * j) * py + (b * g - c * f) * pz) * inv;
		const ly = ((g * h - d * j) * px + (a * j - c * h) * py + (c * d - a * g) * pz) * inv;
		const lz = ((d * i - f * h) * px + (b * h - a * i) * py + (a * f - b * d) * pz) * inv;
		const sx = scaleX(e, 0);
		const sy = e[LENS + LENS_HALF_HEIGHT] as number;
		let ndcX: number;
		let ndcY: number;
		if (e[LENS + LENS_ORTHO] !== 0) {
			ndcX = (lx - (e[LENS + LENS_CENTER_X] as number)) / sx;
			ndcY = (ly - (e[LENS + LENS_CENTER_Y] as number)) / sy;
		} else {
			ndcX = lx / (-lz * sx);
			ndcY = ly / (-lz * sy);
		}
		out[0] = ((ndcX + 1) / 2) * (e[CSS_WIDTH] as number);
		out[1] = ((1 - ndcY) / 2) * (e[CSS_HEIGHT] as number);
		out[2] = -lz;
	}

	/** Fills the entry of `camera` as it stands, on the canvas as it is now, and returns it. */
	private stand(camera: FrameLens, call: string): Float64Array {
		const { core } = this;
		core.check(core.readWorldMatrix(camera.handle, this.matrix), call, camera.label, true);
		return this.standing(camera);
	}

	/** Fills the entry of `camera` with the matrix read last, on the canvas as it is now. */
	private standing(camera: FrameLens): Float64Array {
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
		entry[at + LAYERS] = camera.layers;
		entry.set(camera.lens, at + LENS);
		entry[at + WIDTH] = width;
		entry[at + HEIGHT] = height;
		entry[at + CSS_WIDTH] = slotFloats[Slot.CanvasCssWidth] as number;
		entry[at + CSS_HEIGHT] = slotFloats[Slot.CanvasCssHeight] as number;
		entry.set(this.matrix, at + MATRIX);
	}
}

/**
 * Half the view's width in the entry at `at`: one unit in front of a perspective camera, or across
 * an orthographic view. A view whose width follows the canvas takes the shape of the canvas in
 * device pixels, as the core builds the frame's projection from it.
 */
function scaleX(e: Float64Array, at: number): number {
	const halfWidth = e[at + LENS + LENS_HALF_WIDTH] as number;
	if (halfWidth > 0) return halfWidth;
	const aspect = (e[at + WIDTH] as number) / (e[at + HEIGHT] as number);
	return (e[at + LENS + LENS_HALF_HEIGHT] as number) * aspect;
}

/**
 * Writes the ray through the point (`point[0]`, `point[1]`) in CSS pixels for the camera of the
 * entry at `at`. The point comes in an array: a call that the browser does not inline makes a
 * number object for each fraction that it passes as an argument. A perspective ray starts at the
 * camera, and an orthographic ray on the near plane, as three.js's `Raycaster.setFromCamera`
 * places them. The matrix carries the ray from the camera's space into
 * the world, so a scaled camera's ray still passes through what the frame drew at the point.
 */
function writeRay(e: Float64Array, at: number, point: Float64Array, out: Ray): void {
	const x = point[0] as number;
	const y = point[1] as number;
	const width = e[at + CSS_WIDTH] as number;
	const height = e[at + CSS_HEIGHT] as number;
	const ndcX = width > 0 ? (x / width) * 2 - 1 : 0;
	const ndcY = height > 0 ? 1 - (y / height) * 2 : 0;
	const lens = at + LENS;
	const sx = ndcX * scaleX(e, at);
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
