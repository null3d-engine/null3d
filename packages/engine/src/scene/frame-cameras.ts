// The cameras of the frames on screen, for `camera.screenToRay` and `camera.worldToScreen`. In
// pipelined mode the thread that draws shows an older frame than the one the sketch computes, so a
// click tested against the current camera would test a view the user never saw. After each frame
// records, the sketch thread keeps the camera it drew from in a ring of the last four views: its
// world matrix with a 64-bit translation, its lens as the frame's canvas shaped it, the canvas's
// size in CSS pixels and the layers it draws. Frames count in the engine's own numbers, so each
// frame of the setup and of the preset check keeps its own view, though no sketch code ran in it.
// Frames that follow each other with the same view share an entry: a camera at rest, as through
// the preset check's many frames, then keeps older views in the ring. A ray from the point of an
// input event uses the frame that the event names, and any other point uses the camera as it
// stands. Pointer events on objects name the frame of each event. Everything lives in typed arrays
// made once, so neither call nor the per-frame record allocates.

import * as C from '../generated/core';
import type { Vec3Like } from '../math/types';
import { type ControlViews, frameAfter, previousFrame, Slot } from '../shared/control';
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

/**
 * Finds the frame that was on screen at the input event at a point, in the engine's count of
 * frames, or -1 when no event is there.
 */
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
/** The distances along the view to the near and far planes. */
export const LENS_NEAR = 5;
export const LENS_FAR = 6;
export const LENS_FLOATS = 7;

/** The views whose cameras the ring keeps. */
const RING_VIEWS = 4;
/** The frames of an entry that holds no frame yet. */
const NO_FRAME = -1;
/**
 * Each entry's fields: the first and the last frame of its view, the camera's layers, the lens,
 * the canvas's sizes, then the camera's world matrix.
 */
const FIRST = 0;
const LAST = 1;
const LAYERS = 2;
const LENS = 3;
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
	private readonly ring = new Float64Array(RING_VIEWS * ENTRY);
	/** The camera of each entry of the ring, or undefined for frames that drew from none. */
	private readonly ringCameras: (FrameLens | undefined)[] = new Array(RING_VIEWS).fill(undefined);
	/** The entry that the last frame went into, or -1 before the first. */
	private newest = -1;
	/** The entry of the camera as it stands, which each call fills again. */
	private readonly current = new Float64Array(ENTRY);
	/** The view of the frame being kept, before it joins the ring. */
	private readonly incoming = new Float64Array(ENTRY);
	/** The entry that the last `frameRay` cast its ray from, and where it starts in it. */
	private rayEntry: Float64Array = this.current;
	private rayAt = -1;
	private readonly matrix = new Float64Array(MATRIX_FLOATS);
	/** The point of a `screenToRay` call, which the ray's math reads from an array. */
	private readonly point = new Float64Array(2);
	/** The projection that `worldToScreen` fills again on each call. */
	private readonly view = new Float64Array(VIEW_FLOATS);

	constructor(
		private readonly core: CoreMemory,
		private readonly control: ControlViews,
		private readonly events: EventFrames,
	) {
		this.ring.fill(NO_FRAME);
	}

	/**
	 * Keeps the camera that engine frame `frame` drew from, on a canvas of `width` by `height`
	 * device pixels, or that it drew from none. A frame that follows the newest entry's last frame
	 * with the same view joins that entry; any other takes the place of the oldest.
	 */
	record(frame: number, camera: FrameLens | undefined, width: number, height: number): void {
		const { ring, incoming } = this;
		const drawn =
			camera !== undefined && this.core.readWorldMatrix(camera.handle, this.matrix) === 0
				? camera
				: undefined;
		if (drawn !== undefined) this.fill(incoming, 0, drawn, width, height);
		let at = this.newest * ENTRY;
		if (
			this.newest >= 0 &&
			ring[at + LAST] === previousFrame(frame) &&
			this.ringCameras[this.newest] === drawn &&
			(drawn === undefined || sameView(ring, at, incoming))
		) {
			ring[at + LAST] = frame;
			return;
		}
		this.newest = (this.newest + 1) % RING_VIEWS;
		at = this.newest * ENTRY;
		this.ringCameras[this.newest] = drawn;
		ring[at + FIRST] = frame;
		ring[at + LAST] = frame;
		for (let k = LAYERS; k < ENTRY; k++) ring[at + k] = incoming[k] as number;
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
		this.rayAt = -1;
		if (at < 0) {
			if (fallback === undefined || this.core.readWorldMatrix(fallback.handle, this.matrix) !== 0)
				return -1;
			entry = this.standing(fallback);
			at = 0;
		}
		writeRay(entry, at, point, out);
		this.rayEntry = entry;
		this.rayAt = at;
		return (entry[at + LAYERS] as number) >>> 0;
	}

	/**
	 * Writes the camera that the last `frameRay` cast its ray from into a query's input, as
	 * `writeQueryCamera` does, so the ray hits sprites, points and lines as that frame drew them.
	 */
	rayCamera(input: Float64Array): void {
		writeQueryCamera(this.rayEntry, this.rayAt, input);
	}

	/**
	 * Writes `camera` as it stands into a query's input, or no camera when it is undefined or gone,
	 * as `writeQueryCamera` does.
	 */
	queryCamera(camera: FrameLens | undefined, input: Float64Array): void {
		if (camera === undefined || this.core.readWorldMatrix(camera.handle, this.matrix) !== 0)
			writeQueryCamera(this.current, -1, input);
		else writeQueryCamera(this.standing(camera), 0, input);
	}

	/**
	 * Where the ring's entry of frame `frame` starts, when the ring holds the frame and it drew from
	 * `camera`, or from any camera when `camera` is undefined; otherwise -1.
	 */
	private entryOf(frame: number, camera: FrameLens | undefined): number {
		if (frame === NO_FRAME) return -1;
		const { ring } = this;
		for (let index = 0; index < RING_VIEWS; index++) {
			const at = index * ENTRY;
			if (
				frameAfter(ring[at + FIRST] as number, frame) ||
				frameAfter(frame, ring[at + LAST] as number)
			)
				continue;
			const drawn = this.ringCameras[index];
			return drawn !== undefined && (camera === undefined || drawn === camera) ? at : -1;
		}
		return -1;
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

/** True when the ring's entry at `at` holds the same view as `view`, whatever their frames. */
function sameView(ring: Float64Array, at: number, view: Float64Array): boolean {
	for (let k = LAYERS; k < ENTRY; k++) if (ring[at + k] !== view[k]) return false;
	return true;
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

/** The half width of a view that `writeQueryCamera` reads, filled again on each call. */
const axisScale = new Float64Array(1);

/**
 * Writes the camera of the entry at `at` into a query's input at the `QUERY_INPUT_*` offsets: its
 * kind, its position, its unit axes, the world units of a CSS pixel across and up the view (at a
 * depth of 1 for a perspective camera), and its near and far distances. An entry at -1, or a
 * canvas with no size, writes no camera, and rays then miss sprites, points and lines that need
 * one.
 */
function writeQueryCamera(e: Float64Array, at: number, input: Float64Array): void {
	const width = at < 0 ? 0 : (e[at + CSS_WIDTH] as number);
	const height = at < 0 ? 0 : (e[at + CSS_HEIGHT] as number);
	if (!(width > 0 && height > 0)) {
		input[C.QUERY_INPUT_CAMERA] = C.QUERY_CAMERA_NONE;
		return;
	}
	const lens = at + LENS;
	const m = at + MATRIX;
	input[C.QUERY_INPUT_CAMERA] =
		e[lens + LENS_ORTHO] !== 0 ? C.QUERY_CAMERA_ORTHOGRAPHIC : C.QUERY_CAMERA_PERSPECTIVE;
	for (let row = 0; row < 3; row++) input[C.QUERY_INPUT_EYE + row] = e[m + row * 4 + 3] as number;
	// The matrix's columns are the camera's right, up and backward axes.
	writeAxis(e, m, 0, 1, input, C.QUERY_INPUT_RIGHT);
	writeAxis(e, m, 1, 1, input, C.QUERY_INPUT_UP);
	writeAxis(e, m, 2, -1, input, C.QUERY_INPUT_FORWARD);
	writeScaleX(e, at, axisScale, 0);
	input[C.QUERY_INPUT_PIXEL] = (2 * (axisScale[0] as number)) / width;
	input[C.QUERY_INPUT_PIXEL + 1] = (2 * (e[lens + LENS_HALF_HEIGHT] as number)) / height;
	input[C.QUERY_INPUT_NEAR] = e[lens + LENS_NEAR] as number;
	input[C.QUERY_INPUT_FAR] = e[lens + LENS_FAR] as number;
}

/** Writes column `column` of the matrix at `m`, times `sign`, as a unit vector at `out[at]`. */
function writeAxis(
	e: Float64Array,
	m: number,
	column: number,
	sign: number,
	out: Float64Array,
	at: number,
): void {
	const x = e[m + column] as number;
	const y = e[m + 4 + column] as number;
	const z = e[m + 8 + column] as number;
	const scale = sign / Math.sqrt(x * x + y * y + z * z);
	out[at] = x * scale;
	out[at + 1] = y * scale;
	out[at + 2] = z * scale;
}

/** The half width that `writeRay` reads, filled again on each call. */
const rayScale = new Float64Array(1);

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
