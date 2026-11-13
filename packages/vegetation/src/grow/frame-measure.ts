// Measures of a directed frame, for its tests and its previews: how sharply its axes turn, how long
// they run straight, how evenly they thin, how round the crown's plan is, how the crown fills the
// outline its species states band by band, what foliage stands under the outline's lower boundary,
// how many lumps the crown's rim has, how evenly a set of axes stands round the plant, and whether
// every axis joins its parent and ends in foliage.
import { acos, asin, atan2, cos, PI, radians, sin } from '../core/math';
import { curveAt } from '../core/types';
import {
	type FrameAxis,
	type FrameNode,
	type FramePatch,
	type FramePlan,
	type FrameSpec,
	outlineRadius,
	outlineSpan,
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
 * thickest radius. An axis that thins evenly over many nodes drops a small share at each. Just past
 * a node where other axes leave, the axis may also drop by what those axes took of its
 * cross-section, and only the drop beyond that is counted.
 *
 * @param axis The axis.
 * @param forks For each of the axis's nodes where other axes leave, the share of its radius the
 *   axis keeps past it when it gives up the whole of their cross-sections.
 * @returns The share, 0 for an axis of one radius.
 * @category api/vegetation
 */
export function steepestStep(axis: FrameAxis, forks?: ReadonlyMap<number, number>): number {
	let thickest = 0;
	for (const node of axis.nodes) thickest = Math.max(thickest, node.radius);
	let most = 0;
	for (let k = 1; k < axis.nodes.length; k++) {
		const from = (axis.nodes[k - 1] as FrameNode).radius;
		const drop = Math.abs(from - (axis.nodes[k] as FrameNode).radius);
		const kept = forks?.get(k - 1);
		most = Math.max(most, kept === undefined ? drop : Math.max(0, drop - from * (1 - kept)));
	}
	return thickest > 0 ? most / thickest : 0;
}

/**
 * For each node of an axis where other axes leave, the share of its radius the axis keeps past it
 * when it gives up the whole of their cross-sections: the root of one less the sum of the squares
 * of their radii over its own.
 *
 * @param plan The frame.
 * @param index The axis's index in the plan.
 * @returns The kept share at each such node.
 * @category api/vegetation
 */
export function forkShares(plan: FramePlan, index: number): Map<number, number> {
	const axis = plan.axes[index] as FrameAxis;
	const taken = new Map<number, number>();
	for (const child of plan.axes) {
		if (child.parent !== index) continue;
		const at = (axis.nodes[child.parentNode] as FrameNode).radius;
		const share = Math.min(0.95, child.base / Math.max(1e-9, at));
		taken.set(child.parentNode, (taken.get(child.parentNode) ?? 0) + share * share);
	}
	const kept = new Map<number, number>();
	for (const [node, squares] of taken) kept.set(node, Math.sqrt(Math.max(0.05, 1 - squares)));
	return kept;
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

/**
 * How far a patch reaches toward a direction inside a band of heights, in metres, or 0 where it
 * stands outside the band. A patch is a rounded body: it is as wide in a band as an ellipse of its
 * width and depth is at the band's nearest height.
 */
function reachIn(patch: FramePatch, low: number, high: number, c: number, s: number): number {
	const off = Math.max(0, low - patch.centre[1], patch.centre[1] - high);
	const share = off / Math.max(1e-9, patch.depth / 2);
	if (share >= 1) return 0;
	return (
		patch.centre[0] * c + patch.centre[2] * s + (patch.width / 2) * Math.sqrt(1 - share * share)
	);
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
			for (const patch of plan.patches) built = Math.max(built, reachIn(patch, low, high, c, s));
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

/** A band of a crown, on one side, that does not hold the outline its species states. */
export interface CrownFault {
	/** Degrees round the plant that the side faces. */
	readonly side: number;
	/** The band's number from the ground, and its middle height as a share of the plant's height. */
	readonly band: number;
	readonly height: number;
	/**
	 * What is wrong: the patches' reach is under or over the outline's, the patches leave too much
	 * of the band's height empty, or they cover too little of the side's arc.
	 */
	readonly kind: 'reach' | 'height' | 'arc';
	/** The figure that fails: the reach over the stated one, or the share covered. */
	readonly fill: number;
}

/** The bounds a crown's bands are held to. */
export interface CrownBounds {
	/** The sides read, evenly round the plant, and the bands from the ground to the stated height. */
	readonly sides: number;
	readonly bands: number;
	/** The least and the most of the stated outline that a band's patches may reach. */
	readonly least: number;
	readonly most: number;
	/** The least share of a band's height, and of a side's arc, that its patches must cover. */
	readonly tall: number;
	readonly arc: number;
}

/**
 * The bounds a frame's test holds a crown to.
 *
 * @category api/vegetation
 */
export const CROWN_BOUNDS: CrownBounds = {
	sides: 8,
	bands: 16,
	least: 0.6,
	most: 1.2,
	tall: 0.7,
	arc: 0.5,
};

/** The foliage of a plant: its patches, at the plant's height. A frame is one; so is a made crown. */
export type Crown = Pick<FramePlan, 'scale' | 'patches'>;

/**
 * The bands of a crown that do not hold the outline its species states. Each side is a sector
 * round the plant, and only the patches that stand in the sector count for it, so a patch to one
 * side cannot fill in a side that is missing. Every band from the outline's foot to its top is
 * read. A band on a side is a fault when the patches' reach there is under the least share of the
 * outline or over the most; when the patches leave more of the band's height empty than they may,
 * as flat discs with sky between them do; or when they cover less of the sector's arc than they
 * must, as a few small patches on the outline do.
 *
 * @param crown The frame, or any set of patches at a stated height.
 * @param spec The species' frame.
 * @param bounds The bounds; the test's own where left out.
 * @returns The faults, side by side from the lowest band.
 * @category api/vegetation
 */
export function crownFaults(
	crown: Crown,
	spec: FrameSpec,
	bounds: CrownBounds = CROWN_BOUNDS,
): CrownFault[] {
	const out: CrownFault[] = [];
	const { foot, top } = outlineSpan(spec);
	const sector = PI / bounds.sides;
	// A reach this far under or over its bound is inside the measure's own grain.
	const grain = 0.01 * crown.scale;
	for (let side = 0; side < bounds.sides; side++) {
		const angle = (side * 2 * PI) / bounds.sides;
		const c = cos(angle);
		const s = sin(angle);
		// The patches that stand in the side's sector, each with the arc it covers there.
		const own: { patch: FramePatch; from: number; to: number }[] = [];
		for (const patch of crown.patches) {
			const away = Math.sqrt(patch.centre[0] * patch.centre[0] + patch.centre[2] * patch.centre[2]);
			// A patch over the trunk's line stands in every sector, across all of it.
			if (away <= patch.width / 2) {
				own.push({ patch, from: -sector, to: sector });
				continue;
			}
			let off = atan2(patch.centre[2], patch.centre[0]) - angle;
			off = ((((off + PI) % (2 * PI)) + 2 * PI) % (2 * PI)) - PI;
			const half = asin(Math.min(1, patch.width / 2 / away));
			if (off + half < -sector || off - half > sector) continue;
			own.push({ patch, from: Math.max(-sector, off - half), to: Math.min(sector, off + half) });
		}
		for (let band = 0; band < bounds.bands; band++) {
			const height = (band + 0.5) / bounds.bands;
			if (height < foot || height > top) continue;
			const low = (band / bounds.bands) * crown.scale;
			const high = ((band + 1) / bounds.bands) * crown.scale;
			const stated = outlineRadius(spec, crown.scale, (low + high) / 2, angle);
			if (stated <= 0) continue;
			let built = 0;
			const tall: [number, number][] = [];
			const round: [number, number][] = [];
			for (const { patch, from, to } of own) {
				const under = patch.centre[1] - patch.depth / 2;
				const over = patch.centre[1] + patch.depth / 2;
				if (over <= low || under >= high) continue;
				built = Math.max(built, reachIn(patch, low, high, c, s));
				tall.push([Math.max(low, under), Math.min(high, over)]);
				round.push([from, to]);
			}
			const fault = (kind: CrownFault['kind'], fill: number): void => {
				out.push({ side: (side * 360) / bounds.sides, band, height, kind, fill });
			};
			if (built < bounds.least * stated - grain || built > bounds.most * stated + grain)
				fault('reach', built / stated);
			const filled = covered(tall) / (high - low);
			if (filled < bounds.tall) fault('height', filled);
			const swept = covered(round) / (2 * sector);
			if (swept < bounds.arc) fault('arc', swept);
		}
	}
	return out;
}

/** The length of a line that a set of stretches covers, each given by its two ends. */
function covered(stretches: [number, number][]): number {
	stretches.sort((a, b) => a[0] - b[0]);
	let total = 0;
	let end = Number.NEGATIVE_INFINITY;
	for (const [from, to] of stretches) {
		if (to <= end) continue;
		total += to - Math.max(from, end);
		end = to;
	}
	return total;
}

/** The depth under a boundary, as a share of the height, that is the arithmetic's own grain. */
const ON_BOUNDARY = 1e-9;

/** A foliage patch that a view shows under the crown's lower boundary. */
export interface UnderFault {
	/** Degrees round the plant that the side faces whose boundary the patch stands under. */
	readonly side: number;
	readonly patch: FramePatch;
	/** The patch's distance from the trunk's line in the view, as a share of the plant's height. */
	readonly reach: number;
	/** How far its foot stands under the boundary, as a share of the plant's height. */
	readonly by: number;
}

/**
 * The foliage patches of a crown that stand under the lower boundary its species states. Each
 * stated side is read as the view that looks across it shows it: a patch stands as far from the
 * trunk's line as its centre does along the side's direction, whatever its depth in the view, and
 * it is under the boundary when its rounded body's foot is lower than the boundary there. So a
 * patch that hangs in front of the bole is read against the boundary at the bole.
 *
 * @param crown The frame, or any set of patches at a stated height.
 * @param spec The species' frame.
 * @param within The distance from the trunk's line, as a share of the plant's height, that the
 * patches read stand inside.
 * @param slack The depth under the boundary that is not counted, as a share of the height.
 * @returns How many patches were read over all the sides, and those under a side's boundary.
 * @category api/vegetation
 */
export function underBoundary(
	crown: Crown,
	spec: FrameSpec,
	within = Number.POSITIVE_INFINITY,
	slack = 0,
): { readonly read: number; readonly under: UnderFault[] } {
	let read = 0;
	const under: UnderFault[] = [];
	for (const side of spec.outline) {
		const toward = radians(side.toward);
		const c = cos(toward);
		const s = sin(toward);
		for (const patch of crown.patches) {
			const reach = (patch.centre[0] * c + patch.centre[2] * s) / crown.scale;
			if (reach < 0 || reach > within) continue;
			read++;
			const by = curveAt(side.under, reach) - (patch.centre[1] - patch.depth / 2) / crown.scale;
			// A foot that stands on the boundary is not under it, whatever the last digit says.
			if (by > slack + ON_BOUNDARY) under.push({ side: side.toward, patch, reach, by });
		}
	}
	return { read, under };
}

/** The rays a crown's rim is read along, over the half turn above its base. */
const RIM_RAYS = 361;
/** The rays to each side that a ray takes its farthest reach from, so a thin gap is no notch. */
const RIM_WINDOW = 3;

/**
 * The lumps of a crown's rim in a view from one side, read as the species' reference figures read
 * a photograph's. Rays leave the trunk's line at the crown's base over the half turn above it, and
 * each takes the farthest foliage it meets. A notch is a place where that edge falls inside the
 * edge's convex hull by a set share of the crown's size, the square root of the hull's area, and
 * stands that far above the saddles that join it to deeper notches. A lump is the edge between two
 * notches, so a convex crown is one lump however wide it is.
 *
 * @param crown The frame, or any set of patches at a stated height.
 * @param turn The degrees round the plant the view looks from: 0 looks along -Z with +X to its
 * right.
 * @param base The height of the crown's base, as a share of the plant's height.
 * @param least The least depth of a notch, as a share of the crown's size.
 * @returns The lumps' count and each notch's depth, deepest first.
 * @category api/vegetation
 */
export function rimLumps(
	crown: Crown,
	turn: number,
	base: number,
	least = 0.04,
): { readonly count: number; readonly notches: number[] } {
	const facing = radians(turn);
	const rightX = cos(facing);
	const rightZ = -sin(facing);
	const floor = base * crown.scale;
	// Each patch as the view shows it: an ellipse of its width and depth about its centre.
	const seen = crown.patches.map((patch) => ({
		x: patch.centre[0] * rightX + patch.centre[2] * rightZ,
		y: patch.centre[1] - floor,
		a: Math.max(1e-6, patch.width / 2),
		b: Math.max(1e-6, patch.depth / 2),
	}));
	const reach = new Float64Array(RIM_RAYS);
	const angleOf = (ray: number): number => (PI * ray) / (RIM_RAYS - 1);
	for (let ray = 0; ray < RIM_RAYS; ray++) {
		const c = cos(angleOf(ray));
		const s = sin(angleOf(ray));
		let far = 0;
		for (const { x, y, a, b } of seen) {
			// Where the ray leaves the ellipse: the greater root of the ray's run through it.
			const p = (c * c) / (a * a) + (s * s) / (b * b);
			const q = (c * x) / (a * a) + (s * y) / (b * b);
			const r = (x * x) / (a * a) + (y * y) / (b * b) - 1;
			const inside = q * q - p * r;
			if (inside < 0) continue;
			far = Math.max(far, (q + Math.sqrt(inside)) / p);
		}
		reach[ray] = far;
	}
	const edge: [number, number][] = [];
	for (let ray = 0; ray < RIM_RAYS; ray++) {
		let most = 0;
		for (let k = Math.max(0, ray - RIM_WINDOW); k <= Math.min(RIM_RAYS - 1, ray + RIM_WINDOW); k++)
			most = Math.max(most, reach[k] as number);
		edge.push([most * cos(angleOf(ray)), most * sin(angleOf(ray))]);
	}
	const hull = convexHull([[0, 0], ...edge]);
	let twice = 0;
	hull.forEach((p, h) => {
		const q = hull[(h + 1) % hull.length] as [number, number];
		twice += p[0] * q[1] - q[0] * p[1];
	});
	const size = Math.sqrt(Math.abs(twice) / 2);
	if (!(size > 0) || hull.length < 3) return { count: 1, notches: [] };
	// A point's depth is its distance to the nearest side of the hull, over the crown's size.
	const depth = edge.map(([px, py]) => {
		let nearest = Number.POSITIVE_INFINITY;
		hull.forEach((p, h) => {
			const q = hull[(h + 1) % hull.length] as [number, number];
			const ex = q[0] - p[0];
			const ey = q[1] - p[1];
			const along = Math.max(
				0,
				Math.min(1, ((px - p[0]) * ex + (py - p[1]) * ey) / (ex * ex + ey * ey || 1)),
			);
			const dx = px - p[0] - along * ex;
			const dy = py - p[1] - along * ey;
			nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
		});
		return nearest / size;
	});
	const notches = peaks(depth, least)
		.map((at) => depth[at] as number)
		.sort((a, b) => b - a);
	return { count: notches.length + 1, notches };
}

/** The convex hull of a set of points, in order round it. */
function convexHull(points: readonly [number, number][]): [number, number][] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: [number, number][]): [number, number][] => {
		const out: [number, number][] = [];
		for (const p of list) {
			while (
				out.length >= 2 &&
				cross(
					out[out.length - 2] as [number, number],
					out[out.length - 1] as [number, number],
					p,
				) <= 0
			)
				out.pop();
			out.push(p);
		}
		out.pop();
		return out;
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The peaks of a profile that stand at least a stated height above the saddle that joins each to a
 * higher peak, or above the profile's ends where it is the highest. A level stretch is one peak.
 */
function peaks(profile: readonly number[], least: number): number[] {
	const found: number[] = [];
	const n = profile.length;
	for (let i = 0; i < n; i++) {
		const d = profile[i] as number;
		if (d < least) continue;
		if (i > 0 && (profile[i - 1] as number) >= d) continue;
		let end = i;
		while (end + 1 < n && profile[end + 1] === d) end++;
		if (end + 1 < n && (profile[end + 1] as number) > d) continue;
		let leftLow = d;
		let leftHigher = false;
		for (let k = i - 1; k >= 0; k--) {
			const v = profile[k] as number;
			if (v > d) {
				leftHigher = true;
				break;
			}
			leftLow = Math.min(leftLow, v);
		}
		let rightLow = d;
		let rightHigher = false;
		for (let k = end + 1; k < n; k++) {
			const v = profile[k] as number;
			if (v >= d) {
				rightHigher = true;
				break;
			}
			rightLow = Math.min(rightLow, v);
		}
		if (!leftHigher) leftLow = Math.min(leftLow, 0);
		if (!rightHigher) rightLow = Math.min(rightLow, 0);
		if (d - Math.max(leftLow, rightLow) >= least) found.push((i + end) >> 1);
	}
	return found;
}

/**
 * The pairs of a frame's axes whose wood passes through each other: two axes, neither grown from
 * the other, with a node of each nearer than the sum of the two radii. Two axes that leave one
 * parent are read past their first fifth, since they stand together where they leave.
 *
 * @param plan The frame.
 * @returns The pairs, each as the two axes' indices.
 * @category api/vegetation
 */
export function woodThrough(plan: FramePlan): [number, number][] {
	const out: [number, number][] = [];
	const count = plan.axes.length;
	/** Each axis's forebears, itself among them. */
	const lines = plan.axes.map((_, index) => {
		const line = new Set<number>();
		for (let up = index; up >= 0; up = (plan.axes[up] as FrameAxis).parent) line.add(up);
		return line;
	});
	// A box round each axis's wood, so two axes far apart are not read node by node.
	const boxes = plan.axes.map((axis) => {
		const box = [
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		];
		for (const node of axis.nodes) {
			box[0] = Math.min(box[0] as number, node.x - node.radius);
			box[1] = Math.min(box[1] as number, node.y - node.radius);
			box[2] = Math.min(box[2] as number, node.z - node.radius);
			box[3] = Math.max(box[3] as number, node.x + node.radius);
			box[4] = Math.max(box[4] as number, node.y + node.radius);
			box[5] = Math.max(box[5] as number, node.z + node.radius);
		}
		return box;
	});
	for (let i = 0; i < count; i++)
		for (let j = i + 1; j < count; j++) {
			if ((lines[i] as Set<number>).has(j) || (lines[j] as Set<number>).has(i)) continue;
			const p = boxes[i] as number[];
			const q = boxes[j] as number[];
			if (
				(p[0] as number) > (q[3] as number) ||
				(q[0] as number) > (p[3] as number) ||
				(p[1] as number) > (q[4] as number) ||
				(q[1] as number) > (p[4] as number) ||
				(p[2] as number) > (q[5] as number) ||
				(q[2] as number) > (p[5] as number)
			)
				continue;
			const a = plan.axes[i] as FrameAxis;
			const b = plan.axes[j] as FrameAxis;
			const siblings = a.parent === b.parent;
			let through = false;
			for (let k = 0; k < a.nodes.length && !through; k++) {
				if (siblings && (a.along[k] as number) < 0.2) continue;
				const one = a.nodes[k] as FrameNode;
				for (let m = 0; m < b.nodes.length; m++) {
					if (siblings && (b.along[m] as number) < 0.2) continue;
					const other = b.nodes[m] as FrameNode;
					const reach = one.radius + other.radius;
					const dx = one.x - other.x;
					const dy = one.y - other.y;
					const dz = one.z - other.z;
					if (dx * dx + dy * dy + dz * dz < reach * reach) {
						through = true;
						break;
					}
				}
			}
			if (through) out.push([i, j]);
		}
	return out;
}
