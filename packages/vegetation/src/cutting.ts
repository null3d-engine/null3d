// Cuttings: one piece of a plant grown as a plant of its own, for close review beside the reference
// set's studio stills. A branch or sub-branch is the subtree of one macro axis taken from the grown
// skeleton, moved so its cut sits on the origin and, by default, turned so it stands upright on the
// cut. The piece then goes through the same dressing and meshing stages as a whole plant, so it
// carries the species' own shoots, wood and wind, whichever growth model grew it. A leaf cluster is
// one shoot prototype of the kit and a leaf is one leaf mesh, each as a plant of its own.
import type {
	MeshArrays,
	PrototypeArrays,
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
} from './asset';
import { type MacroSkeleton, SkeletonBuilder } from './core/graph';
import {
	acos,
	cross3,
	length3,
	log,
	normalize3,
	quatAxisAngle,
	quatMultiply,
	quatRotate,
	type Vector3,
} from './core/math';
import type { Species } from './core/record';
import { DETAILS, type Detail } from './core/types';

/**
 * The piece a cutting takes.
 *
 * @category api/vegetation
 */
export type CuttingPart = 'branch' | 'subbranch' | 'cluster' | 'leaf';

/**
 * One piece of a plant as a plant of its own: a branch about 1 m long, a sub-branch about 0.35 m, a
 * leaf cluster, or one leaf.
 *
 * - 'leaf': one leaf mesh of the species, at the nearest level.
 * - 'cluster': a shoot prototype, chosen by `pick` among the prototypes in vigor order, the
 *   record's hinted shoot class first. A species with no prototypes cuts its finest shoots instead.
 * - 'subbranch', 'branch': the subtree of a macro axis of the hinted order whose extent is nearest
 *   `length`, cut there, with its shoot rows merged into one foliage part.
 *
 * Candidates rank by length match, then by light, so pick 0 is a full sunlit piece. The asset has
 * the nearest level only, its own wind records, and no impostor.
 *
 * @category api/vegetation
 */
export interface CuttingOptions {
	/** The piece to cut. */
	readonly part: CuttingPart;
	/** Metres from the cut to the farthest tip; the record's hint, or 1.0, 0.35 and 0.15 by default. */
	readonly length?: number;
	/** The candidate to take, 0 for the best. */
	readonly pick?: number;
	/** 'upright' stands the piece on its cut, as the studio stills do; 'as-grown' keeps its pose. */
	readonly orient?: 'upright' | 'as-grown';
	/** For 'leaf': the face toward +Z. */
	readonly face?: 'upper' | 'lower';
}

/**
 * The default length of each piece, in metres.
 *
 * @category api/vegetation
 */
export const CUTTING_LENGTH: Readonly<Record<CuttingPart, number>> = {
	branch: 1,
	subbranch: 0.35,
	cluster: 0.15,
	leaf: 0.15,
};

/** Candidates whose length match falls in the same step of this many natural-log units rank as near. */
const MATCH_STEP = 0.15;

/**
 * The length a cutting aims for: the option's, else the record's hint, else the default.
 *
 * @param record The species record.
 * @param cutting The piece to cut.
 * @returns Metres from the cut to the farthest tip.
 * @category api/vegetation
 */
export function cuttingLength(record: Species, cutting: CuttingOptions): number {
	if (cutting.length !== undefined) return cutting.length;
	const hint =
		cutting.part === 'branch' || cutting.part === 'subbranch'
			? record.cuttings?.[cutting.part]?.length
			: undefined;
	return hint ?? CUTTING_LENGTH[cutting.part];
}

/** A node's position as a vector. */
function nodeAt(skeleton: MacroSkeleton, node: number): Vector3 {
	const p = skeleton.position;
	return [p[node * 3] as number, p[node * 3 + 1] as number, p[node * 3 + 2] as number];
}

/**
 * Where an axis leaves its parent. An axis that leaves at its parent node (a share of 0 along the
 * internode, as the growers write it) is cut there. One that leaves further along the internode is
 * cut where its first node, projected onto that internode, meets it. A stem is cut at its first node.
 */
function junctionOf(skeleton: MacroSkeleton, axis: number): Vector3 {
	const { axes } = skeleton;
	const first = nodeAt(skeleton, axes.first[axis] as number);
	const parentNode = axes.parentNode[axis] as number;
	const parentAxis = axes.parent[axis] as number;
	if (parentNode < 0 || parentAxis < 0) return first;
	const a = nodeAt(skeleton, parentNode);
	if ((axes.parentT[axis] as number) <= 0) return a;
	const next = parentNode + 1;
	const b =
		next <= (axes.last[parentAxis] as number) && (skeleton.axisOf[next] as number) === parentAxis
			? nodeAt(skeleton, next)
			: a;
	const ab: Vector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const span = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
	const along = (first[0] - a[0]) * ab[0] + (first[1] - a[1]) * ab[1] + (first[2] - a[2]) * ab[2];
	const t = span > 0 ? Math.min(1, Math.max(0, along / span)) : 0;
	return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/** Each axis's depth below its stem, so a walk in depth order meets every parent first. */
function depths(skeleton: MacroSkeleton): Uint16Array {
	const { axes } = skeleton;
	const depth = new Uint16Array(axes.count);
	const known = new Uint8Array(axes.count);
	for (let a = 0; a < axes.count; a++) {
		const chain: number[] = [];
		let at = a;
		while (at >= 0 && known[at] === 0) {
			chain.push(at);
			at = axes.parent[at] as number;
		}
		let d = at >= 0 ? (depth[at] as number) + 1 : 0;
		for (let k = chain.length - 1; k >= 0; k--) {
			const axis = chain[k] as number;
			depth[axis] = d++;
			known[axis] = 1;
		}
	}
	return depth;
}

/** One axis that a branch cut can start from: its extent from the cut and its subtree's light. */
interface Candidate {
	readonly axis: number;
	readonly extent: number;
	readonly light: number;
	/** Axes in its subtree, itself included, and the bud sites they carry. */
	readonly axes: number;
	readonly buds: number;
}

/**
 * The axes a branch cut can start from, ranked: those of the wanted order (any order past the stems
 * when it is undefined), by how near their subtree's extent is to `length`; among pieces as near,
 * those that carry bud sites (so shoots grow on them) and divide come first, then the sunniest.
 */
function candidates(
	skeleton: MacroSkeleton,
	order: number | undefined,
	length: number,
): Candidate[] {
	const { axes } = skeleton;
	const depth = depths(skeleton);
	const byDepth = Array.from({ length: axes.count }, (_, a) => a).sort(
		(a, b) => (depth[a] as number) - (depth[b] as number) || a - b,
	);
	// The candidate ancestors of each axis, nearest first, found walking parents before children.
	const owners: number[][] = Array.from({ length: axes.count }, () => []);
	const isCandidate = (a: number) =>
		(axes.parent[a] as number) >= 0 &&
		(order === undefined ? (axes.order[a] as number) >= 1 : (axes.order[a] as number) === order);
	for (const a of byDepth) {
		const parent = axes.parent[a] as number;
		const inherited = parent >= 0 ? (owners[parent] as number[]) : [];
		owners[a] = isCandidate(a) ? [a, ...inherited] : inherited;
	}
	const junction = new Map<number, Vector3>();
	const extent = new Float64Array(axes.count);
	const light = new Float64Array(axes.count);
	const nodes = new Uint32Array(axes.count);
	for (let a = 0; a < axes.count; a++) {
		const owning = owners[a] as number[];
		if (owning.length === 0) continue;
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
			const p = nodeAt(skeleton, n);
			for (const owner of owning) {
				let j = junction.get(owner);
				if (!j) {
					j = junctionOf(skeleton, owner);
					junction.set(owner, j);
				}
				const d = length3(p[0] - j[0], p[1] - j[1], p[2] - j[2]);
				if (d > (extent[owner] as number)) extent[owner] = d;
				light[owner] = (light[owner] as number) + (skeleton.light[n] as number);
				nodes[owner] = (nodes[owner] as number) + 1;
			}
		}
	}
	const subtreeAxes = new Uint32Array(axes.count);
	for (let a = 0; a < axes.count; a++)
		for (const owner of owners[a] as number[])
			subtreeAxes[owner] = (subtreeAxes[owner] as number) + 1;
	const subtreeBuds = new Uint32Array(axes.count);
	for (let b = 0; b < skeleton.buds.count; b++)
		for (const owner of owners[skeleton.buds.axis[b] as number] as number[])
			subtreeBuds[owner] = (subtreeBuds[owner] as number) + 1;
	const out: Candidate[] = [];
	for (let a = 0; a < axes.count; a++)
		if (isCandidate(a) && (extent[a] as number) > 0)
			out.push({
				axis: a,
				extent: extent[a] as number,
				light: (light[a] as number) / Math.max(1, nodes[a] as number),
				axes: subtreeAxes[a] as number,
				buds: subtreeBuds[a] as number,
			});
	const match = (c: Candidate) => Math.round(Math.abs(log(c.extent / length)) / MATCH_STEP);
	const leafy = (c: Candidate) => (c.buds > 0 ? 1 : 0);
	const divides = (c: Candidate) => (c.axes > 1 ? 1 : 0);
	return out.sort(
		(x, y) =>
			match(x) - match(y) ||
			leafy(y) - leafy(x) ||
			divides(y) - divides(x) ||
			y.light - x.light ||
			x.axis - y.axis,
	);
}

/** What a branch cut took from the plant: the piece's own skeleton and where it came from. */
export interface CutBranch {
	/** The piece, its cut on the origin. */
	readonly skeleton: MacroSkeleton;
	/** The axis of the whole plant the piece starts from. */
	readonly axis: number;
	/** That axis's botanical order. */
	readonly order: number;
	/** Metres from the cut to the farthest node of the piece. */
	readonly extent: number;
	/** How many axes could have been cut for the asked length and order. */
	readonly candidates: number;
}

/**
 * Cuts the subtree of one macro axis from a grown skeleton as a skeleton of its own: the axis whose
 * subtree's extent from its junction is nearest the asked length, among the axes of the record's
 * hinted order (or any order past the stems when the record hints none, or no axis has that order),
 * taken by `pick` in rank order. The cut sits on the origin. 'upright' turns the piece so the line
 * from the cut to its nodes' mean points up +Y; 'as-grown' keeps its turn. Bud frames turn with it.
 *
 * @param skeleton The whole plant's skeleton.
 * @param record The species record, for its cutting hints.
 * @param cutting The piece to cut: 'branch' or 'subbranch', or 'cluster' for a species without prototypes.
 * @returns The piece, or undefined when the plant has no axis past its stems.
 * @category api/vegetation
 */
export function cutBranch(
	skeleton: MacroSkeleton,
	record: Species,
	cutting: CuttingOptions,
): CutBranch | undefined {
	const length = cuttingLength(record, cutting);
	const hinted =
		cutting.part === 'branch' || cutting.part === 'subbranch'
			? record.cuttings?.[cutting.part]?.order
			: undefined;
	let ranked = candidates(skeleton, hinted, length);
	if (ranked.length === 0 && hinted !== undefined) ranked = candidates(skeleton, undefined, length);
	if (ranked.length === 0) return undefined;
	const chosen = ranked[(cutting.pick ?? 0) % ranked.length] as Candidate;
	const { axes, buds } = skeleton;
	const root = chosen.axis;
	const inside = new Uint8Array(axes.count);
	const depth = depths(skeleton);
	const order = Array.from({ length: axes.count }, (_, a) => a).sort(
		(a, b) => (depth[a] as number) - (depth[b] as number) || a - b,
	);
	for (const a of order) {
		const parent = axes.parent[a] as number;
		inside[a] = a === root || (parent >= 0 && inside[parent] === 1) ? 1 : 0;
	}
	const cut = junctionOf(skeleton, root);
	// The turn that stands the piece upright: the cut-to-mean line onto +Y.
	const q = [0, 0, 0, 1];
	if (cutting.orient !== 'as-grown') {
		const mean: Vector3 = [0, 0, 0];
		let count = 0;
		for (let a = 0; a < axes.count; a++) {
			if (inside[a] !== 1) continue;
			for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
				const p = nodeAt(skeleton, n);
				mean[0] += p[0] - cut[0];
				mean[1] += p[1] - cut[1];
				mean[2] += p[2] - cut[2];
				count++;
			}
		}
		const along = normalize3([mean[0] / count, mean[1] / count, mean[2] / count]);
		const axis = cross3(along, [0, 1, 0], [0, 0, 0]);
		const sine = length3(axis[0], axis[1], axis[2]);
		if (sine > 1e-6) quatAxisAngle(normalize3(axis), acos(Math.max(-1, Math.min(1, along[1]))), q);
		else if (along[1] < 0) quatAxisAngle([1, 0, 0], Math.PI, q);
	}
	const moved: Vector3 = [0, 0, 0];
	const place = (p: Readonly<Vector3>): Vector3 =>
		quatRotate(q, 0, [p[0] - cut[0], p[1] - cut[1], p[2] - cut[2]], moved);
	const builder = new SkeletonBuilder();
	const axisMap = new Int32Array(axes.count).fill(-1);
	const nodeMap = new Int32Array(skeleton.nodeCount).fill(-1);
	let cutNode = -1;
	for (const a of order) {
		if (inside[a] !== 1) continue;
		const isRoot = a === root;
		const parent = axes.parent[a] as number;
		const parentNode = axes.parentNode[a] as number;
		const mapped = builder.addAxis({
			parent: isRoot ? -1 : (axisMap[parent] as number),
			parentNode: isRoot || parentNode < 0 ? -1 : (nodeMap[parentNode] as number),
			parentT: axes.parentT[a] as number,
			order: axes.order[a] as number,
			kind: axes.kind[a] as number,
			barkV: axes.barkV[a] as number,
			barkU: axes.barkU[a] as number,
		});
		axisMap[a] = mapped;
		const first = axes.first[a] as number;
		if (isRoot) {
			// The cut face: a node at the junction, as thick as the piece's first node.
			cutNode = builder.addNode({
				x: 0,
				y: 0,
				z: 0,
				radius: skeleton.radius[first] as number,
				parent: -1,
				axis: mapped,
				light: skeleton.light[first] as number,
				age: skeleton.age[first] as number,
			});
		}
		for (let n = first; n <= (axes.last[a] as number); n++) {
			const p = place(nodeAt(skeleton, n));
			const from = skeleton.parent[n] as number;
			const parentOf = from >= 0 ? (nodeMap[from] as number) : -1;
			nodeMap[n] = builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: skeleton.radius[n] as number,
				parent: parentOf >= 0 ? parentOf : cutNode,
				axis: mapped,
				light: skeleton.light[n] as number,
				age: skeleton.age[n] as number,
				flags: skeleton.flags[n] as number,
			});
		}
	}
	const frame = [0, 0, 0, 1];
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if (inside[axis] !== 1) continue;
		const p = place([
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		]);
		quatMultiply(q, 0, buds.frame, b * 4, frame);
		builder.addBud({
			node: nodeMap[buds.node[b] as number] as number,
			x: p[0],
			y: p[1],
			z: p[2],
			frame,
			kind: buds.kind[b] as number,
			vigor: buds.vigor[b] as number,
			light: buds.light[b] as number,
			axis: axisMap[axis] as number,
			woodRadius: buds.woodRadius[b] as number,
		});
	}
	return {
		skeleton: builder.finish(),
		axis: root,
		order: axes.order[root] as number,
		extent: chosen.extent,
		candidates: ranked.length,
	};
}

/** A mesh under construction in growable number lists. */
interface Writer {
	readonly positions: number[];
	readonly normals: number[];
	readonly uvs: number[];
	readonly uvs1: number[];
	readonly colors: number[];
	readonly indices: number[];
}

const writer = (): Writer => ({
	positions: [],
	normals: [],
	uvs: [],
	uvs1: [],
	colors: [],
	indices: [],
});

function finish(mesh: Writer): MeshArrays {
	const count = mesh.positions.length / 3;
	return {
		positions: new Float32Array(mesh.positions),
		normals: new Float32Array(mesh.normals),
		uvs: new Float32Array(mesh.uvs),
		uvs1: new Float32Array(mesh.uvs1),
		colors: new Uint8Array(mesh.colors),
		indices: count > 0xffff ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices),
	};
}

/**
 * Appends a prototype-space mesh, turned by the quaternion at `q[qo]`, scaled and moved to `at`.
 * Each vertex's colour bytes become the wind record's two bytes, the prototype's bend weight and its
 * self-occlusion, as a merged foliage part's are.
 */
function append(
	mesh: Writer,
	source: PrototypeArrays,
	q: ArrayLike<number>,
	qo: number,
	scale: number,
	at: Readonly<Vector3>,
	record: number,
): void {
	const base = mesh.positions.length / 3;
	const count = source.positions.length / 3;
	const v: Vector3 = [0, 0, 0];
	for (let i = 0; i < count; i++) {
		quatRotate(
			q,
			qo,
			[
				source.positions[i * 3] as number,
				source.positions[i * 3 + 1] as number,
				source.positions[i * 3 + 2] as number,
			],
			v,
		);
		mesh.positions.push(at[0] + v[0] * scale, at[1] + v[1] * scale, at[2] + v[2] * scale);
		quatRotate(
			q,
			qo,
			[
				source.normals[i * 3] as number,
				source.normals[i * 3 + 1] as number,
				source.normals[i * 3 + 2] as number,
			],
			v,
		);
		mesh.normals.push(v[0], v[1], v[2]);
		mesh.uvs.push(source.uvs[i * 2] as number, source.uvs[i * 2 + 1] as number);
		mesh.uvs1.push(
			(source.uvs1[i * 2] as number) * scale,
			(source.uvs1[i * 2 + 1] as number) * scale,
		);
		mesh.colors.push(
			(record >>> 8) & 255,
			record & 255,
			source.colors[i * 4] as number,
			source.colors[i * 4 + 3] as number,
		);
	}
	for (const index of source.indices) mesh.indices.push(base + index);
}

/**
 * A plant's shoot rows merged into one mesh: each row's prototype at the tier, turned, scaled and
 * moved to the row, on the row's wind record from the variant's first one.
 *
 * @param kit The species' kit.
 * @param rows The shoot rows.
 * @param detail The mesh tier.
 * @param recordBase The variant's first global wind record.
 * @returns The merged mesh.
 * @category api/vegetation
 */
export function mergeShoots(
	kit: SpeciesKitData,
	rows: ShootRows,
	detail: Detail,
	recordBase: number,
): MeshArrays {
	const mesh = writer();
	const tier = DETAILS.indexOf(detail);
	for (let r = 0; r < rows.count; r++) {
		const source = kit.prototypes[rows.prototype[r] as number]?.tiers[tier];
		if (!source) continue;
		append(
			mesh,
			source,
			rows.rotation,
			r * 4,
			rows.scale[r] as number,
			[
				rows.position[r * 3] as number,
				rows.position[r * 3 + 1] as number,
				rows.position[r * 3 + 2] as number,
			],
			recordBase + (rows.record[r] as number),
		);
	}
	return finish(mesh);
}

/**
 * The kit's prototypes in the order a 'cluster' cutting picks them: those of the record's hinted
 * shoot class first, then by vigor, strongest first.
 *
 * @param kit The species' kit.
 * @returns The prototypes in rank order.
 * @category api/vegetation
 */
export function clusterRank(kit: SpeciesKitData): readonly ShootPrototype[] {
	const hint = kit.record.cuttings?.cluster?.shoot;
	return [...kit.prototypes].sort(
		(a, b) =>
			Number(b.class === hint) - Number(a.class === hint) ||
			b.vigor[1] - a.vigor[1] ||
			b.vigor[0] - a.vigor[0] ||
			a.index - b.index,
	);
}

/**
 * The mesh of a 'leaf' or 'cluster' cutting from the kit alone: one leaf in its leaf frame (petiole
 * tip on the origin, midrib up +Y, upper face toward +Z, or the lower face when asked), or one
 * shoot prototype standing on its attach point. Undefined for a cluster of a species without
 * prototypes, which cuts its finest shoots from the plant instead.
 *
 * @param kit The species' kit.
 * @param cutting The piece.
 * @param detail The mesh tier.
 * @returns The piece's mesh, or undefined.
 * @category api/vegetation
 */
export function cutFoliage(
	kit: SpeciesKitData,
	cutting: CuttingOptions,
	detail: Detail,
): MeshArrays | undefined {
	const mesh = writer();
	const origin: Vector3 = [0, 0, 0];
	if (cutting.part === 'leaf') {
		const leaf = kit.leaves[(cutting.pick ?? 0) % Math.max(1, kit.leaves.length)];
		if (!leaf) return finish(mesh);
		const turn = cutting.face === 'lower' ? [0, 1, 0, 0] : [0, 0, 0, 1];
		append(mesh, leaf, turn, 0, 1, origin, 0);
		return finish(mesh);
	}
	const ranked = clusterRank(kit);
	if (ranked.length === 0) return undefined;
	const prototype = ranked[(cutting.pick ?? 0) % ranked.length] as ShootPrototype;
	const tier = prototype.tiers[DETAILS.indexOf(detail)] ?? prototype.tiers[2];
	append(mesh, tier, [0, 0, 0, 1], 0, 1, origin, 0);
	return finish(mesh);
}
