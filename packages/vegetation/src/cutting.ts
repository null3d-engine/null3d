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
import {
	AXIS_CULM,
	AXIS_ROOT,
	AXIS_STEM,
	AXIS_STIPE,
	type MacroSkeleton,
	SkeletonBuilder,
} from './core/graph';
import {
	acos,
	cos,
	cross3,
	length3,
	log,
	normalize3,
	quatAxisAngle,
	quatMultiply,
	quatRotate,
	sin,
	type Vector3,
} from './core/math';
import type {
	CutFromPlant,
	FrondShape,
	LeafShape,
	PinnaSpec,
	ShootClass,
	Species,
	ThickLeaf,
} from './core/record';
import { DETAILS, type Detail, spreadMean, type Vec3 } from './core/types';
import { foliage } from './leaf/kinds';
import { SURFACE_STEM } from './leaf/writer';

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
	/**
	 * For 'leaf': whether the leaf lies pressed flat, as a scan lays it, or keeps the shape it has on
	 * the plant, as a leaf held in the hand does. The record's cutting hint by default.
	 */
	readonly pressed?: boolean;
	/**
	 * For 'leaf': how far the leaf has opened, from 0 for a crozier still rolled to 1 for a leaf
	 * fully out. A species with a leaf that grows through a shape a picture shows, such as a fern's
	 * crozier, names it there; absent, the leaf is drawn as it stands on a mature plant.
	 */
	readonly age?: number;
	/**
	 * For 'branch' and 'subbranch': the shoots the piece carries, over the record's hint, so two
	 * pictures of one species can show different numbers of side shoots. Absent, the hint's count
	 * stands. A cluster or a leaf keeps one whatever it names.
	 */
	readonly shoots?: number;
	/**
	 * For 'branch' and 'subbranch': the shoot class the piece draws, over the record hint's class, so
	 * a close view can draw a thin twig while the studio piece draws the whole branch. Absent, the
	 * hint's class stands. A cluster names its class through the record alone.
	 */
	readonly shoot?: string;
	/**
	 * For 'branch' and 'subbranch': the radius of the ring the fanned shoots stand on, as a share of
	 * the piece's height, over the record's hint. A wide ring draws the shoots as separate pieces;
	 * a near-base ring joins them. Absent, the hint's ring stands.
	 */
	readonly ring?: number;
	/**
	 * For 'branch' and 'subbranch': the degrees each fanned shoot leans outward from the piece's
	 * axis, over the record's hint. A lean with a near-base ring opens the tips while the bases
	 * stay joined. Absent, the hint's lean stands.
	 */
	readonly lean?: number;
	/**
	 * For 'branch' and 'subbranch': how the fanned shoots are placed. 'ring' stands them round the
	 * piece's axis; 'spray' roots them along one lateral line at rising heights, as a close picture
	 * of a twig spray shows; 'fan' roots every shoot at one base and tilts each row across the
	 * prototype's own leaf plane, so the piece opens like a hand of cards and every row keeps its
	 * leaf faces turned the same way. 'ring' by default.
	 */
	readonly layout?: 'ring' | 'spray' | 'fan';
	/**
	 * For a 'spray' or 'fan' layout: the width the shoots span, as a share of the piece's height.
	 * A spray spreads its lateral line this wide; a fan opens its arc until its tips stand this far
	 * apart. A wider span draws separate thin twigs or a broader fan.
	 */
	readonly spread?: number;
	/**
	 * For 'branch' and 'subbranch': whether the candidates rank by how young they are rather than by
	 * how well their length matches, so the piece draws a shoot that is still opening. Absent, a
	 * cut ranks as it always has.
	 */
	readonly young?: boolean;
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

/**
 * The share of the blade's length that a pressed leaf keeps as its stalk where the record names
 * none: a leaf picked from the crown shows a short piece of it under the blade.
 */
export const LEAF_CUT_PETIOLE = 0.12;

/**
 * The most shoots one branch or sub-branch cut may carry: a piece with more reads as a thicket
 * rather than the one divided branch a photograph shows.
 */
export const CUT_SHOOTS_MOST = 8;
/** The plant's up axis, for a shoot row's spin about the piece's own upright line. */
const UP: Vector3 = [0, 1, 0];

/**
 * Steps of length match within which a piece counts as near the asked length, about a third either
 * way: among near pieces, one that divides ranks before one that matches the length more closely.
 */
const NEAR_STEPS = 2;
/** Candidates whose length match falls in the same step of this many natural-log units rank as near. */
const MATCH_STEP = 0.15;

/** A branch or sub-branch hint that cuts from the grown plant, if the record gives one. */
function plantHint(record: Species, part: CuttingPart): CutFromPlant | undefined {
	if (part !== 'branch' && part !== 'subbranch') return undefined;
	const hint = record.cuttings?.[part];
	return hint && 'order' in hint ? hint : undefined;
}

/** The shoot class a cutting hint takes from the kit, if it names one. */
function shootHint(record: Species, part: CuttingPart): ShootClass['name'] | undefined {
	if (part === 'leaf') return undefined;
	const hint = record.cuttings?.[part];
	return hint && 'shoot' in hint ? hint.shoot : undefined;
}

/**
 * Whether a cutting is one shoot prototype from the kit rather than a piece of the grown plant: a
 * cluster, or a branch or sub-branch whose record hint names a shoot class.
 *
 * @param record The species record.
 * @param part The piece.
 * @returns Whether the kit's prototypes give the piece.
 * @category api/vegetation
 */
export function cutsShoot(record: Species, part: CuttingPart): boolean {
	return part === 'cluster' || shootHint(record, part) !== undefined;
}

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
	const hint = plantHint(record, cutting.part);
	return hint?.length ?? CUTTING_LENGTH[cutting.part];
}

/**
 * The turn that stands a piece upright on its cut at the origin: the line from the cut to `mean`
 * onto +Y.
 */
function uprightTurn(mean: Readonly<Vector3>): number[] {
	const q = [0, 0, 0, 1];
	const along = normalize3([mean[0], mean[1], mean[2]]);
	const axis = cross3(along, [0, 1, 0], [0, 0, 0]);
	const sine = length3(axis[0], axis[1], axis[2]);
	if (sine > 1e-6) quatAxisAngle(normalize3(axis), acos(Math.max(-1, Math.min(1, along[1]))), q);
	else if (along[1] < 0) quatAxisAngle([1, 0, 0], Math.PI, q);
	return q;
}

/**
 * The turn a shoot cutting stands in: upright on its attach point, the line to the mean of its
 * stems' vertices onto +Y, as a cut branch stands on the line to its wood's mean; none when the
 * cutting keeps its pose. The low tier, which every kit holds, gives one turn whatever tier draws
 * the piece.
 */
function shootTurn(prototype: ShootPrototype, cutting: CuttingOptions): number[] {
	if (cutting.orient === 'as-grown') return [0, 0, 0, 1];
	const { positions: p, colors } = prototype.tiers[0] as PrototypeArrays;
	const mean: Vector3 = [0, 0, 0];
	let count = 0;
	for (let i = 0; i < p.length; i += 3) {
		if ((colors[(i / 3) * 4 + 2] as number) !== SURFACE_STEM) continue;
		mean[0] += p[i] as number;
		mean[1] += p[i + 1] as number;
		mean[2] += p[i + 2] as number;
		count++;
	}
	return count > 0 ? uprightTurn(mean) : [0, 0, 0, 1];
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
	/** Axes in its subtree, itself included, and the bud sites they carry in light enough for shoots. */
	readonly axes: number;
	readonly buds: number;
	/** 1 when the axis is a flowering head: its shoots are the flowers, not the leaves. */
	readonly head: number;
	/** Its pipe radius at its first node, the thickness a piece's photograph shows. */
	readonly thickness: number;
	/** The mean age of its nodes, from 0 for a shoot still opening to 1 for a mature one. */
	readonly age: number;
}

/**
 * The axes a branch cut can start from, ranked: those of the wanted order (any order past the stems
 * when it is undefined): first those that carry bud sites in enough light to grow shoots (at or
 * above the record's shade line), then those whose subtree's extent is near `length`, then a leafy
 * shoot before a flowering head, then those that divide, then the thickest, then by how near the
 * extent is, then the sunniest.
 */
function candidates(
	skeleton: MacroSkeleton,
	order: number | undefined,
	length: number,
	shade: number,
	young = false,
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
	for (let b = 0; b < skeleton.buds.count; b++) {
		if ((skeleton.buds.light[b] as number) < shade) continue;
		for (const owner of owners[skeleton.buds.axis[b] as number] as number[])
			subtreeBuds[owner] = (subtreeBuds[owner] as number) + 1;
	}
	// A shoot's age is the vigor of the bud that carries it, which the foliage reads too; an axis
	// with no bud of its own has no age and ranks last among the young.
	const vigor = new Float64Array(axes.count).fill(Number.POSITIVE_INFINITY);
	for (let b = 0; b < skeleton.buds.count; b++) {
		const axis = skeleton.buds.axis[b] as number;
		vigor[axis] = Math.min(vigor[axis] as number, skeleton.buds.vigor[b] as number);
	}
	const out: Candidate[] = [];
	for (let a = 0; a < axes.count; a++)
		if (isCandidate(a) && (extent[a] as number) > 0)
			out.push({
				axis: a,
				extent: extent[a] as number,
				light: (light[a] as number) / Math.max(1, nodes[a] as number),
				axes: subtreeAxes[a] as number,
				buds: subtreeBuds[a] as number,
				head: (axes.kind[a] as number) === AXIS_CULM ? 1 : 0,
				thickness: skeleton.radius[axes.first[a] as number] as number,
				age: vigor[a] as number,
			});
	const match = (c: Candidate) => Math.round(Math.abs(log(c.extent / length)) / MATCH_STEP);
	const near = (c: Candidate) => (match(c) <= NEAR_STEPS ? 1 : 0);
	const leafy = (c: Candidate) => (c.buds > 0 ? 1 : 0);
	const head = (c: Candidate) => c.head;
	const divides = (c: Candidate) => (c.axes > 1 ? 1 : 0);
	// A photograph of a piece shows a thick axis where it shows one at all. Among the pieces near the
	// asked length, a leafy shoot ranks before a flowering head, and a piece that divides ranks before
	// a single thick axis, so a cluster is a fan of leaves and not one blade or one panicle; then the
	// thickest axis, then the closest match.
	return out.sort(
		(x, y) =>
			(young ? x.age - y.age : 0) ||
			leafy(y) - leafy(x) ||
			near(y) - near(x) ||
			head(x) - head(y) ||
			divides(y) - divides(x) ||
			y.thickness - x.thickness ||
			match(x) - match(y) ||
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
 * Whether an axis hangs on wood the whole plant draws: a stem's axis or a frond colony's stipe at the
 * foot of its chain. A rosette's eye and a tuft's shoot hang on a crown that carries no wood, so a
 * piece cut from them is all foliage.
 */
function onWood(skeleton: MacroSkeleton, axis: number): boolean {
	let at = axis;
	while (at >= 0) {
		const kind = skeleton.axes.kind[at] as number;
		if (kind === AXIS_STEM || kind === AXIS_STIPE) return true;
		at = skeleton.axes.parent[at] as number;
	}
	return false;
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
	const hinted = plantHint(record, cutting.part)?.order;
	const shade = record.shoots?.placement.shadePrune ?? 0;
	let ranked = candidates(skeleton, hinted, length, shade, cutting.young);
	if (ranked.length === 0 && hinted !== undefined)
		ranked = candidates(skeleton, undefined, length, shade, cutting.young);
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
	let q = [0, 0, 0, 1];
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
		q = uprightTurn([mean[0] / count, mean[1] / count, mean[2] / count]);
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
			// A piece's root stands in for the wood it was cut from. An axis that hangs on a stem or a
			// stipe is wood and keeps its kind, so the cut face is drawn; an axis that hangs on nothing
			// woody, such as a rosette's eye, carries no wood in the whole plant either, and its cut
			// root stays a root the wood mesher skips.
			kind: isRoot && !onWood(skeleton, a) ? AXIS_ROOT : (axes.kind[a] as number),
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
	const tier = heldTier(kit, detail);
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
 * The index of the tier a cutting meshes its shoots at: the asked tier, or the kit's own where the
 * kit holds no finer one.
 */
function heldTier(kit: SpeciesKitData, detail: Detail): number {
	return Math.min(DETAILS.indexOf(detail), DETAILS.indexOf(kit.detail));
}

/**
 * The kit's prototypes in the order a 'cluster' cutting picks them: those of the record's hinted
 * shoot class first, then by vigor, strongest first.
 *
 * @param kit The species' kit.
 * @returns The prototypes in rank order.
 * @category api/vegetation
 */
export function clusterRank(
	kit: SpeciesKitData,
	part: CuttingPart = 'cluster',
	shoot?: string,
): readonly ShootPrototype[] {
	const hint = shoot ?? shootHint(kit.record, part);
	return [...kit.prototypes].sort(
		(a, b) =>
			Number(b.class === hint) - Number(a.class === hint) ||
			b.vigor[1] - a.vigor[1] ||
			b.vigor[0] - a.vigor[0] ||
			a.index - b.index,
	);
}

/**
 * A 'cluster' cutting from the kit alone: one shoot row of the prototype that `pick` names, standing
 * upright on its attach point at the origin unless the cutting keeps its pose, and the bounds of its
 * mesh at the tier.
 *
 * @param kit The species' kit.
 * @param cutting The piece.
 * @param detail The mesh tier.
 * @returns The row and its bounds, or undefined for a species without prototypes.
 * @category api/vegetation
 */
export function clusterRow(
	kit: SpeciesKitData,
	cutting: CuttingOptions,
	detail: Detail,
	leafy?: boolean,
):
	| { readonly rows: ShootRows; readonly bounds: { readonly min: Vec3; readonly max: Vec3 } }
	| undefined {
	const all = clusterRank(kit, cutting.part, cutting.shoot);
	// A piece is drawn in the season it is asked for: in a leafless season it takes the shoot's
	// leafless twin where the kit holds one, as the whole plant's rows do.
	const wanted = leafy === undefined ? all : all.filter((p) => p.leaves > 0 === leafy);
	const ranked = wanted.length > 0 ? wanted : all;
	if (ranked.length === 0) return undefined;
	// The piece's own choice, else its record hint's, so two pieces of one class draw different shoots.
	const hint = cutting.part === 'leaf' ? undefined : kit.record.cuttings?.[cutting.part];
	const pick = cutting.pick ?? (hint && 'shoot' in hint ? (hint.pick ?? 0) : 0);
	const prototype = ranked[pick % ranked.length] as ShootPrototype;
	const tier = prototype.tiers[heldTier(kit, detail)] as PrototypeArrays;
	const turn = shootTurn(prototype, cutting);
	const p = tier.positions;
	const turned: Vector3 = [0, 0, 0];
	// A branch or sub-branch photograph that shows a divided, hanging branch needs more than the one
	// shoot a class prototype gives. The record hint may name how many shoots the piece carries, and
	// the tool fans that many rows of the class about the piece's upright axis. The hint may also
	// set the ring the rows stand on, how far each row leans outward, and how much of a full turn
	// each row takes, so a piece can share one base and still spread to its photograph's width. A
	// cluster or a leaf keeps its one shoot, and a piece whose hint names none keeps the one shoot
	// it always had.
	const asked = cutting.shoots ?? (hint && 'shoot' in hint ? (hint.shoots ?? 1) : 1);
	const shoots =
		cutting.part === 'cluster' || cutting.part === 'leaf'
			? 1
			: Math.max(1, Math.min(CUT_SHOOTS_MOST, Math.round(asked)));
	const fan = hint && 'shoot' in hint ? hint : undefined;
	const ring = Math.min(1, Math.max(0, cutting.ring ?? fan?.fanRing ?? 0.18));
	const lean = Math.min(90, Math.max(-90, cutting.lean ?? fan?.fanLean ?? 0));
	const layout = cutting.layout ?? fan?.layout ?? 'ring';
	const spread = Math.min(4, Math.max(0, cutting.spread ?? fan?.spread ?? 0));
	const spinShare = Math.min(1, Math.max(0, fan?.fanSpin ?? 1));
	const yaw = Math.min(180, Math.max(-180, fan?.fanYaw ?? 0));
	// The whole piece turns about its upright axis once, before any row's own fan, so a branch whose
	// side shoots lie in one plane shows that plane to the camera its photograph was taken from.
	const turnQ = [0, 0, 0, 1];
	if (yaw !== 0) {
		const yawQ = [0, 0, 0, 1];
		quatAxisAngle(UP, (yaw * Math.PI) / 180, yawQ);
		quatMultiply(yawQ, 0, turn, 0, turnQ);
	} else {
		turnQ[0] = turn[0] as number;
		turnQ[1] = turn[1] as number;
		turnQ[2] = turn[2] as number;
		turnQ[3] = turn[3] as number;
	}
	if (shoots === 1) {
		const min = [0, 0, 0];
		const max = [0, 0, 0];
		for (let i = 0; i < p.length; i += 3) {
			quatRotate(turnQ, 0, [p[i] as number, p[i + 1] as number, p[i + 2] as number], turned);
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k] as number, turned[k] as number);
				max[k] = Math.max(max[k] as number, turned[k] as number);
			}
		}
		return {
			rows: {
				count: 1,
				prototype: new Uint8Array([prototype.index]),
				position: new Float32Array(3),
				rotation: new Float32Array(turnQ),
				scale: new Float32Array([1]),
				record: new Uint16Array(1),
				phase: new Uint8Array(1),
				sky: new Uint8Array([250]),
				bent: new Uint8Array([0x88]),
				order: new Uint32Array(1),
			},
			bounds: {
				min: [min[0] as number, min[1] as number, min[2] as number],
				max: [max[0] as number, max[1] as number, max[2] as number],
			},
		};
	}
	// The piece's own height, so the shoots stand along it and fan from its base.
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < p.length; i += 3) {
		quatRotate(turnQ, 0, [p[i] as number, p[i + 1] as number, p[i + 2] as number], turned);
		low = Math.min(low, turned[1] as number);
		high = Math.max(high, turned[1] as number);
	}
	const tall = Number.isFinite(high - low) ? high - low : 0;
	// A fan opens across the prototype's own leaf plane, whose normal is its thin horizontal axis, so
	// every row keeps its leaf faces turned alike. The tilt is taken about that axis once the piece's
	// own turn has placed it, so the fan always opens upright however the prototype lies.
	const fanTurned: Vector3 = [0, 0, 0];
	quatRotate(turnQ, 0, [1, 0, 0], fanTurned);
	const flat = length3(fanTurned[0], 0, fanTurned[2]);
	const fanAxis: [number, number, number] =
		flat > 1e-6 ? [fanTurned[0] / flat, 0, fanTurned[2] / flat] : [1, 0, 0];
	const position = new Float32Array(3 * shoots);
	const rotation = new Float32Array(4 * shoots);
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const placed: Vector3 = [0, 0, 0];
	for (let row = 0; row < shoots; row++) {
		// A spray roots its shoots along one lateral line at rising heights, each turned a little
		// outward, rather than round a ring.
		const along = shoots === 1 ? 0.5 : row / (shoots - 1);
		const r = [0, 0, 0, 1];
		if (layout === 'fan') {
			// Every row leaves the same foot at its own angle across the leaf plane, so the fan opens
			// as one joined piece; the turn then shows that plane to the camera. The half-angle is
			// chosen so the tips stand the requested share of the height apart.
			const half = Math.asin(Math.min(1, spread / 2));
			const tilt = [0, 0, 0, 1];
			quatAxisAngle(fanAxis, (along - 0.5) * 2 * half, tilt);
			quatMultiply(tilt, 0, turnQ, 0, r);
		} else {
			const angle = (row * 2 * Math.PI) / shoots;
			const spin = [0, 0, 0, 1];
			quatAxisAngle(
				UP,
				layout === 'spray' ? (along - 0.5) * 2 * ((lean * Math.PI) / 180) : angle * spinShare,
				spin,
			);
			const q = [0, 0, 0, 1];
			quatMultiply(spin, 0, turnQ, 0, q);
			// Each row leans about the horizontal tangent at its own side of the ring, so a positive
			// lean opens the row away from the axis and a small ring keeps every base at one point.
			if (lean !== 0) {
				const tangent: [number, number, number] = [-sin(angle), 0, cos(angle)];
				const leanQ = [0, 0, 0, 1];
				quatAxisAngle(tangent, (-lean * Math.PI) / 180, leanQ);
				quatMultiply(leanQ, 0, q, 0, r);
			} else {
				r[0] = q[0] as number;
				r[1] = q[1] as number;
				r[2] = q[2] as number;
				r[3] = q[3] as number;
			}
			if (layout === 'spray') {
				position[row * 3] = (along - 0.5) * spread * tall;
				position[row * 3 + 1] = (row * 0.7 * tall) / shoots;
				position[row * 3 + 2] = 0;
			} else {
				position[row * 3] = ring * tall * cos(angle);
				position[row * 3 + 1] = (row * 0.55 * tall) / shoots;
				position[row * 3 + 2] = ring * tall * sin(angle);
			}
		}
		rotation.set(r, row * 4);
		for (let i = 0; i < p.length; i += 3) {
			quatRotate(r, 0, [p[i] as number, p[i + 1] as number, p[i + 2] as number], placed);
			for (let k = 0; k < 3; k++) {
				const v = (placed[k] as number) + (position[row * 3 + k] as number);
				min[k] = Math.min(min[k] as number, v);
				max[k] = Math.max(max[k] as number, v);
			}
		}
	}
	for (let k = 0; k < 3; k++) {
		if (!Number.isFinite(min[k])) min[k] = 0;
		if (!Number.isFinite(max[k])) max[k] = 0;
	}
	return {
		rows: {
			count: shoots,
			prototype: new Uint8Array(shoots).fill(prototype.index),
			position,
			rotation,
			scale: new Float32Array(shoots).fill(1),
			record: new Uint16Array(shoots),
			phase: new Uint8Array(shoots),
			sky: new Uint8Array(shoots).fill(250),
			bent: new Uint8Array(shoots).fill(0x88),
			order: new Uint32Array(shoots),
		},
		bounds: {
			min: [min[0] as number, min[1] as number, min[2] as number],
			max: [max[0] as number, max[1] as number, max[2] as number],
		},
	};
}

/** A blade leaf's shape pressed flat: no fold, curl, twist or wave, and its stalk straight. */
function pressedShape(shape: LeafShape): LeafShape {
	return {
		...shape,
		fold: 0,
		curl: 0,
		crossCurl: 0,
		twist: 0,
		wave: [0, shape.wave[1]],
		petiole: { ...shape.petiole, droop: 0 },
	};
}

/** A pinna's shape pressed flat: no fold and no droop, and its own pinnules flat too. */
function pressedPinnae(pinnae: PinnaSpec): PinnaSpec {
	return {
		...pinnae,
		fold: 0,
		droop: 0,
		...(pinnae.sub ? { sub: pressedPinnae(pinnae.sub) } : {}),
	};
}

/** A frond's shape pressed flat: the rachis runs straight on from the stipe, its pinnae in its plane. */
function pressedFrond(shape: FrondShape): FrondShape {
	return {
		...shape,
		droop: 0,
		twist: 0,
		...(shape.pinnae ? { pinnae: pressedPinnae(shape.pinnae) } : {}),
	};
}

/** A pressed specimen's stalk, as a share of its blade's length. */
const PRESSED_STALK = 0.6;

/** The record a pressed frond grows from: the species' frond laid flat in its own plane. */
function pressedFrondRecord(record: Species): Species | undefined {
	const growth = record.growth;
	if (growth.model === 'frond-colony') {
		// A copy-stand picture cuts the frond's stalk to a short piece over its blade, so the
		// pressed specimen carries that stalk rather than the length the plant holds its blade up.
		return {
			...record,
			growth: {
				...growth,
				stipe: {
					...growth.stipe,
					length: { mean: spreadMean(growth.frond.length) * PRESSED_STALK, spread: 0.02 },
				},
				frond: pressedFrond(growth.frond),
			},
		};
	}
	if (growth.model === 'crown-rosette')
		return { ...record, growth: { ...growth, frond: pressedFrond(growth.frond) } };
	return undefined;
}

/** A thick leaf's shape pressed flat: no cup, no curl and a flat margin. */
function pressedThickShape(shape: ThickLeaf): ThickLeaf {
	return { ...shape, cup: 0, curl: 0, wave: [0, shape.wave[1]] };
}

/**
 * The species' leaf meshes for a leaf cutting: the kit's own, or, where the piece or else the
 * record presses its leaf, the leaf built again pressed flat at the kit's tier. A pressed thick leaf
 * keeps a short piece of its stalk, as a leaf picked from the crown shows, and a species that grows
 * its leaves on long stalks names the metres its pictures show.
 */
function cutLeaves(kit: SpeciesKitData, press?: boolean, age?: number): readonly PrototypeArrays[] {
	const record = kit.record;
	const leaf = record.foliage;
	const flat = press ?? record.cuttings?.leaf?.pressed;
	// A frond is built again when it lies flat or when the cut names an age of its own, because a
	// crozier is the same leaf at another point of its opening rather than another shape.
	if (leaf.kind === 'frond') {
		const pressed = flat ? pressedFrondRecord(record) : undefined;
		if (!pressed && age === undefined) return kit.leaves;
		return foliage('frond').leaves(pressed ?? record, kit.manifest, kit.detail, age);
	}
	if (!flat) return kit.leaves;
	if (leaf.kind === 'thick') {
		const growth = record.growth;
		const stalk = record.cuttings?.leaf?.petiole ?? LEAF_CUT_PETIOLE * spreadMean(leaf.leaf.length);
		const pressed: Species = {
			...record,
			// The kit's leaf takes the stalk's length from the growth model, so a flat piece gives
			// it the short stalk its picture shows in place of the crown's long one.
			growth:
				growth.model === 'rosette'
					? {
							...growth,
							stalk: [
								[0, stalk],
								[1, stalk],
							],
						}
					: growth,
			foliage: { kind: 'thick', leaf: pressedThickShape(leaf.leaf) },
		};
		return foliage('thick').leaves(pressed, kit.manifest, kit.detail);
	}
	if (leaf.kind !== 'blade') return kit.leaves;
	const pressedLeaf: Species = { ...record, foliage: { ...leaf, leaf: pressedShape(leaf.leaf) } };
	return foliage('blade').leaves(pressedLeaf, kit.manifest, kit.detail);
}

/**
 * The mesh of a 'leaf' or 'cluster' cutting from the kit alone: one leaf in its leaf frame (petiole
 * tip on the origin, midrib up +Y, upper face toward +Z, or the lower face when asked), pressed
 * flat where the record says, or one shoot prototype standing upright on its attach point unless
 * the cutting keeps its pose. Undefined for a cluster of a species without prototypes, which cuts
 * its finest shoots from the plant instead.
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
	if (cutting.age !== undefined && !(cutting.age >= 0 && cutting.age <= 1))
		throw new Error(`@null3d/vegetation: a cutting's age is ${cutting.age}; it runs from 0 to 1`);
	const mesh = writer();
	const origin: Vector3 = [0, 0, 0];
	if (cutting.part === 'leaf') {
		const leaves = cutLeaves(kit, cutting.pressed, cutting.age);
		const leaf = leaves[(cutting.pick ?? 0) % Math.max(1, leaves.length)];
		if (!leaf) return finish(mesh);
		const turn = cutting.face === 'lower' ? [0, 1, 0, 0] : [0, 0, 0, 1];
		append(mesh, leaf, turn, 0, 1, origin, 0);
		return finish(mesh);
	}
	const ranked = clusterRank(kit, cutting.part);
	if (ranked.length === 0) return undefined;
	const prototype = ranked[(cutting.pick ?? 0) % ranked.length] as ShootPrototype;
	const tier = prototype.tiers[heldTier(kit, detail)] as PrototypeArrays;
	append(mesh, tier, shootTurn(prototype, cutting), 0, 1, origin, 0);
	return finish(mesh);
}
