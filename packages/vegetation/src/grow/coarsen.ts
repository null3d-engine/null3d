// A coarser plant from a grown one: fewer of the finest branches, and with them their bud sites. The
// finest order's axes go first, the deepest inside the crown first: each axis's nearest approach to
// the crown's hull, which its own nodes outline. The twigs that stand back from the outline hide
// behind the outer shell, so the plant keeps its silhouette while they go. Among twigs equally deep,
// the dimmest go first, by the light each holds per node, as a self-organizing plant sheds its
// branches. An axis takes its own side axes with it. The pruning runs on the finished skeleton, so
// the wood that stays keeps its place, its pose under the full load and its pipe radii. A dressed
// plant's bare wood can be trimmed the same way once its shoots stand: the thin branches that bear
// no shoot, and the thin bare ends past a branch's last shoot.
import { type MacroSkeleton, NODE_STUB, SkeletonBuilder } from '../core/graph';
import { asin, atan2, PI } from '../core/math';

/** Bins of the crown's hull: steps of elevation from straight down to straight up, and of azimuth. */
const ELEVATIONS = 12;
const AZIMUTHS = 24;

/** The share of the finest order's axes that the coarsest plant prunes. */
export const PRUNE_MOST = 0.3;

/**
 * The skeleton with a share of the finest order's axes pruned, the deepest inside the crown
 * first, by the share that the coarseness asks for. A coarseness of 0 returns the skeleton itself.
 *
 * @param skeleton The grown skeleton.
 * @param coarseness From 0, the plant as grown, to 1, the coarsest.
 * @returns The coarser skeleton.
 */
export function coarsenSkeleton(skeleton: MacroSkeleton, coarseness: number): MacroSkeleton {
	if (coarseness <= 0) return skeleton;
	const { axes } = skeleton;
	let finest = 0;
	for (let a = 0; a < axes.count; a++)
		if ((axes.parent[a] as number) >= 0) finest = Math.max(finest, axes.order[a] as number);
	if (finest === 0) return skeleton;

	// Light, nodes and the nearest approach to the crown's outline of each axis with every axis it
	// carries; a child always follows its parent.
	const depth = hullDepth(skeleton);
	const light = new Float64Array(axes.count);
	const nodes = new Float64Array(axes.count);
	const inside = new Float64Array(axes.count).fill(Number.POSITIVE_INFINITY);
	for (let a = 0; a < axes.count; a++)
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
			light[a] = (light[a] as number) + (skeleton.light[n] as number);
			nodes[a] = (nodes[a] as number) + 1;
			inside[a] = Math.min(inside[a] as number, depth[n] as number);
		}
	const children: number[][] = [];
	for (let a = 0; a < axes.count; a++) children.push([]);
	for (let a = axes.count - 1; a >= 0; a--) {
		const parent = axes.parent[a] as number;
		if (parent < 0) continue;
		light[parent] = (light[parent] as number) + (light[a] as number);
		nodes[parent] = (nodes[parent] as number) + (nodes[a] as number);
		inside[parent] = Math.min(inside[parent] as number, inside[a] as number);
		children[parent]?.push(a);
	}
	const candidates: number[] = [];
	for (let a = 0; a < axes.count; a++)
		if ((axes.parent[a] as number) >= 0 && axes.order[a] === finest) candidates.push(a);
	const dim = (a: number) => (light[a] as number) / Math.max(1, nodes[a] as number);
	candidates.sort(
		(a, b) => (inside[b] as number) - (inside[a] as number) || dim(a) - dim(b) || a - b,
	);

	// Prune the deepest first, each with the axes it carries, until the share is gone.
	const pruned = new Uint8Array(axes.count);
	const goal = Math.round(Math.min(1, coarseness) * PRUNE_MOST * candidates.length);
	let removed = 0;
	const stack: number[] = [];
	for (const a of candidates) {
		if (removed >= goal) break;
		if (pruned[a]) continue;
		stack.push(a);
		while (stack.length > 0) {
			const b = stack.pop() as number;
			if (pruned[b]) continue;
			pruned[b] = 1;
			if (axes.order[b] === finest) removed++;
			for (const c of children[b] ?? []) stack.push(c);
		}
	}
	if (removed === 0) return skeleton;
	const keepTo = new Int32Array(axes.count);
	for (let a = 0; a < axes.count; a++) keepTo[a] = pruned[a] ? -1 : (axes.last[a] as number);
	return keptSkeleton(skeleton, keepTo, skeleton.crownBase).skeleton;
}

/**
 * The skeleton with the thin wood that bears no shoot trimmed away: each branch keeps its wood
 * thicker than the limit and its wood up to the last node that bears a row or carries a branch that
 * stays, and loses the rest; a branch left with nothing goes. A stem and a dead stub stay whole, and
 * the wood that stays keeps its place and its radii.
 *
 * @param skeleton The skeleton the rows stand on.
 * @param nodes The node of each row's bud.
 * @param axes The axis of each row's bud, which keeps the row's wind record.
 * @param limit The thickest radius trimmed, in metres.
 * @param crownBase The height the trimmed skeleton's crown stands on, in metres.
 * @returns The trimmed skeleton and each axis's index in it, -1 for an axis that went; undefined
 *   when no wood goes.
 */
export function bareTrimmed(
	skeleton: MacroSkeleton,
	nodes: readonly number[],
	axes: readonly number[],
	limit: number,
	crownBase: number,
): { skeleton: MacroSkeleton; axisOut: Int32Array } | undefined {
	const { axisOf, radius, flags } = skeleton;
	const table = skeleton.axes;
	// The farthest node of each axis that a row stands on.
	const keepTo = new Int32Array(table.count).fill(-1);
	for (const node of nodes) {
		const a = axisOf[node] as number;
		if (node > (keepTo[a] as number)) keepTo[a] = node;
	}
	for (const a of axes) keepTo[a] = Math.max(keepTo[a] as number, table.first[a] as number);
	// A child follows its parent, so a backward pass settles each branch before the axis it leaves.
	let trimmed = false;
	for (let a = table.count - 1; a >= 0; a--) {
		const first = table.first[a] as number;
		const last = table.last[a] as number;
		const parent = table.parent[a] as number;
		let keep = keepTo[a] as number;
		if (parent < 0 || ((flags[first] as number) & NODE_STUB) !== 0) keep = last;
		else {
			// The radius falls along an axis, so its thick wood is a run from its base.
			let thick = first - 1;
			while (thick < last && (radius[thick + 1] as number) > limit) thick++;
			keep = Math.max(keep, thick);
			if (keep < first) keep = -1;
		}
		if (keep !== last) trimmed = true;
		keepTo[a] = keep;
		if (keep >= 0 && parent >= 0) {
			const from = table.parentNode[a] as number;
			if (from > (keepTo[parent] as number)) keepTo[parent] = from;
		}
	}
	return trimmed ? keptSkeleton(skeleton, keepTo, crownBase) : undefined;
}

/**
 * How far each node lies inside the crown's hull, in metres: the hull's reach from the crown's
 * centre in the node's direction, less the node's own distance. The hull's reach in a direction is
 * the farthest node in its bin of elevation and azimuth and the bins round it.
 */
function hullDepth(skeleton: MacroSkeleton): Float64Array {
	const { min, max } = skeleton.bounds;
	const cx = (min[0] + max[0]) / 2;
	const cy = (skeleton.crownBase + skeleton.height) / 2;
	const cz = (min[2] + max[2]) / 2;
	const p = skeleton.position;
	const count = skeleton.nodeCount;
	const bin = new Int32Array(count);
	const distance = new Float64Array(count);
	const reach = new Float64Array(ELEVATIONS * AZIMUTHS);
	for (let n = 0; n < count; n++) {
		const dx = (p[n * 3] as number) - cx;
		const dy = (p[n * 3 + 1] as number) - cy;
		const dz = (p[n * 3 + 2] as number) - cz;
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
		const up = d > 0 ? asin(Math.max(-1, Math.min(1, dy / d))) : 0;
		const e = Math.min(ELEVATIONS - 1, Math.floor(((up + PI / 2) / PI) * ELEVATIONS));
		const around = atan2(dz, dx) + PI;
		const a = Math.min(AZIMUTHS - 1, Math.floor((around / (2 * PI)) * AZIMUTHS));
		bin[n] = e * AZIMUTHS + a;
		distance[n] = d;
		reach[e * AZIMUTHS + a] = Math.max(reach[e * AZIMUTHS + a] as number, d);
	}
	const hull = new Float64Array(ELEVATIONS * AZIMUTHS);
	for (let e = 0; e < ELEVATIONS; e++)
		for (let a = 0; a < AZIMUTHS; a++) {
			let most = 0;
			for (let de = -1; de <= 1; de++) {
				const ee = e + de;
				if (ee < 0 || ee >= ELEVATIONS) continue;
				for (let da = -1; da <= 1; da++)
					most = Math.max(most, reach[ee * AZIMUTHS + ((a + da + AZIMUTHS) % AZIMUTHS)] as number);
			}
			hull[e * AZIMUTHS + a] = most;
		}
	const depth = new Float64Array(count);
	for (let n = 0; n < count; n++)
		depth[n] = (hull[bin[n] as number] as number) - (distance[n] as number);
	return depth;
}

/**
 * The skeleton with each axis kept from its base to a node, or not at all where that node is -1,
 * with the bud sites on the kept nodes, in the same order, standing on a crown base; and each
 * axis's index in it.
 */
function keptSkeleton(
	skeleton: MacroSkeleton,
	keepTo: Int32Array,
	crownBase: number,
): { skeleton: MacroSkeleton; axisOut: Int32Array } {
	const { axes, buds } = skeleton;
	const builder = new SkeletonBuilder();
	const axisOut = new Int32Array(axes.count).fill(-1);
	const nodeOut = new Int32Array(skeleton.nodeCount).fill(-1);
	for (let a = 0; a < axes.count; a++) {
		const end = keepTo[a] as number;
		if (end < 0) continue;
		const parent = axes.parent[a] as number;
		const parentNode = axes.parentNode[a] as number;
		axisOut[a] = builder.addAxis({
			parent: parent >= 0 ? (axisOut[parent] as number) : -1,
			parentNode: parentNode >= 0 ? (nodeOut[parentNode] as number) : -1,
			parentT: axes.parentT[a] as number,
			order: axes.order[a] as number,
			kind: axes.kind[a] as number,
			barkV: axes.barkV[a] as number,
			barkU: axes.barkU[a] as number,
			cutFrom: axes.cutFrom[a] as number,
			cutTo: axes.cutTo[a] as number,
			grownBark: (axes.grownBark[a] as number) === 1,
		});
		for (let n = axes.first[a] as number; n <= end; n++) {
			const p = skeleton.parent[n] as number;
			nodeOut[n] = builder.addNode({
				x: skeleton.position[n * 3] as number,
				y: skeleton.position[n * 3 + 1] as number,
				z: skeleton.position[n * 3 + 2] as number,
				radius: skeleton.radius[n] as number,
				parent: p >= 0 ? (nodeOut[p] as number) : -1,
				axis: axisOut[a] as number,
				light: skeleton.light[n] as number,
				age: skeleton.age[n] as number,
				flags: skeleton.flags[n] as number,
			});
		}
	}
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if ((axisOut[axis] as number) < 0 || (nodeOut[buds.node[b] as number] as number) < 0) continue;
		builder.addBud({
			node: nodeOut[buds.node[b] as number] as number,
			x: buds.position[b * 3] as number,
			y: buds.position[b * 3 + 1] as number,
			z: buds.position[b * 3 + 2] as number,
			frame: buds.frame.subarray(b * 4, b * 4 + 4),
			kind: buds.kind[b] as number,
			vigor: buds.vigor[b] as number,
			light: buds.light[b] as number,
			axis: axisOut[axis] as number,
			woodRadius: buds.woodRadius[b] as number,
		});
	}
	return { skeleton: builder.finish(crownBase), axisOut };
}
