// The cameras of the CPU plant preview: a stand camera on the ground that frames a whole plant on the
// rows a reference picture puts it on, as the review page stands its camera; an orthographic camera
// at a turn or straight above, for the skeleton pictures; and a camera at a person's eye height that
// looks up the stem. A camera projects a point in plant space to pixels and a depth along its line
// of sight, and the preview's drawing reads nothing else of it.
import { type ScreenFraming, standCamera } from '../../../tests/pages/lib/plant-review/framing.ts';

/** Three numbers: a point or a direction in plant space. */
export type V3 = readonly [number, number, number];

/** A camera that maps plant space to a picture's pixels, rows counting down from the top. */
export interface PreviewCamera {
	/** The picture's size in pixels. */
	readonly width: number;
	readonly height: number;
	/** Where the camera stands. */
	readonly position: V3;
	/** The picture's right, its up and the camera's line of sight, unit vectors. */
	readonly right: V3;
	readonly up: V3;
	readonly forward: V3;
	/** Pixels per metre at one metre's depth, for a camera with perspective; 0 for one without. */
	readonly focal: number;
	/** Pixels per metre, for a camera without perspective. */
	readonly scale: number;
	/** The point a stand camera looks at, which a change of its stand moves it toward or from. */
	readonly focus?: V3;
}

const DEG = Math.PI / 180;

function cross(a: V3, b: V3): [number, number, number] {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: V3): [number, number, number] {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
}

/** The direction from the plant to a camera at a turn: turn 0 looks from +Z. */
function facing(turn: number): [number, number, number] {
	return [Math.sin(turn), 0, Math.cos(turn)];
}

/**
 * Writes a point's pixel column, pixel row and depth. A point behind a camera with perspective
 * writes NaN, so a triangle that holds it draws nothing.
 *
 * @param camera The camera.
 * @param x The point in plant space.
 * @param y The point's height.
 * @param z The point in plant space.
 * @param out The array to write.
 * @param at Where in `out` to write the three values.
 */
export function project(
	camera: PreviewCamera,
	x: number,
	y: number,
	z: number,
	out: Float64Array,
	at: number,
): void {
	const dx = x - camera.position[0];
	const dy = y - camera.position[1];
	const dz = z - camera.position[2];
	const depth = dx * camera.forward[0] + dy * camera.forward[1] + dz * camera.forward[2];
	const across = dx * camera.right[0] + dy * camera.right[1] + dz * camera.right[2];
	const rise = dx * camera.up[0] + dy * camera.up[1] + dz * camera.up[2];
	let k = camera.scale;
	if (camera.focal > 0) {
		if (depth < 0.05) {
			out[at] = Number.NaN;
			out[at + 1] = Number.NaN;
			out[at + 2] = Number.NaN;
			return;
		}
		k = camera.focal / depth;
	}
	out[at] = camera.width / 2 + across * k;
	out[at + 1] = camera.height / 2 - rise * k;
	out[at + 2] = depth;
}

/** Pixels that one metre spans at a depth. */
export function pixelsPerMetre(camera: PreviewCamera, depth: number): number {
	return camera.focal > 0 ? camera.focal / Math.max(0.05, depth) : camera.scale;
}

/**
 * The camera that stands on the ground and puts a plant on the rows a framing asks for, at a turn
 * about the plant, as the review page's whole views do.
 *
 * @param framing The rows and column the plant lands on, in shares of the frame.
 * @param plantHeight The drawn plant's height in metres.
 * @param turn Degrees about the plant; 0 looks from +Z.
 * @param width The picture's width in pixels.
 * @returns The camera.
 */
export function standingCamera(
	framing: ScreenFraming,
	plantHeight: number,
	turn: number,
	width: number,
): PreviewCamera {
	const height = Math.max(1, Math.round(width / framing.aspect));
	const stand = standCamera(framing, plantHeight);
	const out = facing(turn * DEG);
	const side: V3 = [Math.cos(turn * DEG), 0, -Math.sin(turn * DEG)];
	const cy = Math.cos(stand.yaw);
	const sy = Math.sin(stand.yaw);
	const level: V3 = [-out[0] * cy - side[0] * sy, 0, -out[2] * cy - side[2] * sy];
	const cp = Math.cos(stand.pitch);
	const forward = unit([level[0] * cp, Math.sin(stand.pitch), level[2] * cp]);
	const right = unit(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	const position: V3 = [out[0] * stand.distance, stand.height, out[2] * stand.distance];
	return {
		width,
		height,
		position,
		right,
		up,
		forward,
		focal: height / 2 / Math.tan((framing.fov * DEG) / 2),
		scale: 0,
		focus: [
			position[0] + forward[0] * stand.distance,
			position[1] + forward[1] * stand.distance,
			position[2] + forward[2] * stand.distance,
		],
	};
}

/**
 * A stand camera moved along its own line to the point it looks at, by a scale of its distance, as
 * a review redraw corrects a picture's margin from the width the picture itself measured.
 *
 * @param camera The camera.
 * @param scale The share of its distance it keeps; above 1 stands it further back.
 * @returns The moved camera.
 */
export function restood(camera: PreviewCamera, scale: number): PreviewCamera {
	const focus = camera.focus;
	if (!focus || !(scale > 0) || scale === 1) return camera;
	return {
		...camera,
		position: [
			focus[0] + (camera.position[0] - focus[0]) * scale,
			focus[1] + (camera.position[1] - focus[1]) * scale,
			focus[2] + (camera.position[2] - focus[2]) * scale,
		],
	};
}

/** The same camera drawing a picture a whole number of times as large. */
export function enlarged(camera: PreviewCamera, factor: number): PreviewCamera {
	return {
		...camera,
		width: camera.width * factor,
		height: camera.height * factor,
		focal: camera.focal * factor,
		scale: camera.scale * factor,
	};
}

/** A box in plant space. */
export interface Bounds {
	readonly min: V3;
	readonly max: V3;
}

/**
 * A camera without perspective that fits a box in the picture with a margin: from the side at a
 * turn, or from straight above with the +Z side at the picture's foot.
 *
 * @param bounds The box to fit.
 * @param view A turn in degrees for a side view, or `'above'`.
 * @param width The picture's width in pixels.
 * @param height The picture's height in pixels.
 * @returns The camera.
 */
export function flatCamera(
	bounds: Bounds,
	view: number | 'above',
	width: number,
	height: number,
): PreviewCamera {
	const centre: V3 = [
		(bounds.min[0] + bounds.max[0]) / 2,
		(bounds.min[1] + bounds.max[1]) / 2,
		(bounds.min[2] + bounds.max[2]) / 2,
	];
	const wide = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
	const tall = bounds.max[1] - bounds.min[1];
	const far = wide + tall + 10;
	if (view === 'above') {
		return {
			width,
			height,
			position: [centre[0], bounds.max[1] + far, centre[2]],
			right: [1, 0, 0],
			up: [0, 0, -1],
			forward: [0, -1, 0],
			focal: 0,
			scale: Math.min(width, height) / (wide * 1.04),
		};
	}
	const out = facing(view * DEG);
	const right: V3 = [Math.cos(view * DEG), 0, -Math.sin(view * DEG)];
	return {
		width,
		height,
		position: [centre[0] + out[0] * far, centre[1], centre[2] + out[2] * far],
		right,
		up: [0, 1, 0],
		forward: [-out[0], 0, -out[2]],
		focal: 0,
		scale: Math.min(width / (wide * 1.04), height / (tall * 1.04)),
	};
}

/**
 * A camera at a person's eye height beside the stem, looking up into the crown, as a photograph
 * taken from the foot of a tree does.
 *
 * @param away Metres from the plant's axis, on the +Z side.
 * @param eye The camera's height in metres.
 * @param pitch Degrees the camera looks up.
 * @param fov The vertical field of view in degrees.
 * @param width The picture's width in pixels.
 * @param height The picture's height in pixels.
 * @returns The camera.
 */
export function upwardCamera(
	away: number,
	eye: number,
	pitch: number,
	fov: number,
	width: number,
	height: number,
): PreviewCamera {
	const forward = unit([0, Math.sin(pitch * DEG), -Math.cos(pitch * DEG)]);
	const right: V3 = [1, 0, 0];
	return {
		width,
		height,
		position: [0, eye, away],
		right,
		up: cross(right, forward),
		forward,
		focal: height / 2 / Math.tan((fov * DEG) / 2),
		scale: 0,
	};
}
