// A dressed plant's bare wood can be trimmed once its shoots stand: the thin branches that bear no
// shoot, and the thin bare ends past a branch's last shoot. The wood that stays keeps its place,
// its pose under the full load and its pipe radii.
import { type MacroSkeleton, NODE_STUB, SkeletonBuilder } from '../core/graph';

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
 * @param full Whether every branch end is cut at its last shoot, whatever the wood's girth there.
 * @returns The trimmed skeleton and each axis's and node's index in it, -1 for one that went;
 *   undefined when no wood goes.
 */
export function bareTrimmed(
	skeleton: MacroSkeleton,
	nodes: readonly number[],
	axes: readonly number[],
	limit: number,
	crownBase: number,
	full = false,
): KeptSkeleton | undefined {
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
			if (full) {
				// The branch ends at its last shoot, whatever the wood's girth there, so no end stands bare.
				keep = keepTo[a] as number;
			} else {
				// The radius falls along an axis, so its thick wood is a run from its base.
				let thick = first - 1;
				while (thick < last && (radius[thick + 1] as number) > limit) thick++;
				keep = Math.max(keep, thick);
			}
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

/** A skeleton with some of its wood removed, and where each axis and node of the first went. */
export interface KeptSkeleton {
	/** The skeleton that stays. */
	readonly skeleton: MacroSkeleton;
	/** Each axis's index in it, -1 for an axis that went. */
	readonly axisOut: Int32Array;
	/** Each node's index in it, -1 for a node that went. */
	readonly nodeOut: Int32Array;
	/** Each bud site's index in it, -1 for a site that went. */
	readonly budOut: Int32Array;
}

/**
 * The skeleton with each axis kept from its base to a node, or not at all where that node is -1,
 * with the bud sites on the kept nodes, in the same order and with their sockets, standing on a
 * crown base. An axis is kept
 * only where its parent keeps the node it leaves.
 *
 * @param skeleton The skeleton.
 * @param keepTo The last node kept of each axis, or -1 for an axis that goes.
 * @param crownBase The height the kept skeleton's crown stands on, in metres.
 * @param budKept One flag per bud site, 1 for a site that stays; every site on a kept node stays
 *   where it is absent.
 * @returns The kept skeleton, and each axis's and node's index in it.
 */
export function keptSkeleton(
	skeleton: MacroSkeleton,
	keepTo: Int32Array,
	crownBase: number,
	budKept?: Uint8Array,
): KeptSkeleton {
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
	const budOut = new Int32Array(buds.count).fill(-1);
	let kept = 0;
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if ((axisOut[axis] as number) < 0 || (nodeOut[buds.node[b] as number] as number) < 0) continue;
		if (budKept && budKept[b] !== 1) continue;
		budOut[b] = kept++;
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
			...(buds.sockets
				? {
						socket: {
							scale: buds.sockets.scale[b] as number,
							rank: buds.sockets.rank[b] as number,
							lobe: buds.sockets.lobe[b] as number,
							...(buds.sockets.piece ? { piece: buds.sockets.piece[b] as number } : {}),
						},
					}
				: {}),
		});
	}
	return { skeleton: builder.finish(crownBase), axisOut, nodeOut, budOut };
}
