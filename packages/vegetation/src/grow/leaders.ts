// Sympodial leaders: an axis carries on along whichever of its shoots is thickest. A grown axis is
// the chain of nodes one bud made, but where the bud weakened and a side branch took the light, the
// pipe model gives the axis's own continuation a few twigs' girth and the side branch the trunk's.
// Meshed as grown, the axis would end in a cone with its great limb stuck on its side. This pass
// finds each node where the axis's own next node has collapsed to well under a child's girth.
// Where that child carries on near the axis's line, and its tail reaches farther than the axis's
// own, the wood runs on into it, as a tree's wood runs on into the larger limb of a fork, and the old
// continuation becomes the side branch. Where it leaves steeply, the axis divides there: it ends at
// the node, and its old continuation leaves the node as a new axis beside the thick child, so the
// mesher draws a fork whose leaders rise from the axis's last ring, as a bole divides into its great
// limbs. Wood never runs on so that an axis turns back on the way it set out, so hand-ons cannot
// chain into a loop.
import { AXIS_LIMB, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { cos, length3, radians } from '../core/math';

/** A child takes the lead when it is at least this share of its parent's girth at the junction. */
const LEADER_SHARE = 0.5;
/**
 * And when its parent's own next node is under this share of the child's girth: the parent's
 * continuation has collapsed to a branch, not merely thinned below a strong limb.
 */
const COLLAPSE = 0.7;
/** The cosine of the most a child may turn from the axis's line where the wood runs on into it. */
const RUN_ON = cos(radians(35));
/**
 * A continuation under this share of the axis's girth has withered to a twig: it gives up the lead
 * however far it runs on.
 */
const WITHERED = 0.4;

/** Where each axis of the new chains hangs, and what it is. */
interface AxisOf {
	/** The node it leaves, or −1 for a stem on the ground. */
	readonly from: number;
	readonly parentT: number;
	readonly order: number;
	readonly kind: number;
	readonly barkV: number;
	readonly barkU: number;
}

/**
 * The skeleton with each axis carried on along its thickest shoot, or divided where that shoot
 * leaves steeply. Nodes, bud sites and their data keep their values; axes are renumbered, parents
 * before children, and each keeps its order and kind; an axis split off where another divides takes
 * the next order as a limb. A skeleton with no collapsed continuation is returned as it is.
 *
 * @param skeleton The grown skeleton.
 * @returns The skeleton with its leaders on the thickest shoots.
 */
export function leadOnThickest(skeleton: MacroSkeleton): MacroSkeleton {
	const { axes, radius } = skeleton;
	const count = axes.count;
	const nodesOf: number[][] = [];
	const axisOf: AxisOf[] = [];
	let deepest = 0;
	for (let a = 0; a < count; a++) {
		const chain: number[] = [];
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) chain.push(n);
		nodesOf.push(chain);
		axisOf.push({
			from: (axes.parent[a] as number) < 0 ? -1 : (axes.parentNode[a] as number),
			parentT: axes.parentT[a] as number,
			order: axes.order[a] as number,
			kind: axes.kind[a] as number,
			barkV: axes.barkV[a] as number,
			barkU: axes.barkU[a] as number,
		});
		deepest = Math.max(deepest, axes.order[a] as number);
	}
	// The axes that leave each node, which stay with the node whichever axis it ends up on.
	const leaving = new Map<number, number[]>();
	for (let a = 0; a < count; a++) {
		const from = (axisOf[a] as AxisOf).from;
		if (from < 0) continue;
		const list = leaving.get(from);
		if (list) list.push(a);
		else leaving.set(from, [a]);
	}
	let changed = false;
	// Axes split off later are visited too: their own continuations may collapse in turn.
	for (let a = 0; a < nodesOf.length; a++) {
		const chain = nodesOf[a] as number[];
		if (chain.length < 2) continue;
		const own = axisOf[a] as AxisOf;
		// The way the axis set out: from the node it leaves, or its first node, to its next.
		const setOut = direction(
			skeleton,
			own.from >= 0 ? own.from : (chain[0] as number),
			chain[own.from >= 0 ? 0 : 1] as number,
		);
		for (let i = 0; i < chain.length - 1; i++) {
			const node = chain[i] as number;
			const next = radius[chain[i + 1] as number] as number;
			const girth = radius[node] as number;
			// How far the axis's own tail reaches from here: a leader that thins but runs on to the
			// top keeps the lead, unless it has withered to a twig.
			const tailReach = reach(skeleton, node, chain[chain.length - 1] as number);
			const withered = next < WITHERED * girth;
			// The axis's line into this node.
			const line = direction(
				skeleton,
				i > 0 ? (chain[i - 1] as number) : own.from >= 0 ? own.from : node,
				node,
			);
			let runOn = -1;
			let runOnRadius = next / COLLAPSE;
			let thick = false;
			for (const child of leaving.get(node) ?? []) {
				const childChain = nodesOf[child] as number[];
				const first = childChain[0];
				if (first === undefined) continue;
				const r = radius[first] as number;
				// A continuation that halves its girth at a fork draws as a cone unless the fork is
				// drawn: any child at least as thick as it makes the node divide.
				const collapsed = next < 0.5 * girth;
				if (collapsed ? r <= next : r <= next / COLLAPSE || r < LEADER_SHARE * girth) continue;
				thick = true;
				const farther =
					withered ||
					reach(skeleton, node, childChain[childChain.length - 1] as number) > tailReach;
				const onLine =
					dot(direction(skeleton, node, first), line) >= RUN_ON &&
					staysOut(skeleton, node, childChain, setOut);
				if (farther && onLine && r > runOnRadius) {
					runOn = child;
					runOnRadius = r;
				}
			}
			if (runOn >= 0) {
				// The child's chain carries the axis on; the axis's old tail takes the child's place.
				const tail = chain.splice(i + 1);
				chain.push(...(nodesOf[runOn] as number[]));
				nodesOf[runOn] = tail;
				changed = true;
			} else if (thick) {
				// The axis divides here: its old tail leaves the node as a new axis, beside the thick
				// child, and the axis ends.
				const tail = chain.splice(i + 1);
				const split = nodesOf.length;
				nodesOf.push(tail);
				axisOf.push({
					from: node,
					parentT: 0,
					order: Math.min(deepest, own.order + 1),
					kind: AXIS_LIMB,
					barkV: own.barkV,
					barkU: own.barkU,
				});
				const list = leaving.get(node);
				if (list) list.push(split);
				else leaving.set(node, [split]);
				changed = true;
				break;
			}
		}
	}
	if (!changed) return skeleton;
	return rebuilt(skeleton, nodesOf, axisOf);
}

/** Whether every internode of a chain, from the node it leaves, keeps within a right angle of a way. */
function staysOut(
	skeleton: MacroSkeleton,
	from: number,
	chain: readonly number[],
	way: readonly number[],
): boolean {
	let previous = from;
	for (const node of chain) {
		if (dot(direction(skeleton, previous, node), way) < 0) return false;
		previous = node;
	}
	return true;
}

/** The unit direction from one node to another, or straight up where they meet. */
function direction(skeleton: MacroSkeleton, from: number, to: number): [number, number, number] {
	const p = skeleton.position;
	const x = (p[to * 3] as number) - (p[from * 3] as number);
	const y = (p[to * 3 + 1] as number) - (p[from * 3 + 1] as number);
	const z = (p[to * 3 + 2] as number) - (p[from * 3 + 2] as number);
	const length = length3(x, y, z);
	return length > 0 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/** The dot product of two directions. */
function dot(a: readonly number[], b: readonly number[]): number {
	return (
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number)
	);
}

/** Metres from one node to another. */
function reach(skeleton: MacroSkeleton, from: number, to: number): number {
	const p = skeleton.position;
	return length3(
		(p[to * 3] as number) - (p[from * 3] as number),
		(p[to * 3 + 1] as number) - (p[from * 3 + 1] as number),
		(p[to * 3 + 2] as number) - (p[from * 3 + 2] as number),
	);
}

/** The skeleton built again from new chains of its nodes, parents before children. */
function rebuilt(
	skeleton: MacroSkeleton,
	nodesOf: readonly (readonly number[])[],
	axisOf: readonly AxisOf[],
): MacroSkeleton {
	const { buds } = skeleton;
	const count = nodesOf.length;
	// Each node's axis in the new chains.
	const ownerOf = new Int32Array(skeleton.nodeCount).fill(-1);
	nodesOf.forEach((chain, a) => {
		for (const n of chain) ownerOf[n] = a;
	});
	// A chain hangs on the chain that holds the node it leaves; stems stand on the ground.
	const hangsOn = new Int32Array(count);
	for (let a = 0; a < count; a++) {
		const from = (axisOf[a] as AxisOf).from;
		hangsOn[a] = from < 0 ? -1 : (ownerOf[from] as number);
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
		const meta = axisOf[a] as AxisOf;
		const index = builder.addAxis({
			parent: parent < 0 ? -1 : (newAxis[parent] as number),
			parentNode: parent < 0 ? -1 : (newNode[meta.from] as number),
			parentT: meta.parentT,
			order: meta.order,
			kind: meta.kind,
			barkV: meta.barkV,
			barkU: meta.barkU,
		});
		newAxis[a] = index;
		let previous = parent < 0 ? -1 : (newNode[meta.from] as number);
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
