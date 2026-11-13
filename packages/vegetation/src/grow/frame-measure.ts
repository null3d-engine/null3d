// Measures of a directed frame, for its tests and its previews: how sharply its axes turn, how long
// they run straight, how evenly they thin, how round the crown's plan is, how the crown fills the
// outline its species states, how evenly a set of axes stands round the plant, and whether every
// axis joins its parent and ends in foliage.
import { acos, atan2, cos, PI, radians, sin } from '../core/math';
import {
	type FrameAxis,
	type FrameNode,
	type FramePlan,
	type FrameSpec,
	outlineRadius,
} from './frame';

/** The degrees a run of an axis may stray from its first piece and still count as straight. */
const STRAIGHT_WITHIN = 1;
/** Directions round the plant that the plan's width is read in. */
const PLAN_DIRECTIONS = 36;

/** The unit direction from one node to the next, and the metres between them. */
function piece(a: FrameNode, b: FrameNode): [number, number, number, number] {
	const x = b.x - a.x;
	const y = b.y - a.y;
	const z = b.z - a.z;
	const length = Math.sqrt(x * x + y * y + z * z);
	return length > 0 ? [x / length, y / length, z / length, length] : [0, 1, 0, 0];
}

/** The degrees between two pieces' directions. */
function turn(a: readonly number[], b: readonly number[]): number {
	const dot =
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number);
	return (acos(Math.max(-1, Math.min(1, dot))) * 180) / PI;
}

/** An axis's pieces, each from one of its own nodes to the next. */
function pieces(axis: FrameAxis): [number, number, number, number][] {
	const out: [number, number, number, number][] = [];
	for (let k = 1; k < axis.nodes.length; k++)
		out.push(piece(axis.nodes[k - 1] as FrameNode, axis.nodes[k] as FrameNode));
	return out;
}

/**
 * The most degrees any piece of an axis turns from the piece before it on the same axis.
 *
 * @param axis The axis.
 * @returns The sharpest turn in degrees.
 * @category api/vegetation
 */
export function sharpestTurn(axis: FrameAxis): number {
	const all = pieces(axis);
	let most = 0;
	for (let k = 1; k < all.length; k++)
		most = Math.max(most, turn(all[k - 1] as number[], all[k] as number[]));
	return most;
}

/**
 * The longest run of an axis that holds one direction, as a share of the axis's own nodes' run.
 *
 * @param axis The axis.
 * @returns The share, from 0 to 1.
 * @category api/vegetation
 */
export function longestStraight(axis: FrameAxis): number {
	const all = pieces(axis);
	let whole = 0;
	for (const one of all) whole += one[3];
	if (whole <= 0) return 0;
	let most = 0;
	for (let from = 0; from < all.length; from++) {
		let run = 0;
		for (let k = from; k < all.length; k++) {
			if (turn(all[from] as number[], all[k] as number[]) > STRAIGHT_WITHIN) break;
			run += (all[k] as number[])[3] as number;
		}
		most = Math.max(most, run);
	}
	return most / whole;
}

/**
 * The largest drop in radius between neighbouring nodes of an axis, as a share of the axis's
 * thickest radius. An axis that thins evenly over many nodes drops a small share at each. The drop
 * just past a node where another axis leaves is the fork's own and is not counted.
 *
 * @param axis The axis.
 * @param forks The axis's nodes where another axis leaves.
 * @returns The share, 0 for an axis of one radius.
 * @category api/vegetation
 */
export function steepestStep(axis: FrameAxis, forks?: ReadonlySet<number>): number {
	let thickest = 0;
	for (const node of axis.nodes) thickest = Math.max(thickest, node.radius);
	let most = 0;
	for (let k = 1; k < axis.nodes.length; k++)
		if (!forks?.has(k - 1))
			most = Math.max(
				most,
				Math.abs((axis.nodes[k - 1] as FrameNode).radius - (axis.nodes[k] as FrameNode).radius),
			);
	return thickest > 0 ? most / thickest : 0;
}

/**
 * Whether an axis ever thickens away from its base.
 *
 * @param axis The axis.
 * @returns True when some node is thicker than the node before it.
 * @category api/vegetation
 */
export function thickens(axis: FrameAxis): boolean {
	for (let k = 1; k < axis.nodes.length; k++)
		if ((axis.nodes[k] as FrameNode).radius > (axis.nodes[k - 1] as FrameNode).radius + 1e-9)
			return true;
	return false;
}

/**
 * An axis's radius where it leaves, as a share of its parent's radius there.
 *
 * @param plan The frame.
 * @param axis The axis.
 * @returns The share, or 1 for a stem.
 * @category api/vegetation
 */
export function baseShare(plan: FramePlan, axis: FrameAxis): number {
	const from = plan.axes[axis.parent]?.nodes[axis.parentNode];
	return from ? axis.base / from.radius : 1;
}

/**
 * The crown's narrow side over its wide side, read over the foliage patches' far edges in every
 * direction round the plant.
 *
 * @param plan The frame.
 * @returns The share, from 0 to 1, and the degrees the wide side lies at.
 * @category api/vegetation
 */
export function planShape(plan: FramePlan): { readonly narrow: number; readonly turn: number } {
	let wide = 0;
	let narrow = Number.POSITIVE_INFINITY;
	let at = 0;
	for (let k = 0; k < PLAN_DIRECTIONS; k++) {
		const angle = radians((k * 180) / PLAN_DIRECTIONS);
		const c = cos(angle);
		const s = sin(angle);
		let low = 0;
		let high = 0;
		for (const patch of plan.patches) {
			const along = patch.centre[0] * c + patch.centre[2] * s;
			low = Math.min(low, along - patch.width / 2);
			high = Math.max(high, along + patch.width / 2);
		}
		const width = high - low;
		if (width > wide) {
			wide = width;
			at = (k * 180) / PLAN_DIRECTIONS;
		}
		narrow = Math.min(narrow, width);
	}
	return { narrow: wide > 0 ? narrow / wide : 1, turn: at };
}

/**
 * The widest gap between neighbours of a set of directions round the plant.
 *
 * @param azimuths The directions in degrees.
 * @returns The widest gap in degrees; 360 for fewer than two directions.
 * @category api/vegetation
 */
export function widestGap(azimuths: readonly number[]): number {
	if (azimuths.length < 2) return 360;
	const sorted = azimuths.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
	let most = 360 - (sorted[sorted.length - 1] as number) + (sorted[0] as number);
	for (let k = 1; k < sorted.length; k++)
		most = Math.max(most, (sorted[k] as number) - (sorted[k - 1] as number));
	return most;
}

/**
 * How far the pull of a set of axes stands off the plant's middle: the length of the sum of their
 * level reaches over the sum of those reaches' lengths. Nothing for a set that balances, 1 for a
 * set that all leans one way.
 *
 * @param axes The axes.
 * @returns The share, from 0 to 1.
 * @category api/vegetation
 */
export function imbalance(axes: readonly FrameAxis[]): number {
	let x = 0;
	let z = 0;
	let all = 0;
	for (const axis of axes) {
		const end = axis.nodes[axis.nodes.length - 1] as FrameNode;
		const start = axis.nodes[0] as FrameNode;
		const dx = end.x - start.x;
		const dz = end.z - start.z;
		x += dx;
		z += dz;
		all += Math.sqrt(dx * dx + dz * dz);
	}
	return all > 0 ? Math.sqrt(x * x + z * z) / all : 0;
}

/**
 * The direction round the plant that an axis's end stands at.
 *
 * @param axis The axis.
 * @returns Degrees from +X toward +Z.
 * @category api/vegetation
 */
export function endAzimuth(axis: FrameAxis): number {
	const end = axis.nodes[axis.nodes.length - 1] as FrameNode;
	return (atan2(end.z, end.x) * 180) / PI;
}

/**
 * The axes that do not join their parent: a parent or a node that is not in the plan, a first node
 * farther from the parent's node than the axis is long, or a place that is not a number.
 *
 * @param plan The frame.
 * @returns The axes' indices.
 * @category api/vegetation
 */
export function looseAxes(plan: FramePlan): number[] {
	const out: number[] = [];
	plan.axes.forEach((axis, index) => {
		const sound = axis.nodes.every(
			(node) =>
				Number.isFinite(node.x) &&
				Number.isFinite(node.y) &&
				Number.isFinite(node.z) &&
				node.radius > 0,
		);
		let joined = axis.nodes.length > 0;
		if (axis.parent >= 0) {
			const from = plan.axes[axis.parent]?.nodes[axis.parentNode];
			const first = axis.nodes[0];
			joined =
				axis.parent < index &&
				from !== undefined &&
				first !== undefined &&
				piece(from, first)[3] <= axis.length + 1e-6;
		} else joined = joined && (axis.nodes[0] as FrameNode).y === 0;
		if (!sound || !joined) out.push(index);
	});
	return out;
}

/**
 * The axes whose end is bare: no axis leaves from the end's last tenth, and the end stands neither
 * inside a foliage patch nor within one patch depth under one.
 *
 * @param plan The frame.
 * @returns The axes' indices.
 * @category api/vegetation
 */
export function bareEnds(plan: FramePlan): number[] {
	const out: number[] = [];
	plan.axes.forEach((axis, index) => {
		const forks = plan.axes.some(
			(child) => child.parent === index && (axis.along[child.parentNode] as number) >= 0.9,
		);
		if (forks) return;
		const end = axis.nodes[axis.nodes.length - 1] as FrameNode;
		const clothed = plan.patches.some((patch) => {
			const dx = end.x - patch.centre[0];
			const dz = end.z - patch.centre[2];
			const slack = 0.05 * patch.width + 1e-6;
			return (
				Math.sqrt(dx * dx + dz * dz) <= patch.width / 2 + slack &&
				end.y <= patch.centre[1] + patch.depth / 2 + slack &&
				end.y >= patch.centre[1] - 1.5 * patch.depth - slack
			);
		});
		if (!clothed) out.push(index);
	});
	return out;
}

/** One band of a crown seen from one side. */
export interface CrownBand {
	/** The band's middle height as a share of the plant's height. */
	readonly height: number;
	/** The foliage patches' reach to one side of the trunk's line in the band, in metres. */
	readonly built: number;
	/** The species' outline at the band's height toward that side, in metres. */
	readonly stated: number;
}

/**
 * A frame's crown seen from several sides, band by band: how far the foliage patches reach to each
 * side of the trunk's line against the outline the species states. A view from one side reads two
 * reaches, one to its left and one to its right.
 *
 * @param plan The frame.
 * @param spec The species' frame, whose outline the reaches are held against.
 * @param sides The directions round the plant that the reaches are read toward.
 * @param bands The bands between the ground and the plant's stated height.
 * @returns The bands of each direction, from the lowest.
 * @category api/vegetation
 */
export function crownBands(plan: FramePlan, spec: FrameSpec, sides = 8, bands = 16): CrownBand[][] {
	const out: CrownBand[][] = [];
	for (let side = 0; side < sides; side++) {
		const angle = (side * 2 * PI) / sides;
		const c = cos(angle);
		const s = sin(angle);
		const row: CrownBand[] = [];
		for (let band = 0; band < bands; band++) {
			const low = (band / bands) * plan.scale;
			const high = ((band + 1) / bands) * plan.scale;
			let built = 0;
			for (const patch of plan.patches) {
				if (patch.centre[1] + patch.depth / 2 < low || patch.centre[1] - patch.depth / 2 > high)
					continue;
				built = Math.max(built, patch.centre[0] * c + patch.centre[2] * s + patch.width / 2);
			}
			row.push({
				height: (band + 0.5) / bands,
				built,
				stated: outlineRadius(spec, plan.scale, (low + high) / 2, angle),
			});
		}
		out.push(row);
	}
	return out;
}

/**
 * How a frame's crown fills its stated outline: over the bands where the outline is at least half
 * its widest, the built reach over the stated one, as the mean over every side and band, and the
 * least and the most of the sides' own means.
 *
 * @param plan The frame.
 * @param spec The species' frame.
 * @returns The three shares.
 * @category api/vegetation
 */
export function crownFill(
	plan: FramePlan,
	spec: FrameSpec,
): { readonly mean: number; readonly least: number; readonly most: number } {
	const rows = crownBands(plan, spec);
	let widest = 0;
	for (const row of rows) for (const band of row) widest = Math.max(widest, band.stated);
	let all = 0;
	let count = 0;
	let least = Number.POSITIVE_INFINITY;
	let most = 0;
	for (const row of rows) {
		let sum = 0;
		let n = 0;
		for (const band of row) {
			if (band.stated < widest / 2) continue;
			sum += band.built / band.stated;
			n++;
		}
		if (n === 0) continue;
		all += sum;
		count += n;
		least = Math.min(least, sum / n);
		most = Math.max(most, sum / n);
	}
	return { mean: count > 0 ? all / count : 0, least: count > 0 ? least : 0, most };
}
