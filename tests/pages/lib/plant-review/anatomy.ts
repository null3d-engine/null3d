// The parts of a grown plant that the review views frame, read from its macro skeleton: the main
// stem and its radius at a height, the largest first-order limb, where that limb first forks, where
// the stem first forks, and a sunlit shoot tip. They read only the skeleton's arrays, so they hold
// for every growth model.
import type { MacroSkeleton } from '@null3d/vegetation';

/** A point or direction in plant space. */
export type V3 = [number, number, number];

/** A node's position. */
export function nodeAt(skeleton: MacroSkeleton, node: number): V3 {
	const p = skeleton.position;
	return [p[node * 3] as number, p[node * 3 + 1] as number, p[node * 3 + 2] as number];
}

/** The horizontal direction that a turn in radians faces: turn 0 looks from the +Z side. */
export function facing(turn: number): V3 {
	return [Math.sin(turn), 0, Math.cos(turn)];
}

/** The unit vector along `a`, or +Y for a zero vector. */
export function normalize(a: readonly number[]): V3 {
	const length = Math.hypot(a[0] as number, a[1] as number, a[2] as number);
	return length > 0
		? [(a[0] as number) / length, (a[1] as number) / length, (a[2] as number) / length]
		: [0, 1, 0];
}

/** The chain of one axis: its parent node before its base (when it has one), then its own nodes. */
export function chainOf(skeleton: MacroSkeleton, axis: number): number[] {
	const { axes } = skeleton;
	const chain: number[] = [];
	const parentNode = axes.parentNode[axis] as number;
	if (parentNode >= 0) chain.push(parentNode);
	for (let n = axes.first[axis] as number; n <= (axes.last[axis] as number); n++) chain.push(n);
	return chain;
}

/** The length of an axis's chain in metres. */
export function lengthOf(skeleton: MacroSkeleton, axis: number): number {
	const chain = chainOf(skeleton, axis);
	let length = 0;
	for (let k = 1; k < chain.length; k++) {
		const a = nodeAt(skeleton, chain[k - 1] as number);
		const b = nodeAt(skeleton, chain[k] as number);
		length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
	}
	return length;
}

/** A point on an axis: where it is, the axis's direction there and its radius. */
export interface AxisPoint {
	readonly at: V3;
	readonly direction: V3;
	readonly radius: number;
}

/** The point a share of the way along an axis's chain. */
export function pointAlong(skeleton: MacroSkeleton, axis: number, share: number): AxisPoint {
	const chain = chainOf(skeleton, axis);
	const total = lengthOf(skeleton, axis);
	const want = Math.max(0, Math.min(1, share)) * total;
	let walked = 0;
	for (let k = 1; k < chain.length; k++) {
		const i = chain[k - 1] as number;
		const j = chain[k] as number;
		const a = nodeAt(skeleton, i);
		const b = nodeAt(skeleton, j);
		const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		if (walked + d >= want || k === chain.length - 1) {
			const t = d > 0 ? Math.min(1, (want - walked) / d) : 0;
			const ra = skeleton.radius[i] as number;
			const rb = skeleton.radius[j] as number;
			return {
				at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
				direction: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]),
				radius: ra + (rb - ra) * t,
			};
		}
		walked += d;
	}
	const only = chain[0] ?? 0;
	return { at: nodeAt(skeleton, only), direction: [0, 1, 0], radius: skeleton.radius[only] ?? 0 };
}

/** The main stem: the stem axis that is thickest at its base, or -1 for a plant with none. */
export function mainStem(skeleton: MacroSkeleton): number {
	const { axes } = skeleton;
	let best = -1;
	let thickest = -1;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) >= 0) continue;
		const r = skeleton.radius[axes.first[a] as number] as number;
		if (r > thickest) {
			thickest = r;
			best = a;
		}
	}
	return best;
}

/** The main stem's centre and radius at a height, or undefined when the stem does not reach it. */
export function stemAt(skeleton: MacroSkeleton, y: number): AxisPoint | undefined {
	const stem = mainStem(skeleton);
	if (stem < 0) return undefined;
	const chain = chainOf(skeleton, stem);
	for (let k = 1; k < chain.length; k++) {
		const i = chain[k - 1] as number;
		const j = chain[k] as number;
		const a = nodeAt(skeleton, i);
		const b = nodeAt(skeleton, j);
		if (y < a[1] || y > b[1] || b[1] <= a[1]) continue;
		const t = (y - a[1]) / (b[1] - a[1]);
		const ra = skeleton.radius[i] as number;
		const rb = skeleton.radius[j] as number;
		return {
			at: [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t],
			direction: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]),
			radius: ra + (rb - ra) * t,
		};
	}
	return undefined;
}

/** The main stem's base, on the ground. */
export function stemFoot(skeleton: MacroSkeleton): V3 {
	const stem = mainStem(skeleton);
	if (stem < 0) return [0, 0, 0];
	const base = nodeAt(skeleton, skeleton.axes.first[stem] as number);
	return [base[0], 0, base[2]];
}

/** The largest first-order limb: the thickest at its base, or -1 for a plant with none. */
export function largestLimb(skeleton: MacroSkeleton): number {
	const { axes } = skeleton;
	let best = -1;
	let thickest = -1;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) < 0 || (axes.order[a] as number) !== 1) continue;
		const r = (skeleton.radius[axes.first[a] as number] as number) + lengthOf(skeleton, a) * 1e-6;
		if (r > thickest) {
			thickest = r;
			best = a;
		}
	}
	return best;
}

/** Where an axis first forks: the first of its nodes that a child axis leaves from. */
export function firstForkOf(skeleton: MacroSkeleton, axis: number): AxisPoint | undefined {
	const { axes } = skeleton;
	let first = Number.POSITIVE_INFINITY;
	for (let a = 0; a < axes.count; a++)
		if ((axes.parent[a] as number) === axis) first = Math.min(first, axes.parentNode[a] as number);
	if (!Number.isFinite(first)) return undefined;
	const chain = chainOf(skeleton, axis);
	const k = Math.max(1, chain.indexOf(first));
	const node = chain[k] as number;
	const before = chain[k - 1] as number;
	const a = nodeAt(skeleton, before);
	const b = nodeAt(skeleton, node);
	return {
		at: b,
		direction: normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]),
		radius: skeleton.radius[node] as number,
	};
}

/** The height at which the main stem first divides: where its lowest limb leaves. */
export function firstForkHeight(skeleton: MacroSkeleton): number | undefined {
	const stem = mainStem(skeleton);
	if (stem < 0) return undefined;
	const { axes } = skeleton;
	let lowest = Number.POSITIVE_INFINITY;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) !== stem) continue;
		const node = axes.parentNode[a] as number;
		if (node >= 0) lowest = Math.min(lowest, skeleton.position[node * 3 + 1] as number);
	}
	return Number.isFinite(lowest) ? lowest : undefined;
}

/** A shoot tip: the bud's place and the direction its shoot grows. */
export interface ShootTip {
	readonly bud: number;
	readonly at: V3;
	readonly direction: V3;
}

/**
 * The sunlit shoot tip that faces a side of the plant best: a terminal bud on the crown's surface
 * toward `side`, ranked by its light and by how far out toward that side it stands.
 */
export function sunlitTip(
	skeleton: MacroSkeleton,
	side: V3,
	terminal: number,
): ShootTip | undefined {
	const { buds } = skeleton;
	const foot = stemFoot(skeleton);
	let reach = 1e-6;
	for (let b = 0; b < buds.count; b++)
		reach = Math.max(
			reach,
			Math.hypot(
				(buds.position[b * 3] as number) - foot[0],
				(buds.position[b * 3 + 2] as number) - foot[2],
			),
		);
	let best = -1;
	let score = Number.NEGATIVE_INFINITY;
	for (let b = 0; b < buds.count; b++) {
		if ((buds.kind[b] as number) !== terminal) continue;
		const out =
			(((buds.position[b * 3] as number) - foot[0]) * side[0] +
				((buds.position[b * 3 + 2] as number) - foot[2]) * side[2]) /
			reach;
		const s = (buds.light[b] as number) + out;
		if (s > score) {
			score = s;
			best = b;
		}
	}
	if (best < 0) return undefined;
	const q = buds.frame.subarray(best * 4, best * 4 + 4);
	const [x, y, z, w] = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
	// The frame's +Y, the shoot's direction.
	const direction = normalize([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]);
	return {
		bud: best,
		at: [
			buds.position[best * 3] as number,
			buds.position[best * 3 + 1] as number,
			buds.position[best * 3 + 2] as number,
		],
		direction,
	};
}
