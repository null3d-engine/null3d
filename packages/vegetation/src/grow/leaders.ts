// Sympodial leaders: an axis carries on along whichever of its shoots is thickest. A grown axis is
// the chain of nodes one bud made, but where the bud weakened and a side branch took the light, the
// pipe model gives the axis's own continuation a few twigs' girth and the side branch the trunk's.
// Meshed as grown, the axis would end in a cone with its great limb stuck on its side. This pass
// hands each axis on to a child where its own next node has collapsed to well under the child's
// girth and its own tail reaches less far than the child, as a tree's wood runs on into the larger
// limb of a fork, and the old continuation becomes the side branch. Wood runs on only into a child
// that carries on near the axis's own line, and never so that the axis turns back on the way it
// set out: a fork's steep limb stays a limb, and hand-ons cannot chain into a loop. A stem may run
// on into a steeper limb, as a tree's leader is taken over by a side shoot that then turns upright:
// the limb's first internodes turn toward the stem's line, so the bole bends into its main limb a
// little at each node instead of at once, and all that grows from them moves with them.
import { type MacroSkeleton, SkeletonBuilder } from '../core/graph';

/** A child takes the lead when it is at least this share of its parent's girth at the junction. */
const LEADER_SHARE = 0.5;
/**
 * And when its parent's own next node is under this share of the child's girth: the parent's
 * continuation has collapsed to a branch, not merely thinned below a strong limb.
 */
const COLLAPSE = 0.6;
/** The cosine of the most a child may turn from the axis's line where the wood runs on into it. */
const RUN_ON = Math.cos((40 * Math.PI) / 180);
/** The cosine of the most an axis may turn, over all its hand-ons, from the way it set out. */
const SET_OUT = 0;
/** The cosine of the most a stem's main limb may leave its line, before it turns upright. */
const STEM_RUN_ON = Math.cos((70 * Math.PI) / 180);
/** Radians the bole may bend at each node where it runs on into a steeper limb. */
const UPRIGHT = (20 * Math.PI) / 180;

/**
 * A stem run on into a steep limb: the node before the fork, whose internode into the fork gives the
 * stem's line, the node the limb leaves, and the limb's nodes.
 */
interface Relay {
	readonly before: number;
	readonly node: number;
	readonly nodes: readonly number[];
}

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
	const relays: Relay[] = [];
	for (let a = 0; a < count; a++) {
		const stem = (axes.order[a] as number) === 0;
		const chain = nodesOf[a] as number[];
		if (chain.length < 2) continue;
		// The way the axis set out: from the node it leaves, or its first node, to its next.
		const from = axes.parentNode[a] as number;
		const setOut = direction(
			skeleton,
			from >= 0 ? from : (chain[0] as number),
			chain[from >= 0 ? 0 : 1] as number,
		);
		for (let i = 0; i < chain.length - 1; i++) {
			const node = chain[i] as number;
			const next = radius[chain[i + 1] as number] as number;
			const girth = radius[node] as number;
			let best = -1;
			let bestRadius = next / COLLAPSE;
			// How far the axis's own tail reaches from here: a leader that thins but runs on to the
			// top keeps the lead.
			const tailReach = reach(skeleton, node, chain[chain.length - 1] as number);
			// The axis's line into this node.
			const line = direction(
				skeleton,
				i > 0 ? (chain[i - 1] as number) : from >= 0 ? from : node,
				node,
			);
			for (const child of leaving.get(node) ?? []) {
				const childChain = nodesOf[child] as number[];
				const first = childChain[0];
				if (first === undefined) continue;
				const r = radius[first] as number;
				const farther =
					reach(skeleton, node, childChain[childChain.length - 1] as number) > tailReach;
				const way = direction(skeleton, node, first);
				const runsOn =
					dot(way, line) >= (stem ? STEM_RUN_ON : RUN_ON) && dot(way, setOut) >= SET_OUT;
				if (r > bestRadius && r >= LEADER_SHARE * girth && farther && runsOn) {
					best = child;
					bestRadius = r;
				}
			}
			if (best < 0) continue;
			const firstOfBest = (nodesOf[best] as number[])[0] as number;
			if (stem && dot(direction(skeleton, node, firstOfBest), line) < Math.cos(UPRIGHT))
				relays.push({
					before: i > 0 ? (chain[i - 1] as number) : from >= 0 ? from : node,
					node,
					nodes: [...(nodesOf[best] as number[])],
				});
			// The child's chain carries the axis on; the axis's old tail takes the child's place.
			const tail = chain.splice(i + 1);
			chain.push(...(nodesOf[best] as number[]));
			nodesOf[best] = tail;
			changed = true;
		}
	}
	if (!changed) return skeleton;
	return rebuilt(skeleton, nodesOf, upright(skeleton, relays));
}

/**
 * The node and bud positions with each relay's limb turned upright: from the stem's line, each
 * internode turns toward its own grown direction by at most the upright angle, until it reaches
 * it, and every node that grows from a moved node moves with it.
 */
function upright(
	skeleton: MacroSkeleton,
	relays: readonly Relay[],
): { readonly nodes: Float32Array; readonly buds: Float32Array } {
	const p = new Float32Array(skeleton.position);
	const buds = new Float32Array(skeleton.buds.position);
	if (relays.length === 0) return { nodes: p, buds };
	const { parent, nodeCount } = skeleton;
	for (const relay of relays) {
		const shift = new Float64Array(nodeCount * 3);
		const moved = new Uint8Array(nodeCount);
		// The stem's line into the fork, as earlier relays have moved it.
		let lx = (p[relay.node * 3] as number) - (p[relay.before * 3] as number);
		let ly = (p[relay.node * 3 + 1] as number) - (p[relay.before * 3 + 1] as number);
		let lz = (p[relay.node * 3 + 2] as number) - (p[relay.before * 3 + 2] as number);
		const span = Math.hypot(lx, ly, lz);
		if (span > 0) {
			lx /= span;
			ly /= span;
			lz /= span;
		} else {
			lx = 0;
			ly = 1;
			lz = 0;
		}
		let from = relay.node;
		let fx = p[from * 3] as number;
		let fy = p[from * 3 + 1] as number;
		let fz = p[from * 3 + 2] as number;
		// The direction of the last internode laid down, from the stem's line.
		let ax = lx;
		let ay = ly;
		let az = lz;
		for (const n of relay.nodes) {
			let dx = (p[n * 3] as number) - (p[from * 3] as number);
			let dy = (p[n * 3 + 1] as number) - (p[from * 3 + 1] as number);
			let dz = (p[n * 3 + 2] as number) - (p[from * 3 + 2] as number);
			const length = Math.hypot(dx, dy, dz);
			if (length > 0) {
				dx /= length;
				dy /= length;
				dz /= length;
				const cosine = Math.max(-1, Math.min(1, dx * ax + dy * ay + dz * az));
				if (Math.acos(cosine) > UPRIGHT) {
					// Turn from the last internode toward the grown one by the upright angle.
					let ux = dx - ax * cosine;
					let uy = dy - ay * cosine;
					let uz = dz - az * cosine;
					const across = Math.hypot(ux, uy, uz) || 1;
					ux /= across;
					uy /= across;
					uz /= across;
					dx = ax * Math.cos(UPRIGHT) + ux * Math.sin(UPRIGHT);
					dy = ay * Math.cos(UPRIGHT) + uy * Math.sin(UPRIGHT);
					dz = az * Math.cos(UPRIGHT) + uz * Math.sin(UPRIGHT);
				}
				ax = dx;
				ay = dy;
				az = dz;
			}
			from = n;
			fx += dx * length;
			fy += dy * length;
			fz += dz * length;
			shift[n * 3] = fx - (p[n * 3] as number);
			shift[n * 3 + 1] = fy - (p[n * 3 + 1] as number);
			shift[n * 3 + 2] = fz - (p[n * 3 + 2] as number);
			moved[n] = 1;
		}
		// Parents come before their children, so each node takes its parent's move in one pass.
		for (let n = 0; n < nodeCount; n++) {
			const up = parent[n] as number;
			if (moved[n] || up < 0 || !moved[up]) continue;
			shift[n * 3] = shift[up * 3] as number;
			shift[n * 3 + 1] = shift[up * 3 + 1] as number;
			shift[n * 3 + 2] = shift[up * 3 + 2] as number;
			moved[n] = 1;
		}
		for (let n = 0; n < nodeCount; n++)
			if (moved[n])
				for (let k = 0; k < 3; k++)
					p[n * 3 + k] = (p[n * 3 + k] as number) + (shift[n * 3 + k] as number);
		const budNode = skeleton.buds.node;
		for (let b = 0; b < skeleton.buds.count; b++) {
			const n = budNode[b] as number;
			if (moved[n])
				for (let k = 0; k < 3; k++)
					buds[b * 3 + k] = (buds[b * 3 + k] as number) + (shift[n * 3 + k] as number);
		}
	}
	return { nodes: p, buds };
}

/** The unit direction from one node to another, or straight up where they meet. */
function direction(skeleton: MacroSkeleton, from: number, to: number): [number, number, number] {
	const p = skeleton.position;
	const x = (p[to * 3] as number) - (p[from * 3] as number);
	const y = (p[to * 3 + 1] as number) - (p[from * 3 + 1] as number);
	const z = (p[to * 3 + 2] as number) - (p[from * 3 + 2] as number);
	const length = Math.hypot(x, y, z);
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
	return Math.hypot(
		(p[to * 3] as number) - (p[from * 3] as number),
		(p[to * 3 + 1] as number) - (p[from * 3 + 1] as number),
		(p[to * 3 + 2] as number) - (p[from * 3 + 2] as number),
	);
}

/** The skeleton built again from new chains of its nodes, parents before children. */
function rebuilt(
	skeleton: MacroSkeleton,
	nodesOf: readonly (readonly number[])[],
	positions: { readonly nodes: Float32Array; readonly buds: Float32Array },
): MacroSkeleton {
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
	const p = positions.nodes;
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
			x: positions.buds[b * 3] as number,
			y: positions.buds[b * 3 + 1] as number,
			z: positions.buds[b * 3 + 2] as number,
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
