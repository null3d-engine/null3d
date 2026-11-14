// Branches bending under their own load, then turning up at their tips (Jirasek, Prusinkiewicz and
// Moulia 2000; Stava et al. 2014's gravity bending). At each joint the wood beyond it, with the
// shoots it carries, pulls down on a lever as long as the horizontal reach to its centre of mass,
// against the stiffness of the wood there, which grows with the fourth power of its radius. The
// joint gives by an angle in proportion; reaction wood then turns the outer part of each axis back
// up by a share of the sag its axis took below it, which gives old limbs their S curve. The bends
// are composed from the base out, so a joint carries every bend below it. Wood that the bends would
// carry below a floor rests on it instead, with all the wood beyond it lifted alike.
import { cos, quatRotate, sin } from '../core/math';

/** Cubic metres of wood a live shoot weighs like, with its leaves: about 30 grams. */
const SHOOT_LOAD = 0.00005;
/** The stiffness that sets a bend's angle per unit of load, lever and radius to the fourth. */
const STIFFNESS = 2e-6;
/** The largest bend at one joint, in radians. */
const MOST_BEND = 0.35;

/** The plant's nodes as the bend reads and moves them. */
export interface BendNodes {
	/** Nodes. */
	readonly count: number;
	/** Each node's parent, or -1; parents come before their children. */
	readonly parent: Int32Array;
	/** 1 for each node that stands. */
	readonly live: Uint8Array;
	/** Each node's axis. */
	readonly axisOf: Int32Array;
	/** Positions, moved in place. */
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly z: Float64Array;
	/** Radii in metres. */
	readonly radius: Float64Array;
	/** Live shoots at each node, which load it. */
	readonly shoots: Float64Array;
}

/** Writes the product of two unit quaternions, a then b, into out at an offset. */
function multiply(
	a: Float64Array,
	ai: number,
	bx: number,
	by: number,
	bz: number,
	bw: number,
	out: Float64Array,
	oi: number,
): void {
	const ax = a[ai] as number;
	const ay = a[ai + 1] as number;
	const az = a[ai + 2] as number;
	const aw = a[ai + 3] as number;
	out[oi] = aw * bx + ax * bw + ay * bz - az * by;
	out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
	out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
	out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/**
 * Bends a grown plant under its load, moving its nodes in place.
 *
 * @param nodes The nodes.
 * @param strength The record's bending strength, 0 for none.
 * @param upturn The share of an axis's sag its tip turns back up.
 * @param floor The height in metres that bent wood rests on rather than sinking below; wood grown
 *   lower stays where it grew. None by default.
 * @returns Each node's rotation from its grown pose to its bent one, four numbers a node, so the
 *   caller can turn the directions that hang on the node.
 */
export function bendUnderLoad(
	nodes: BendNodes,
	strength: number,
	upturn: number,
	floor = Number.NEGATIVE_INFINITY,
): Float64Array {
	const { count, parent, live, axisOf, x, y, z, radius, shoots } = nodes;
	const turn = new Float64Array(count * 4);
	for (let n = 0; n < count; n++) turn[n * 4 + 3] = 1;
	if (strength <= 0 || count === 0) return turn;
	// The mass of each node's own internode and shoots, then of everything from it out, and the sums
	// that place that mass's centre.
	const mass = new Float64Array(count);
	const sx = new Float64Array(count);
	const sz = new Float64Array(count);
	const own = new Float64Array(count);
	for (let n = 0; n < count; n++) {
		if (!live[n]) continue;
		const p = parent[n] as number;
		let length = 0;
		if (p >= 0) {
			const dx = (x[n] as number) - (x[p] as number);
			const dy = (y[n] as number) - (y[p] as number);
			const dz = (z[n] as number) - (z[p] as number);
			length = Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
		const r = radius[n] as number;
		own[n] = Math.PI * r * r * length + SHOOT_LOAD * (shoots[n] as number);
	}
	for (let n = count - 1; n >= 0; n--) {
		if (!live[n]) continue;
		const m = own[n] as number;
		mass[n] = (mass[n] as number) + m;
		sx[n] = (sx[n] as number) + m * (x[n] as number);
		sz[n] = (sz[n] as number) + m * (z[n] as number);
		const p = parent[n] as number;
		if (p < 0) continue;
		mass[p] = (mass[p] as number) + (mass[n] as number);
		sx[p] = (sx[p] as number) + (sx[n] as number);
		sz[p] = (sz[p] as number) + (sz[n] as number);
	}
	// The bend at each joint, and the sag its axis has taken up to it.
	const sag = new Float64Array(count);
	const rank = new Float64Array(count);
	const span = new Float64Array(count);
	for (let n = 0; n < count; n++) {
		const p = parent[n] as number;
		rank[n] = p >= 0 && axisOf[p] === axisOf[n] ? (rank[p] as number) + 1 : 0;
	}
	for (let n = count - 1; n >= 0; n--) {
		const p = parent[n] as number;
		span[n] = Math.max(span[n] as number, rank[n] as number);
		if (p >= 0 && axisOf[p] === axisOf[n]) span[p] = Math.max(span[p] as number, span[n] as number);
	}
	const px = new Float64Array(count);
	const py = new Float64Array(count);
	const pz = new Float64Array(count);
	const v: [number, number, number] = [0, 0, 0];
	for (let n = 0; n < count; n++) {
		px[n] = x[n] as number;
		py[n] = y[n] as number;
		pz[n] = z[n] as number;
		if (!live[n]) continue;
		const p = parent[n] as number;
		if (p >= 0) {
			// The node's place: its parent's bent place, plus its own offset turned by every bend below.
			v[0] = (x[n] as number) - (px[p] as number);
			v[1] = (y[n] as number) - (py[p] as number);
			v[2] = (z[n] as number) - (pz[p] as number);
			quatRotate(turn, p * 4, v, v);
			x[n] = (x[p] as number) + v[0];
			y[n] = (y[p] as number) + v[1];
			z[n] = (z[p] as number) + v[2];
		}
		// The joint's own bend, from the load beyond it in its grown pose.
		const beyond = (mass[n] as number) - (own[n] as number);
		let angle = 0;
		// The level way out from the joint: toward the load beyond it, or along its own internode.
		let hx = p >= 0 ? (px[n] as number) - (px[p] as number) : 0;
		let hz = p >= 0 ? (pz[n] as number) - (pz[p] as number) : 0;
		if (beyond > 0) {
			const cx =
				((sx[n] as number) - (own[n] as number) * (px[n] as number)) / beyond - (px[n] as number);
			const cz =
				((sz[n] as number) - (own[n] as number) * (pz[n] as number)) / beyond - (pz[n] as number);
			const lever = Math.sqrt(cx * cx + cz * cz);
			if (lever > 1e-6) {
				const r = Math.max(radius[n] as number, 1e-4);
				angle = Math.min(MOST_BEND, (strength * STIFFNESS * beyond * lever) / (r * r * r * r));
				hx = cx;
				hz = cz;
			}
		}
		const level = Math.sqrt(hx * hx + hz * hz);
		// A positive angle turns the way out down, about the level axis across it.
		const ax = level > 1e-9 ? hz / level : 0;
		const az = level > 1e-9 ? -hx / level : 0;
		const along = p >= 0 && axisOf[p] === axisOf[n] ? (sag[p] as number) : 0;
		sag[n] = along + angle;
		const reach = (span[n] as number) > 0 ? (rank[n] as number) / (span[n] as number) : 0;
		// Reaction wood: the outer part of the axis returns a share of the sag below it.
		const back = (upturn * along * reach) / Math.max(1, span[n] as number);
		const net = angle - back;
		const half = net / 2;
		const s = sin(half);
		const parentTurn = p >= 0 ? p * 4 : -1;
		if (parentTurn < 0) {
			turn[n * 4] = ax * s;
			turn[n * 4 + 1] = 0;
			turn[n * 4 + 2] = az * s;
			turn[n * 4 + 3] = cos(half);
		} else multiply(turn, parentTurn, ax * s, 0, az * s, cos(half), turn, n * 4);
	}
	// Wood the bends carried below the floor, or below where it grew if it grew lower, rests there,
	// and the wood beyond it rises with it.
	if (Number.isFinite(floor)) {
		const lift = new Float64Array(count);
		for (let n = 0; n < count; n++) {
			if (!live[n]) continue;
			const p = parent[n] as number;
			const under = Math.min(floor, py[n] as number) - (y[n] as number);
			lift[n] = Math.max(p >= 0 ? (lift[p] as number) : 0, under);
			y[n] = (y[n] as number) + (lift[n] as number);
		}
	}
	return turn;
}
