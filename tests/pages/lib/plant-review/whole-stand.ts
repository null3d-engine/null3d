// The stand of a whole view: the camera that holds a plant from its foot to its top and from side
// to side, as its photograph does. A reference picture says where its horizon, its plant's top and
// its plant's foot sit in the frame, and how much of the frame's width its plant takes. The solve
// works on the points the plant draws at the level the view draws, not on a box or an axis, so
// what lands on the asked rows is what the picture shows. It never crops: where the drawn plant is
// broader or taller than its photograph's, the camera stands back and keeps the foot on its row.

import { type ScreenFraming, standCamera } from './framing';

type V3 = readonly [number, number, number];

/** A whole view's framing in screen shares, with the width its photograph's plant takes. */
export interface WholeFraming extends ScreenFraming {
	/** The share of the frame's width that the photograph's plant takes; the drawn plant takes no more. */
	readonly widthShare?: number;
	/**
	 * A factor on the camera's distance from a redraw that corrects the drawn width by what the
	 * picture itself measured. The foot stays on its row, and the plant stays inside the frame.
	 */
	readonly scale?: number;
}

/** Where the drawn points land in a frame: the rows of the highest and lowest, the columns of the outermost. */
export interface FrameExtent {
	readonly top: number;
	readonly base: number;
	readonly left: number;
	readonly right: number;
}

/** A solved stand, with where the drawn points land from it. */
export interface WholeStand {
	readonly position: V3;
	readonly target: V3;
	/** The camera's horizontal distance from the plant's foot and its height above it, in metres. */
	readonly distance: number;
	readonly height: number;
	readonly extent: FrameExtent;
	/** The rows the framing asked for the plant's top and foot; the foot's is absent where it named an eye height. */
	readonly asked: { readonly top: number; readonly base?: number };
	/**
	 * What set the stand: the asked rows, the photograph's width share, a redraw's scale, or the
	 * frame's own edges where the plant would otherwise run off them.
	 */
	readonly held: 'rows' | 'width' | 'scale' | 'frame';
}

/** The least height a camera stands at, in metres. */
const LOWEST_EYE = 0.1;
/** The margin the plant keeps from every edge of the frame, as a share of it. */
const EDGE = 0.01;
/** The most of the frame's width a plant takes where its photograph states no share. */
const WIDEST = 1 - 2 * EDGE;
/** How near a row or a share must come to what was asked, as a share of the frame. */
const NEAR = 0.002;

/** The camera of a stand: at a distance and a height from the foot, pitched and turned as the framing asks. */
function cameraOf(
	foot: V3,
	turn: number,
	distance: number,
	height: number,
	pitch: number,
	yaw: number,
): { readonly position: V3; readonly forward: V3 } {
	const out: V3 = [Math.sin(turn), 0, Math.cos(turn)];
	const right: V3 = [Math.cos(turn), 0, -Math.sin(turn)];
	const level: V3 = [
		-out[0] * Math.cos(yaw) - right[0] * Math.sin(yaw),
		0,
		-out[2] * Math.cos(yaw) - right[2] * Math.sin(yaw),
	];
	return {
		position: [foot[0] + out[0] * distance, foot[1] + height, foot[2] + out[2] * distance],
		forward: [level[0] * Math.cos(pitch), Math.sin(pitch), level[2] * Math.cos(pitch)],
	};
}

/**
 * Where points land in the frame of a camera that stands without roll. Points are a flat list of
 * x, y and z. Points behind the lens or under the ground at `ground` are left out: the ground
 * hides what grows below it.
 */
export function frameExtent(
	points: ArrayLike<number>,
	position: V3,
	forward: V3,
	fov: number,
	aspect: number,
	ground = Number.NEGATIVE_INFINITY,
): FrameExtent {
	const flat = Math.hypot(forward[2], forward[0]) || 1;
	const right: V3 = [-forward[2] / flat, 0, forward[0] / flat];
	const up: V3 = [
		right[1] * forward[2] - right[2] * forward[1],
		right[2] * forward[0] - right[0] * forward[2],
		right[0] * forward[1] - right[1] * forward[0],
	];
	const half = Math.tan((fov * Math.PI) / 360);
	let top = Number.POSITIVE_INFINITY;
	let base = Number.NEGATIVE_INFINITY;
	let left = Number.POSITIVE_INFINITY;
	let rightmost = Number.NEGATIVE_INFINITY;
	for (let i = 0; i + 2 < points.length; i += 3) {
		const y = points[i + 1] as number;
		if (y < ground) continue;
		const dx = (points[i] as number) - position[0];
		const dy = y - position[1];
		const dz = (points[i + 2] as number) - position[2];
		const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
		if (depth <= 1e-6) continue;
		const row = 0.5 - (dx * up[0] + dy * up[1] + dz * up[2]) / (2 * half * depth);
		const column = 0.5 + (dx * right[0] + dz * right[2]) / (2 * half * aspect * depth);
		if (row < top) top = row;
		if (row > base) base = row;
		if (column < left) left = column;
		if (column > rightmost) rightmost = column;
	}
	return Number.isFinite(top)
		? { top, base, left, right: rightmost }
		: { top: 0.5, base: 0.5, left: 0.5, right: 0.5 };
}

/**
 * The stand of a whole view of a plant on the points it draws.
 *
 * The horizon's row sets the camera's pitch. The camera then stands where the highest drawn point
 * lands on the asked top row and the lowest lands on the asked foot row, or, where the framing
 * names an eye height in place of a foot row, at that height where the highest point lands on the
 * top row. If the plant is then wider than its photograph's share of the frame, the camera stands
 * back until it is not, and keeps the foot on its row. A redraw's scale moves the camera in or out
 * the same way. Last, the camera stands back as far as holds every drawn point inside the frame.
 *
 * @param points The points the plant draws at the level the view draws, as x, y and z.
 * @param foot Where the plant stands.
 * @param turn Radians round the plant the camera stands at; 0 stands on the +Z side.
 * @param framing The photograph's framing in screen shares.
 * @param height The plant's height in metres, for the first stand the solve starts from.
 * @returns The camera, and where the drawn points land from it.
 */
export function wholeStand(
	points: ArrayLike<number>,
	foot: V3,
	turn: number,
	framing: WholeFraming,
	height: number,
): WholeStand {
	const first = standCamera(framing, height);
	const { pitch, yaw } = first;
	const half = Math.tan((framing.fov * Math.PI) / 360);
	const ground = foot[1] - 1e-3;
	let distance = first.distance;
	let eye = first.height;
	const extentAt = (d: number, h: number): FrameExtent => {
		const camera = cameraOf(foot, turn, d, h, pitch, yaw);
		return frameExtent(
			points,
			camera.position,
			camera.forward,
			framing.fov,
			framing.aspect,
			ground,
		);
	};
	const askedBase = framing.base;
	// Puts the lowest drawn point on its asked row by raising or lowering the camera. A camera at
	// the least height that still shows the foot too low has no lower stand to take.
	const pinFoot = (): void => {
		if (askedBase === undefined) return;
		for (let pass = 0; pass < 12; pass++) {
			const off = extentAt(distance, eye).base - askedBase;
			if (Math.abs(off) < NEAR) return;
			const next = Math.max(LOWEST_EYE, eye - off * 2 * distance * half);
			if (next === eye) return;
			eye = next;
		}
	};
	let held: WholeStand['held'] = 'rows';
	if (askedBase !== undefined) {
		// Two rows asked: the span between them sets the distance and their middle the height.
		const askedSpan = askedBase - framing.top;
		const askedMiddle = (askedBase + framing.top) / 2;
		for (let pass = 0; pass < 16; pass++) {
			const at = extentAt(distance, eye);
			const scale = askedSpan > 1e-4 ? (at.base - at.top) / askedSpan : 1;
			const off = (at.base + at.top) / 2 - askedMiddle;
			if (Math.abs(scale - 1) < NEAR && Math.abs(off) < NEAR) break;
			eye = Math.max(LOWEST_EYE, eye - off * 2 * distance * half);
			distance *= Math.max(0.2, Math.min(5, scale));
		}
	} else {
		// An eye height asked: the highest point's row falls as the camera steps back, so one
		// distance puts it on the asked row.
		let near = distance / 64;
		let far = distance * 64;
		for (let pass = 0; pass < 28; pass++) {
			const middle = Math.sqrt(near * far);
			if (extentAt(middle, eye).top < framing.top) near = middle;
			else far = middle;
		}
		distance = Math.sqrt(near * far);
	}
	if (framing.scale !== undefined && framing.scale > 0 && framing.scale !== 1) {
		distance *= framing.scale;
		pinFoot();
		held = 'scale';
	} else {
		// The plant takes no more of the frame's width than its photograph's does.
		const widest = Math.min(WIDEST, framing.widthShare ?? WIDEST);
		for (let pass = 0; pass < 8; pass++) {
			const at = extentAt(distance, eye);
			const over = (at.right - at.left) / widest;
			if (over <= 1 + NEAR) break;
			distance *= over;
			pinFoot();
			held = 'width';
		}
	}
	// No drawn point leaves the frame, whatever the rows and the width asked for.
	for (let pass = 0; pass < 12; pass++) {
		const at = extentAt(distance, eye);
		const reach = 0.5 - EDGE;
		const over = Math.max(
			(0.5 - at.top) / reach,
			(at.base - 0.5) / reach,
			(0.5 - at.left) / reach,
			(at.right - 0.5) / reach,
		);
		if (over <= 1 + NEAR) break;
		distance *= over;
		pinFoot();
		// A foot that the frame's lower edge still cuts is held by the camera's height alone.
		const base = extentAt(distance, eye).base;
		if (base > 1 - EDGE)
			eye = Math.max(LOWEST_EYE, eye - (base - (1 - EDGE)) * 2 * distance * half);
		held = 'frame';
	}
	const camera = cameraOf(foot, turn, distance, eye, pitch, yaw);
	return {
		position: camera.position,
		target: [
			camera.position[0] + camera.forward[0] * distance,
			camera.position[1] + camera.forward[1] * distance,
			camera.position[2] + camera.forward[2] * distance,
		],
		distance,
		height: eye,
		extent: extentAt(distance, eye),
		asked: { top: framing.top, ...(askedBase !== undefined && { base: askedBase }) },
		held,
	};
}
