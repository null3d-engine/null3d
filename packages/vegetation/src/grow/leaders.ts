// Sympodial leaders: an axis carries on along whichever of its shoots is thickest. A grown axis is
// the chain of nodes one bud made, but where the bud weakened and a side branch took the light, the
// pipe model gives the axis's own continuation a few twigs' girth and the side branch the trunk's.
// Meshed as grown, the axis would end in a cone with its great limb stuck on its side. This pass
// hands each axis on to a child where its own next node has collapsed to well under the child's
// girth and its own tail reaches less far than the child, as a tree's wood runs on into the larger
// limb of a fork, and the old continuation becomes the side branch.
import { type MacroSkeleton, SkeletonBuilder } from '../core/graph';

/** A child takes the lead when it is at least this share of its parent's girth at the junction. */
const LEADER_SHARE = 0.5;
/**
 * And when its parent's own next node is under this share of the child's girth: the parent's
 * continuation has collapsed to a branch, not merely thinned below a strong limb.
 */
const COLLAPSE = 0.6;

/**
 * The skeleton with each axis carried on along its thickest shoot. Nodes, bud sites and their data
 * keep their values; axes are renumbered, parents before children, and each keeps its order and
 * kind. A skeleton in which no child is thicker than its parent's continuation is returned as it
 * is.
 *
 * @param skeleton The grown skeleton.
 * @returns The skeleton with its leaders on the thickest shoots.
 */
export function leadOnThickest(skeleton: MacroSkeleton): MacroSkeleton {
	const { axes, radius } = skeleton;
	const count = axes.count;
	const nodesOf: number[][] = [];
	for (let a = 0; a < count; a++) {
		const chain: number[] = [];
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) chain.push(n);
		nodesOf.push(chain);
	}
	// The axes that leave each node, which stay with the node whichever axis it ends up on.
	const leaving = new Map<number, number[]>();
	for (let a = 0; a < count; a++) {
		const from = axes.parentNode[a] as number;
		if ((axes.parent[a] as number) < 0 || from < 0) continue;
		const list = leaving.get(from);
		if (list) list.push(a);
		else leaving.set(from, [a]);
	}
	let changed = false;
	for (let a = 0; a < count; a++) {
		const chain = nodesOf[a] as number[];
		for (let i = 0; i < chain.length - 1; i++) {
			const node = chain[i] as number;
			const next = radius[chain[i + 1] as number] as number;
			const girth = radius[node] as number;
			let best = -1;
			let bestRadius = next / COLLAPSE;
			// How far the axis's own tail reaches from here: a leader that thins but runs on to the
			// top keeps the lead.
			const tailReach = reach(skeleton, node, chain[chain.length - 1] as number);
			for (const child of leaving.get(node) ?? []) {
				const childChain = nodesOf[child] as number[];
				const first = childChain[0];
				if (first === undefined) continue;
				const r = radius[first] as number;
				const farther =
					reach(skeleton, node, childChain[childChain.length - 1] as number) > tailReach;
				if (r > bestRadius && r >= LEADER_SHARE * girth && farther) {
					best = child;
					bestRadius = r;
				}
			}
			if (best < 0) continue;
			// The child's chain carries the axis on; the axis's old tail takes the child's place.
			const tail = chain.splice(i + 1);
			chain.push(...(nodesOf[best] as number[]));
			nodesOf[best] = tail;
			changed = true;
		}
	}
	if (!changed) return skeleton;
	return rebuilt(skeleton, nodesOf);
}

/** Metres from one node to another. */
function reach(skeleton: MacroSkeleton, from: number, to: number): number {
	const p = skeleton.position;
	return Math.hypot(
		(p[to * 3] as number) - (p[from * 3] as number),
		(p[to * 3 + 1] as number) - (p[from * 3 + 1] as number),
		(p[to * 3 + 2] as number) - (p[from * 3 + 2] as number),
	);
}

/** The skeleton built again from new chains of its nodes, parents before children. */
function rebuilt(skeleton: MacroSkeleton, nodesOf: readonly (readonly number[])[]): MacroSkeleton {
	const { axes, buds } = skeleton;
	const count = axes.count;
	// Each node's axis in the new chains.
	const ownerOf = new Int32Array(skeleton.nodeCount).fill(-1);
	nodesOf.forEach((chain, a) => {
		for (const n of chain) ownerOf[n] = a;
	});
	// A chain hangs on the chain that holds the node it leaves; stems stand on the ground.
	const hangsOn = new Int32Array(count);
	for (let a = 0; a < count; a++) {
		const from = axes.parentNode[a] as number;
		hangsOn[a] = (axes.parent[a] as number) < 0 || from < 0 ? -1 : (ownerOf[from] as number);
	}
	const children: number[][] = Array.from({ length: count }, () => []);
	const order: number[] = [];
	for (let a = 0; a < count; a++) {
		const parent = hangsOn[a] as number;
		if (parent < 0) order.push(a);
		else children[parent]?.push(a);
	}
	for (let k = 0; k < order.length; k++)
		for (const child of children[order[k] as number] ?? []) order.push(child);
	const builder = new SkeletonBuilder();
	const newAxis = new Int32Array(count);
	const newNode = new Int32Array(skeleton.nodeCount).fill(-1);
	const p = skeleton.position;
	for (const a of order) {
		const chain = nodesOf[a] as readonly number[];
		if (chain.length === 0) continue;
		const parent = hangsOn[a] as number;
		const from = axes.parentNode[a] as number;
		const index = builder.addAxis({
			parent: parent < 0 ? -1 : (newAxis[parent] as number),
			parentNode: parent < 0 ? -1 : (newNode[from] as number),
			parentT: axes.parentT[a] as number,
			order: axes.order[a] as number,
			kind: axes.kind[a] as number,
			barkV: axes.barkV[a] as number,
			barkU: axes.barkU[a] as number,
		});
		newAxis[a] = index;
		let previous = parent < 0 ? -1 : (newNode[from] as number);
		for (const n of chain) {
			previous = builder.addNode({
				x: p[n * 3] as number,
				y: p[n * 3 + 1] as number,
				z: p[n * 3 + 2] as number,
				radius: skeleton.radius[n] as number,
				parent: previous,
				axis: index,
				light: skeleton.light[n] as number,
				age: skeleton.age[n] as number,
				flags: skeleton.flags[n] as number,
			});
			newNode[n] = previous;
		}
	}
	for (let b = 0; b < buds.count; b++) {
		const node = buds.node[b] as number;
		builder.addBud({
			node: newNode[node] as number,
			x: buds.position[b * 3] as number,
			y: buds.position[b * 3 + 1] as number,
			z: buds.position[b * 3 + 2] as number,
			frame: buds.frame.subarray(b * 4, b * 4 + 4),
			kind: buds.kind[b] as number,
			vigor: buds.vigor[b] as number,
			light: buds.light[b] as number,
			axis: newAxis[ownerOf[node] as number] as number,
			woodRadius: buds.woodRadius[b] as number,
		});
	}
	return builder.finish(skeleton.crownBase);
}
