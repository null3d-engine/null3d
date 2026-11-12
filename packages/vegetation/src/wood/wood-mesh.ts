// The wood mesher: one tube per axis of the skeleton, along a curve through its nodes with frames
// that never twist (frames.ts); rings placed where a straight, evenly tapering piece no longer fits
// the axis, sides by girth (tube.ts); the stem's flared, buttressed foot (flare.ts); each child
// welded onto its parent's own triangles with a collar and blend rings, forks onto the parent's
// rounded end (junction.ts); bark coordinates in metres that run on from parent to child (uv.ts).
// Parents are meshed before their children, because a child's weld reads its parent's rings.
//
// A vertex carries: `uv` in metres of bark (`u` round, `v` along); `uv1.x` the pipe radius over
// `WOOD_RADIUS_RANGE`, from which the shader picks young bark, bark zones by radius and the fade of
// displacement on thin wood; `uv1.y` the junction mask; colour bytes R and G the wind record, B the
// bend weight along the axis and A the crown's sky visibility.
import type { MeshArrays } from '../asset';
import {
	AXIS_LIMB,
	AXIS_RACHIS,
	AXIS_STEM,
	AXIS_STIPE,
	type MacroSkeleton,
	NODE_STUB,
} from '../core/graph';
import { acos, cos, PI, sin, tan } from '../core/math';
import type { Species } from '../core/record';
import { crownSkyAt } from '../crown/visibility';
import type { CrownLight, MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { peelFins } from './fins';
import { type StemSection, stemSection, surfaceRoots } from './flare';
import {
	type AxisPath,
	axisPath,
	emptyFrame,
	frameAt,
	KINK_BEND,
	type PathFrame,
	type PathSample,
	roundKinks,
	sampleAt,
} from './frames';
import {
	collarShare,
	junctionMask,
	ParentSurface,
	type SurfaceHit,
	type SurfacePlace,
} from './junction';
import {
	AxisRings,
	bendRings,
	CODOMINANT,
	heldSides,
	LEADER_SHARE,
	ringArcs,
	ringTrig,
	sidesFor,
	stitch,
	THIN,
	type TubeDetail,
	tubeDetail,
} from './tube';
import { type BarkScale, barkScale, tilesRound, uSpan } from './uv';

/**
 * Metres of pipe radius that `uv1.x` spans from 0 to 1 on wood.
 *
 * @category api/vegetation
 */
export const WOOD_RADIUS_RANGE = 4;

/** Metres of stem below the ground, as a share of the stem's base radius, so no stem floats. */
const BELOW_GROUND = 0.6;

/** The height of a fork's rounded end, in its radii, low enough that its leaders hide most of it. */
const FORK_DOME = 0.3;

/** The most radians a leader's first ring is reckoned to tilt from its parent's last. */
const LEADER_TILT = 1.2;

/**
 * The radius of the bend by which a fork's leader turns from its parent's line onto its own, in the
 * parent's radii, so its inner side never folds.
 */
const LEADER_BEND = 1.5;

/** A stub's pipe radius, at least, in the young bark's radii, so its bark is grown bark. */
const STUB_BARK = 1.25;

/** The fillet where a child meets its parent, in child radii. */
const FILLET_RADII = 0.8;

/** A child's foot is at most this share of its parent's radius. */
const BASE_CAP = 0.8;

/** The collar may swell a child to no more than this share of its parent's radius. */
const COLLAR_CAP = 0.92;

/** Blend rings run over this many child radii past the farthest point of the weld. */
const BLEND_RADII = 1.5;

/** The least distance in metres that a blend ring keeps from its parent's surface. */
const CLEARANCE = 0.0005;

/** The least agreement of a weld's normal with the child's own, as a cosine. */
const FACING = 0.15;

/** The most blend rings at each level. */
const BLEND_RINGS = [5, 3, 2] as const;

/** One axis to mesh: its points from base to tip, and where it hangs. */
interface WoodAxis {
	/** The skeleton's axis. */
	readonly axis: number;
	/**
	 * The axis's key in the mesher's reports: the skeleton's axis, or a number past the skeleton's
	 * axes for the wood that runs on past a fork where the axis divides.
	 */
	readonly key: number;
	/** The index of its parent in the list, or −1 for a stem. */
	readonly parent: number;
	/** The global wind record. */
	readonly record: number;
	/** Points, 3 a point: for a child the junction point first, for a stem a point below ground. */
	readonly points: Float64Array;
	readonly radii: Float64Array;
	readonly count: number;
	/** The stem's index among the plant's stems, or −1. */
	readonly stem: number;
	/** Whether children leave from its last node, so its end is a round crotch. */
	fork: boolean;
	/** Whether it is a leader of a fork, rising from its parent's end. */
	readonly leader: boolean;
	/** Whether it is a dead stub left where a branch was shed. */
	readonly stub: boolean;
	/** Whether it is the cut end of a piece: a limb with no parent, such as a cut branch. */
	readonly cut: boolean;
}

/** The skeleton's largest pipe radius. */
function largestRadius(skeleton: MacroSkeleton): number {
	let largest = 0;
	for (let i = 0; i < skeleton.nodeCount; i++)
		largest = Math.max(largest, skeleton.radius[i] as number);
	return largest;
}

/**
 * The last node of each axis that the wood keeps: every node the skeleton holds. A shed branch's
 * nodes are gone from it; its place on the parent is a flag, and a stub is a short axis of its own.
 */
function keptNodes(skeleton: MacroSkeleton): Int32Array {
	const axes = skeleton.axes;
	const kept = new Int32Array(axes.count);
	for (let a = 0; a < axes.count; a++) kept[a] = axes.last[a] as number;
	return kept;
}

/**
 * The axes to mesh at a level, parents before children, as pieces of wood. An axis is one piece,
 * divided where a codominant side child leaves short of its end: its wood ends there as a fork and
 * runs on past it as a new piece, so the child and the axis's own wood both rise from the fork as
 * its leaders. Where a piece ends and children of nearly its girth go on, those children are the
 * fork's leaders: each takes the piece's last ring as its own first ring, so the piece needs no
 * rounded end. A thinner child at that end hangs on the thickest leader instead.
 */
function woodAxes(input: MeshInput, keep: number): WoodAxis[] {
	const { skeleton } = input;
	const axes = skeleton.axes;
	const p = skeleton.position;
	const radius = skeleton.radius;
	const base = input.variant * VARIANT_RECORDS;
	const lastKept = keptNodes(skeleton);
	// Axes rooted at the ground, stems and a frond colony's stipes, take the stem base's flare,
	// lobes and roots. A limb or a rachis without a parent is the cut end of a piece, such as a cut
	// branch or a cut frond, and starts plain. Any other axis without a parent, such as a ground
	// plant's crown, carries no wood.
	const rooted = (a: number) =>
		(axes.kind[a] as number) === AXIS_STEM || (axes.kind[a] as number) === AXIS_STIPE;
	const piece = (a: number) =>
		(axes.kind[a] as number) === AXIS_LIMB || (axes.kind[a] as number) === AXIS_RACHIS;
	const meshed = (a: number) =>
		(axes.order[a] as number) <= keep &&
		(lastKept[a] as number) >= (axes.first[a] as number) &&
		((axes.parent[a] as number) >= 0 || rooted(a) || piece(a));
	// Where each axis divides: the nodes short of its end where a codominant side child leaves.
	const divides = new Uint8Array(skeleton.nodeCount);
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		const node = axes.parentNode[a] as number;
		if (parent < 0 || !meshed(a) || (axes.parentT[a] as number) > 1e-6) continue;
		if (node < (axes.first[parent] as number) || node >= (lastKept[parent] as number)) continue;
		if ((radius[axes.first[a] as number] as number) >= CODOMINANT * (radius[node] as number))
			divides[node] = 1;
	}
	// The pieces: each axis's runs of nodes between the nodes where it divides.
	const pieceAxis: number[] = [];
	const pieceFirst: number[] = [];
	const pieceLast: number[] = [];
	const pieceOfNode = new Int32Array(skeleton.nodeCount).fill(-1);
	const firstPiece = new Int32Array(axes.count).fill(-1);
	for (let a = 0; a < axes.count; a++) {
		const kept = lastKept[a] as number;
		let from = axes.first[a] as number;
		if (kept < from) continue;
		firstPiece[a] = pieceAxis.length;
		for (let n = from; n <= kept; n++) {
			pieceOfNode[n] = pieceAxis.length;
			if (n === kept || divides[n]) {
				pieceAxis.push(a);
				pieceFirst.push(from);
				pieceLast.push(n);
				from = n + 1;
			}
		}
	}
	const pieces = pieceAxis.length;
	// Each piece's parent piece and the node it leaves: a piece that runs an axis on leaves the end
	// of the axis's piece before it.
	const parentOf = new Int32Array(pieces);
	const fromNode = new Int32Array(pieces);
	const fromT = new Float64Array(pieces);
	for (let k = 0; k < pieces; k++) {
		const a = pieceAxis[k] as number;
		if (firstPiece[a] !== k) {
			parentOf[k] = k - 1;
			fromNode[k] = pieceLast[k - 1] as number;
			continue;
		}
		const parent = axes.parent[a] as number;
		const node = axes.parentNode[a] as number;
		parentOf[k] = parent >= 0 && node >= 0 ? (pieceOfNode[node] as number) : -1;
		fromNode[k] = node;
		fromT[k] = axes.parentT[a] as number;
	}
	/** Whether a piece leaves its parent piece at the parent's last node. */
	const atPieceEnd = (k: number) => {
		const last = pieceLast[parentOf[k] as number] as number;
		const node = fromNode[k] as number;
		return node === last || (node === last - 1 && (fromT[k] as number) >= 1 - 1e-6);
	};
	// Leaders and the parent each piece hangs on.
	const hangsOn = new Int32Array(pieces);
	const leads = new Uint8Array(pieces);
	for (let k = 0; k < pieces; k++) hangsOn[k] = parentOf[k] as number;
	const ends: number[][] = [];
	for (let k = 0; k < pieces; k++) ends.push([]);
	for (let k = 0; k < pieces; k++) {
		const parent = parentOf[k] as number;
		if (parent >= 0 && meshed(pieceAxis[k] as number) && atPieceEnd(k)) ends[parent]?.push(k);
	}
	for (let k = 0; k < pieces; k++) {
		const atTip = ends[k] as number[];
		if (atTip.length === 0) continue;
		const girth = radius[pieceLast[k] as number] as number;
		let thickest = -1;
		for (const child of atTip) {
			const r = radius[pieceFirst[child] as number] as number;
			if (r < LEADER_SHARE * girth) continue;
			leads[child] = 1;
			if (thickest < 0 || r > (radius[pieceFirst[thickest] as number] as number)) thickest = child;
		}
		if (thickest >= 0) for (const child of atTip) if (!leads[child]) hangsOn[child] = thickest;
	}
	const children: number[][] = [];
	for (let k = 0; k < pieces; k++) children.push([]);
	const queue: number[] = [];
	for (let k = 0; k < pieces; k++) {
		const parent = hangsOn[k] as number;
		if (parent < 0) queue.push(k);
		else if (leads[k]) children[parent]?.unshift(k);
		else children[parent]?.push(k);
	}
	const list: WoodAxis[] = [];
	const indexOf = new Int32Array(pieces).fill(-1);
	let stems = 0;
	for (let q = 0; q < queue.length; q++) {
		const k = queue[q] as number;
		const a = pieceAxis[k] as number;
		const parent = hangsOn[k] as number;
		const first = pieceFirst[k] as number;
		const kept = pieceLast[k] as number;
		if (!meshed(a)) continue;
		const parentIndex = parent >= 0 ? (indexOf[parent] as number) : -1;
		if (parent >= 0 && parentIndex < 0) continue;
		const pts: number[] = [];
		const radii: number[] = [];
		const stem = parent < 0 && rooted(a);
		if (stem) {
			// A stem starts below the ground, along its first internode's line.
			const r0 = radius[first] as number;
			const next = Math.min(kept, first + 1);
			let dx = (p[next * 3] as number) - (p[first * 3] as number);
			let dy = (p[next * 3 + 1] as number) - (p[first * 3 + 1] as number);
			let dz = (p[next * 3 + 2] as number) - (p[first * 3 + 2] as number);
			const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (l > 0) {
				dx /= l;
				dy /= l;
				dz /= l;
			} else dy = 1;
			const depth = BELOW_GROUND * r0 + 0.05;
			pts.push(
				(p[first * 3] as number) - dx * depth,
				(p[first * 3 + 1] as number) - dy * depth,
				(p[first * 3 + 2] as number) - dz * depth,
			);
			radii.push(r0);
		} else if (parent >= 0) {
			// A child starts at its junction on the skeleton's parent: along the internode after its
			// parent node.
			const own = parentOf[k] as number;
			const parentNode = fromNode[k] as number;
			const parentLast = pieceLast[own] as number;
			if (parentNode < 0 || parentNode > parentLast) continue;
			const next = parentNode < parentLast ? parentNode + 1 : parentNode;
			const t = fromT[k] as number;
			const jx = (p[parentNode * 3] as number) * (1 - t) + (p[next * 3] as number) * t;
			const jy = (p[parentNode * 3 + 1] as number) * (1 - t) + (p[next * 3 + 1] as number) * t;
			const jz = (p[parentNode * 3 + 2] as number) * (1 - t) + (p[next * 3 + 2] as number) * t;
			const gap = Math.sqrt(
				(jx - (p[first * 3] as number)) ** 2 +
					(jy - (p[first * 3 + 1] as number)) ** 2 +
					(jz - (p[first * 3 + 2] as number)) ** 2,
			);
			if (leads[k]) {
				const parentWood = list[parentIndex];
				if (parentWood) parentWood.fork = true;
			}
			if (gap > 1e-6) {
				pts.push(jx, jy, jz);
				radii.push(radius[first] as number);
			}
		}
		for (let n = first; n <= kept; n++) {
			pts.push(p[n * 3] as number, p[n * 3 + 1] as number, p[n * 3 + 2] as number);
			radii.push(radius[n] as number);
		}
		if (radii.length < 2) continue;
		const path = roundKinks(
			new Float64Array(pts),
			new Float64Array(radii),
			radii.length,
			KINK_BEND,
		);
		indexOf[k] = list.length;
		list.push({
			axis: a,
			key: firstPiece[a] === k ? a : axes.count + k,
			parent: parentIndex,
			record: base + (axes.record[a] as number),
			points: path.points,
			radii: path.radii,
			count: path.count,
			stem: stem ? stems++ : -1,
			fork: false,
			leader: leads[k] === 1,
			stub: ((skeleton.flags[first] as number) & NODE_STUB) !== 0,
			cut: parent < 0 && (axes.kind[a] as number) === AXIS_LIMB,
		});
		if (stem) addRoots(input, list, list.length - 1, base + (axes.record[a] as number));
		for (const child of children[k] ?? []) queue.push(child);
	}
	return list;
}

/**
 * Adds a stem's surface roots to the list, as children of the stem. A root's axis is a negative
 * number, since the skeleton holds no axis for it, and it moves on the stem's wind record.
 */
function addRoots(input: MeshInput, list: WoodAxis[], stemIndex: number, record: number): void {
	const stem = list[stemIndex] as WoodAxis;
	const { record: species, seed, variant } = input;
	const p = stem.points;
	// The stem's first node, and the frame its path starts with: the normal from +X, square to the
	// stem's first internode, as the mesher builds it.
	const fx = p[3] as number;
	const fy = p[4] as number;
	const fz = p[5] as number;
	let tx = (p[6] as number) - (p[0] as number);
	let ty = (p[7] as number) - (p[1] as number);
	let tz = (p[8] as number) - (p[2] as number);
	const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
	tx /= tl;
	ty /= tl;
	tz /= tl;
	let nx = 1 - tx * tx;
	let ny = -tx * ty;
	let nz = -tx * tz;
	const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
	nx /= nl;
	ny /= nl;
	nz /= nl;
	const binormal: [number, number, number] = [
		ty * nz - tz * ny,
		tz * nx - tx * nz,
		tx * ny - ty * nx,
	];
	const section = stemSection(species.base, seed, species.seedSalt, variant, stem.stem);
	const roots = surfaceRoots(
		species.base,
		section,
		{ x: fx, y: fy, z: fz, radius: stem.radii[1] as number },
		[nx, ny, nz],
		binormal,
		seed,
		species.seedSalt,
		variant,
		stem.stem,
	);
	for (const [k, root] of roots.entries())
		list.push({
			axis: -1 - (stem.stem * 64 + k),
			key: -1 - (stem.stem * 64 + k),
			parent: stemIndex,
			record,
			points: root.points,
			radii: root.radii,
			count: root.radii.length,
			stem: -1,
			fork: false,
			leader: false,
			stub: false,
			cut: false,
		});
}

/** A mesh in growable typed arrays. */
class WoodWriter {
	positions = new Float32Array(3 * 4096);
	normals = new Float32Array(3 * 4096);
	uvs = new Float32Array(2 * 4096);
	uvs1 = new Float32Array(2 * 4096);
	colors = new Uint8Array(4 * 4096);
	indices: number[] = [];
	vertices = 0;

	private grow(): void {
		const count = (this.positions.length / 3) * 2;
		const grown = <T extends Float32Array | Uint8Array>(array: T, length: number): T => {
			const next = new (array.constructor as new (n: number) => T)(length);
			next.set(array);
			return next;
		};
		this.positions = grown(this.positions, count * 3);
		this.normals = grown(this.normals, count * 3);
		this.uvs = grown(this.uvs, count * 2);
		this.uvs1 = grown(this.uvs1, count * 2);
		this.colors = grown(this.colors, count * 4);
	}

	/** Whether the axis being written draws the grown bark layer rather than the young bark. */
	grownBark = 0;

	/** The species' young-bark radius in metres: the girth below which thin wood draws young bark. */
	youngRadius = 0;

	vertex(
		rings: AxisRings,
		i: number,
		u: number,
		record: number,
		bend: number,
		sky: number,
	): number {
		if (this.vertices * 3 >= this.positions.length) this.grow();
		const w = this.vertices;
		const positions = this.positions;
		const normals = this.normals;
		const from = rings.position;
		const normal = rings.vertexNormal;
		positions[w * 3] = from[i * 3] as number;
		positions[w * 3 + 1] = from[i * 3 + 1] as number;
		positions[w * 3 + 2] = from[i * 3 + 2] as number;
		normals[w * 3] = normal[i * 3] as number;
		normals[w * 3 + 1] = normal[i * 3 + 1] as number;
		normals[w * 3 + 2] = normal[i * 3 + 2] as number;
		const uvs = this.uvs;
		uvs[w * 2] = u;
		uvs[w * 2 + 1] = rings.vv[i] as number;
		const uvs1 = this.uvs1;
		// A fleshy young shoot draws the grown bark layer: its radius is reported high enough that
		// the shader's young wood test passes it over, and the displacement still fades on it.
		const pipe = rings.pipe[i] as number;
		const grown = this.grownBark ? Math.max(pipe, this.youngRadius * 1.5) : pipe;
		uvs1[w * 2] = Math.min(1, grown / WOOD_RADIUS_RANGE);
		uvs1[w * 2 + 1] = Math.min(1, Math.max(0, rings.mask[i] as number));
		const colors = this.colors;
		colors[w * 4] = (record >>> 8) & 255;
		colors[w * 4 + 1] = record & 255;
		colors[w * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, bend)));
		colors[w * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, sky)));
		this.vertices = w + 1;
		return w;
	}

	/** Writes a vertex given in full, as a peeling strip's are. */
	free(
		px: number,
		py: number,
		pz: number,
		nx: number,
		ny: number,
		nz: number,
		u: number,
		v: number,
		pipe: number,
		record: number,
		bend: number,
		sky: number,
	): number {
		if (this.vertices * 3 >= this.positions.length) this.grow();
		const w = this.vertices;
		this.positions[w * 3] = px;
		this.positions[w * 3 + 1] = py;
		this.positions[w * 3 + 2] = pz;
		this.normals[w * 3] = nx;
		this.normals[w * 3 + 1] = ny;
		this.normals[w * 3 + 2] = nz;
		this.uvs[w * 2] = u;
		this.uvs[w * 2 + 1] = v;
		this.uvs1[w * 2] = Math.min(1, pipe / WOOD_RADIUS_RANGE);
		this.uvs1[w * 2 + 1] = 0;
		this.colors[w * 4] = (record >>> 8) & 255;
		this.colors[w * 4 + 1] = record & 255;
		this.colors[w * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, bend)));
		this.colors[w * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, sky)));
		this.vertices = w + 1;
		return w;
	}

	finish(): MeshArrays {
		const n = this.vertices;
		return {
			positions: this.positions.slice(0, n * 3),
			normals: this.normals.slice(0, n * 3),
			uvs: this.uvs.slice(0, n * 2),
			uvs1: this.uvs1.slice(0, n * 2),
			colors: this.colors.slice(0, n * 4),
			indices: n > 0xffff ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
		};
	}
}

/** Everything one axis's meshing reads. */
interface AxisContext {
	readonly wood: WoodAxis;
	readonly path: AxisPath;
	readonly section: StemSection | undefined;
	/** Cumulative metres of bark at each path sample, from the axis's start. */
	readonly barkV: Float64Array;
	/** `v` at the axis's start. */
	readonly v0: number;
	/** The whole repeats of the bark that this axis's `v` runs lower than its parent's. */
	readonly shift: number;
	/** The fillet's radius in metres where the child meets its parent; none on a stem. */
	readonly fillet: number;
	/** Arc length where the collar starts, its length and its swell; no swell on a stem. */
	readonly collarFrom: number;
	readonly collarLength: number;
	readonly swell: number;
	/** A fork leader's radius at its start, easing to its pipe radius over the taper's length. */
	readonly taper: number;
	readonly taperLength: number;
}

/** The share over the plain radius under which a stem's foot counts as eased. */
const FOOT_EASED = 0.12;
/** Angles round a stem at which its foot's swell is read. */
const FOOT_ANGLES = 16;

/** The perimeter of one ring, in metres, from its vertices. */
function ringPerimeter(rings: AxisRings, r: number): number {
	const first = rings.first[r] as number;
	const sides = rings.sides[r] as number;
	let perimeter = 0;
	for (let j = 0; j < sides; j++) {
		const a = (first + j) * 3;
		const b = (first + ((j + 1) % sides)) * 3;
		perimeter += Math.sqrt(
			((rings.position[a] as number) - (rings.position[b] as number)) ** 2 +
				((rings.position[a + 1] as number) - (rings.position[b + 1] as number)) ** 2 +
				((rings.position[a + 2] as number) - (rings.position[b + 2] as number)) ** 2,
		);
	}
	return perimeter;
}

/**
 * How the bark's `u` runs over an axis's rings, in the order they are written: each entry a ring,
 * the metres its `u` spans once round, its top line's `u`, and whether it starts a new run of tiles,
 * repeating the ring before with another count, so no strip joins it to the ring before.
 */
interface BarkRings {
	readonly ring: number[];
	readonly span: number[];
	readonly top: number[];
	readonly restart: boolean[];
	/** Per entry: the run's tile count (0 for true meters) and its tile width. */
	readonly tiles: number[];
	readonly width: number[];
}

/** The bark of a run of rings that a fork's leader takes on from its parent. */
interface BarkRun {
	readonly tiles: number;
	readonly width: number;
	readonly span: number;
	readonly top: number;
}

/** A ring's mean radius and perimeter. */
interface RingShape {
	perimeter: number;
	mean: number;
}

/**
 * A record of every plain ring the mesher built, for tests that measure the bark: per ring, its
 * axis, pipe radius, the metres of bark its `u` spans once round, its perimeter in metres, the girth
 * scale, its `v` and arc length, whether it blends from a weld, and whether it stands on a stem's
 * foot, whose plates widen over the flare.
 */
export interface WoodRings {
	readonly axis: number[];
	readonly pipe: number[];
	readonly span: number[];
	readonly perimeter: number[];
	readonly scale: number[];
	readonly v: number[];
	readonly arc: number[];
	readonly weld: boolean[];
	readonly foot: boolean[];
}

/**
 * What the mesher records about each weld, for tests: the child's axis and its weld ring in the
 * written mesh, and each axis's run of written vertices.
 */
export interface WoodWelds {
	readonly child: number[];
	/** The first written vertex of the weld ring, and its count (sides + 1). */
	readonly first: number[];
	readonly vertices: number[];
	/** The first written vertex of each meshed piece and its count, by the piece's key. */
	readonly axisFirst: Map<number, [number, number]>;
}

/**
 * The mesher for one variant at one level. It keeps the rings of every axis it has built, so each
 * child welds onto its parent.
 */
class Mesher {
	private readonly record: Species;
	private readonly axes: MacroSkeleton['axes'];
	private readonly bark: BarkScale;
	private readonly tube: TubeDetail;
	private readonly seed: number;
	private readonly variant: number;
	private readonly crown: CrownLight;
	private readonly writer = new WoodWriter();
	private readonly built: (AxisRings | undefined)[] = [];
	private readonly contexts: (AxisContext | undefined)[] = [];
	private readonly barks: (BarkRings | undefined)[] = [];
	/** Per axis: the output vertex where each written bark ring starts, for the parent's crotch mask. */
	private readonly outputRingFirst = new Map<number, Int32Array>();
	private readonly frame: PathFrame = emptyFrame();
	private readonly sample: PathSample = { radius: 0, height: 0 };
	private readonly place: SurfacePlace = { ring: 0, t: 0, angle: 0, v: 0 };
	private readonly normal = new Float64Array(3);
	private readonly outward = new Float64Array(3);
	private readonly shapeOut: RingShape = { perimeter: 0, mean: 0 };
	readonly rings: WoodRings | undefined;
	readonly welds: WoodWelds | undefined;

	constructor(input: MeshInput, level: MeshLevel, report: boolean) {
		this.record = input.record;
		this.axes = input.skeleton.axes;
		this.seed = input.seed;
		this.variant = input.variant;
		this.crown = input.crown;
		this.bark = barkScale(input.record, input.kit.manifest, largestRadius(input.skeleton));
		this.tube = tubeDetail(level, input.detail, input.coarseness ?? 0);
		this.rings = report
			? {
					axis: [],
					pipe: [],
					span: [],
					perimeter: [],
					scale: [],
					v: [],
					arc: [],
					weld: [],
					foot: [],
				}
			: undefined;
		this.welds = report ? { child: [], first: [], vertices: [], axisFirst: new Map() } : undefined;
	}

	/** Meters of bark after which the bark repeats. */
	get period(): number {
		return this.bark.period;
	}

	/**
	 * The rings built for an axis of the list.
	 *
	 * @param index The axis's place in the list.
	 * @returns Its rings, or undefined when it was not meshed.
	 */
	ringsOf(index: number): AxisRings | undefined {
		return this.built[index];
	}

	/** Meshes every axis, parents first. */
	run(axes: readonly WoodAxis[], variant: number): MeshArrays {
		for (let i = 0; i < axes.length; i++) this.axis(axes, i, variant);
		return this.writer.finish();
	}

	/** The section's radius at a pipe radius and height: the collar's swell, then the stem's foot. */
	private sectionRadius(
		context: AxisContext,
		s: number,
		pipe: number,
		height: number,
		theta: number,
	): number {
		let radius = pipe;
		if (context.taperLength > 0 && s < context.taperLength) {
			const ease = 1 - s / context.taperLength;
			radius += (context.taper - pipe) * ease * ease;
		}
		if (context.swell > 0 || context.fillet > 0) {
			const d = s - context.collarFrom;
			radius *= 1 + context.swell * (d < 0 ? 1 : collarShare(d, context.collarLength));
			radius += filletWidening(d, context.fillet);
		}
		return context.section ? context.section.radius(height, theta, radius) : radius;
	}

	/** The section's radius at an arc length and angle. */
	private rho(context: AxisContext, s: number, theta: number): number {
		sampleAt(context.path, s, this.sample);
		return this.sectionRadius(context, s, this.sample.radius, this.sample.height, theta);
	}

	/** The mean radius and perimeter of a ring at an arc length. */
	private shape(context: AxisContext, s: number): RingShape {
		const out = this.shapeOut;
		sampleAt(context.path, s, this.sample);
		const pipe = this.sample.radius;
		const height = this.sample.height;
		if (!context.section) {
			out.mean = this.sectionRadius(context, s, pipe, height, 0);
			out.perimeter = 2 * PI * out.mean;
			return out;
		}
		const samples = 24;
		const trig = ringTrig(samples);
		let sum = 0;
		let perimeter = 0;
		let x0 = 0;
		let y0 = 0;
		let px = 0;
		let py = 0;
		for (let k = 0; k < samples; k++) {
			const theta = (k / samples) * 2 * PI;
			const radius = this.sectionRadius(context, s, pipe, height, theta);
			const x = radius * (trig[k * 2] as number);
			const y = radius * (trig[k * 2 + 1] as number);
			if (k === 0) {
				x0 = x;
				y0 = y;
			} else perimeter += Math.sqrt((x - px) ** 2 + (y - py) ** 2);
			sum += radius;
			px = x;
			py = y;
		}
		perimeter += Math.sqrt((x0 - px) ** 2 + (y0 - py) ** 2);
		out.mean = sum / samples;
		out.perimeter = perimeter;
		return out;
	}

	/** Metres of bark at an arc length of an axis. */
	private vAt(context: AxisContext, s: number): number {
		const path = context.path;
		if (s <= 0) return context.v0 + s / this.bark.scale(path.radius[0] as number);
		const last = path.count - 1;
		if (s >= path.length)
			return (
				context.v0 +
				(context.barkV[last] as number) +
				(s - path.length) / this.bark.scale(path.radius[last] as number)
			);
		let low = 0;
		let high = last;
		while (high - low > 1) {
			const middle = (low + high) >> 1;
			if ((path.arc[middle] as number) <= s) low = middle;
			else high = middle;
		}
		const a0 = path.arc[low] as number;
		const a1 = path.arc[high] as number;
		const t = a1 > a0 ? (s - a0) / (a1 - a0) : 0;
		return (
			context.v0 + (context.barkV[low] as number) * (1 - t) + (context.barkV[high] as number) * t
		);
	}

	/**
	 * The surface normal at an arc length and angle, with the slopes of the radius along the axis
	 * and round it. `frame` must hold the frame at `s`.
	 */
	private surfaceNormal(
		context: AxisContext,
		s: number,
		theta: number,
		c: number,
		n: number,
		frame: PathFrame,
		out: Float64Array,
	): void {
		const radius = this.rho(context, s, theta);
		const ds = Math.max(1e-4, radius * 0.1);
		const slopeS = (this.rho(context, s + ds, theta) - this.rho(context, s - ds, theta)) / (2 * ds);
		let slopeTheta = 0;
		if (context.section) {
			const dt = 0.02;
			slopeTheta = (this.rho(context, s, theta + dt) - this.rho(context, s, theta - dt)) / (2 * dt);
		}
		this.normalFrom(frame, c, n, radius > 0 ? slopeTheta / radius : 0, slopeS, out);
	}

	/** A section's normal from its frame, its angle and the slopes of its radius. */
	private normalFrom(
		frame: PathFrame,
		c: number,
		n: number,
		roundSlope: number,
		alongSlope: number,
		out: Float64Array,
	): void {
		for (let k = 0; k < 3; k++) {
			const er = c * (frame.normal[k] as number) + n * (frame.binormal[k] as number);
			const et = -n * (frame.normal[k] as number) + c * (frame.binormal[k] as number);
			out[k] = er - roundSlope * et - alongSlope * (frame.tangent[k] as number);
		}
	}

	/** Meshes one axis and keeps its rings. */
	private axis(axes: readonly WoodAxis[], index: number, variant: number): void {
		const wood = axes[index] as WoodAxis;
		const parentRings = wood.parent >= 0 ? this.built[wood.parent] : undefined;
		const parentContext = wood.parent >= 0 ? this.contexts[wood.parent] : undefined;
		if (wood.parent >= 0 && (!parentRings || !parentContext)) return;
		// The first frame's normal points to a child's underside: away from where its parent runs on.
		let normal0: [number, number, number] = [1, 0, 0];
		const p = wood.points;
		let junctionArc = 0;
		if (parentContext && wood.leader) {
			// A leader's frame starts as its parent's last ring's, so its first ring is that ring.
			junctionArc = parentContext.path.length;
			frameAt(parentContext.path, junctionArc, this.frame);
			const pn = this.frame.normal;
			normal0 = [pn[0] as number, pn[1] as number, pn[2] as number];
		} else if (parentContext) {
			junctionArc = nearestArc(parentContext.path, p[0] as number, p[1] as number, p[2] as number);
			frameAt(parentContext.path, junctionArc, this.frame);
			const dx = (p[3] as number) - (p[0] as number);
			const dy = (p[4] as number) - (p[1] as number);
			const dz = (p[5] as number) - (p[2] as number);
			const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			const pt = this.frame.tangent;
			const dot = ((pt[0] as number) * dx + (pt[1] as number) * dy + (pt[2] as number) * dz) / l;
			normal0 = [
				-((pt[0] as number) - (dot * dx) / l),
				-((pt[1] as number) - (dot * dy) / l),
				-((pt[2] as number) - (dot * dz) / l),
			];
		}
		const path = axisPath(wood.points, wood.radii, wood.count, normal0);
		const barkV = new Float64Array(path.count);
		for (let i = 1; i < path.count; i++) {
			const step = (path.arc[i] as number) - (path.arc[i - 1] as number);
			const a = 1 / this.bark.scale(path.radius[i - 1] as number);
			const b = 1 / this.bark.scale(path.radius[i] as number);
			barkV[i] = (barkV[i - 1] as number) + (step * (a + b)) / 2;
		}
		const section =
			wood.stem >= 0
				? stemSection(this.record.base, this.seed, this.record.seedSalt, variant, wood.stem)
				: undefined;
		let context: AxisContext = {
			wood,
			path,
			section,
			barkV,
			v0: parentContext ? this.vAt(parentContext, junctionArc) : 0,
			shift: 0,
			collarFrom: 0,
			collarLength: 0,
			swell: 0,
			fillet: 0,
			taper: 0,
			taperLength: 0,
		};
		// A child's v starts whole repeats of the bark lower than its parent's, so v stays small. Half
		// a repeat stays below its start, where its weld reaches down the parent.
		const period = this.bark.period;
		const shift = Math.max(0, Math.floor((context.v0 - period / 2) / period) * period);
		context = { ...context, v0: context.v0 - shift, shift };
		const rings = new AxisRings();
		let start = 0;
		let sides = 0;
		let inherit: BarkRun | undefined;
		if (parentRings && parentContext && wood.leader) {
			const led = this.lead(context, parentRings, parentContext, rings);
			context = led.context;
			start = led.end;
			sides = led.sides;
			const parentBark = this.barks[wood.parent] as BarkRings;
			const e = parentBark.ring.length - 1;
			inherit = {
				tiles: parentBark.tiles[e] as number,
				width: parentBark.width[e] as number,
				span: parentBark.span[e] as number,
				top: parentBark.top[e] as number,
			};
		} else if (parentRings && parentContext) {
			const weld = this.weld(context, parentRings, parentContext, junctionArc, rings);
			if (!weld) return;
			context = weld.context;
			start = weld.end;
			sides = weld.sides;
		}
		const reach = section ? section.reach : 0;
		const welded = context;
		const arcs = ringArcs(
			path,
			start,
			(s) => this.shape(welded, s).mean,
			this.tube,
			(s) => reach > 0 && sampleAt(path, s, this.sample).height < reach,
		);
		for (const s of arcs) {
			const shape = this.shape(context, s);
			sides = heldSides(sidesFor(shape.perimeter, shape.mean, this.tube), sides);
			this.plainRing(context, s, sides, rings);
		}
		// A fork's leaders take its last ring; its low rounded end floors the crotch between them and
		// takes the welds of thinner children near the end.
		this.tip(context, rings, wood.fork);
		// A dead stub weathers with the wood it stands on: its bark is grown bark, never the smooth
		// young bark of a live shoot of its girth. A cut limb is severed wood too, and its sawn end
		// shows grown bark rather than the young layer a twig of the same girth would carry.
		const young = this.record.bark?.youngRadius ?? 0;
		if (wood.stub || wood.cut)
			for (let i = 0; i < rings.vertices; i++)
				rings.pipe[i] = Math.max(rings.pipe[i] as number, STUB_BARK * young);
		const bark = this.barkOf(rings, context, inherit);
		this.built[index] = rings;
		this.contexts[index] = context;
		this.barks[index] = bark;
		this.write(rings, bark, context, wood);
	}

	/** One plain ring of an axis, with the section's normals. */
	private plainRing(context: AxisContext, s: number, sides: number, rings: AxisRings): void {
		const path = context.path;
		const f = frameAt(path, s, this.frame);
		rings.begin(sides, s, f.position, f.tangent, f.normal, f.binormal, this.vAt(context, s));
		const pipe = f.radius;
		const v = rings.v[rings.count - 1] as number;
		const normal = this.normal;
		// Off the stem's foot the section is round, so one radius and one slope serve every side.
		let round = 0;
		let roundSlope = 0;
		if (!context.section) {
			round = this.rho(context, s, 0);
			const ds = Math.max(1e-4, round * 0.1);
			roundSlope = (this.rho(context, s + ds, 0) - this.rho(context, s - ds, 0)) / (2 * ds);
		}
		const cx = f.position[0] as number;
		const cy = f.position[1] as number;
		const cz = f.position[2] as number;
		const trig = ringTrig(sides);
		for (let j = 0; j < sides; j++) {
			const theta = (j / sides) * 2 * PI;
			const c = trig[j * 2] as number;
			const n = trig[j * 2 + 1] as number;
			let radius = round;
			if (context.section) {
				radius = this.rho(context, s, theta);
				this.surfaceNormal(context, s, theta, c, n, f, normal);
			} else this.normalFrom(f, c, n, 0, roundSlope, normal);
			const mask =
				context.collarLength > 0
					? junctionMask(s - context.collarFrom, context.collarLength, c)
					: 0;
			rings.vertex(
				cx + radius * (c * (f.normal[0] as number) + n * (f.binormal[0] as number)),
				cy + radius * (c * (f.normal[1] as number) + n * (f.binormal[1] as number)),
				cz + radius * (c * (f.normal[2] as number) + n * (f.binormal[2] as number)),
				normal[0] as number,
				normal[1] as number,
				normal[2] as number,
				radius,
				v,
				mask,
				pipe,
				s,
			);
		}
	}

	/** A point on one line of a child's tube: its side at an angle, at an arc length. */
	private linePoint(
		context: AxisContext,
		s: number,
		theta: number,
		c: number,
		n: number,
		out: Float64Array,
	): void {
		const radius = this.rho(context, s, theta);
		const f = frameAt(context.path, s, this.frame);
		for (let k = 0; k < 3; k++)
			out[k] =
				(f.position[k] as number) +
				radius * (c * (f.normal[k] as number) + n * (f.binormal[k] as number));
	}

	/**
	 * Welds a child onto its parent: the first ring on the parent's triangles, then blend rings to
	 * the child's own circle. Returns where the child's plain rings start, or nothing when the child
	 * never leaves its parent.
	 */
	private weld(
		context: AxisContext,
		parentRings: AxisRings,
		parentContext: AxisContext,
		junctionArc: number,
		rings: AxisRings,
	): { context: AxisContext; end: number; sides: number } | undefined {
		const path = context.path;
		const surface = new ParentSurface(parentRings);
		const rc = path.radius[0] as number;
		// The parent's least radius about the joint: its girth drops past the node where a thick child
		// takes its share of the pipes.
		let rp = this.shape(parentContext, junctionArc).mean;
		rp = Math.min(rp, this.shape(parentContext, junctionArc - rc).mean);
		rp = Math.min(
			rp,
			this.shape(parentContext, Math.min(parentContext.path.length, junctionArc + rc)).mean,
		);
		// A child that leaves nearly along its parent stays inside it for long, so the search runs the
		// whole child.
		const reach = path.length;
		surface.window(junctionArc - reach - 2 * rp, junctionArc + reach + 2 * rp);
		const point = new Float64Array(3);
		const centre = (s: number, out: Float64Array) => {
			const f = frameAt(path, s, this.frame);
			out[0] = f.position[0] as number;
			out[1] = f.position[1] as number;
			out[2] = f.position[2] as number;
		};
		const leaves = this.exitAlong(surface, centre, reach, rc, point) ?? 0;
		if (leaves >= path.length) return undefined;
		const collar = this.record.bark?.collar;
		// A child nearly as thick as its parent narrows at its foot to fit inside the parent, and
		// widens back to its own girth within the blend, so every side of it starts inside.
		const foot = Math.min(rc, BASE_CAP * rp);
		const swell = Math.max(
			0,
			Math.min(collar?.swell ?? 0, (COLLAR_CAP * rp) / Math.max(foot, 1e-6) - 1),
		);
		const collarLength = Math.max(rc, (collar?.length ?? 1) * rc);
		const fillet = Math.max(0, Math.min(FILLET_RADII * foot, COLLAR_CAP * rp - foot * (1 + swell)));
		// The seam is sought on the child at its widest, the fillet and the collar in full; each
		// side's fillet and collar then ease from that side's own seam.
		const seeking: AxisContext = {
			...context,
			collarFrom: path.length,
			collarLength,
			swell,
			fillet,
			taper: foot,
			taperLength: foot < rc ? leaves + BLEND_RADII * rc : 0,
		};
		// The weld ring's side count is the child's at the end of its blend.
		const guess = this.shape(context, Math.min(path.length, leaves + BLEND_RADII * rc));
		const sides = sidesFor(guess.perimeter, guess.mean, this.tube);
		const seamS = new Float64Array(sides);
		const seamX = new Float64Array(sides * 3);
		const seamN = new Float64Array(sides * 3);
		const seamV = new Float64Array(sides);
		const before = new Float64Array(3);
		const after = new Float64Array(3);
		const hit: SurfaceHit = { share: 0, v: 0, normal: new Float64Array(3) };
		const back = Math.max(0.01, 0.5 * rc);
		const trig = ringTrig(sides);
		for (let j = 0; j < sides; j++) {
			const theta = (j / sides) * 2 * PI;
			const c = trig[j * 2] as number;
			const n = trig[j * 2 + 1] as number;
			const line = (s: number, out: Float64Array) => this.linePoint(seeking, s, theta, c, n, out);
			let s = this.exitAlong(surface, line, reach, rc, point);
			if (s === undefined) {
				// The line starts outside the parent: put its start on the parent's surface.
				s = leaves;
				line(s, point);
				const d = surface.distance(point[0] as number, point[1] as number, point[2] as number);
				const n = this.normal;
				surface.normal(point[0] as number, point[1] as number, point[2] as number, 1e-3 * rp, n);
				for (let k = 0; k < 3; k++) point[k] = (point[k] as number) - d * (n[k] as number);
			} else line(s, point);
			surface.distance(point[0] as number, point[1] as number, point[2] as number, this.place);
			// Put the vertex on the parent's own triangles, where the line crosses them.
			line(s - back, before);
			line(s + back, after);
			if (surface.snap(before, after, this.place, hit)) {
				for (let k = 0; k < 3; k++)
					point[k] =
						(before[k] as number) + hit.share * ((after[k] as number) - (before[k] as number));
				s += (2 * hit.share - 1) * back;
				seamV[j] = hit.v - context.shift;
				seamN.set(hit.normal, j * 3);
			} else if (this.wideSnap(surface, line, s, reach, rp + rc, before, after, hit)) {
				// The distance query strayed: the side's whole line found the crossing instead.
				for (let k = 0; k < 3; k++)
					point[k] =
						(before[k] as number) + hit.share * ((after[k] as number) - (before[k] as number));
				s = hit.share * Math.min(reach, s + rp + rc);
				seamV[j] = hit.v - context.shift;
				seamN.set(hit.normal, j * 3);
			} else {
				// The last resort: the nearest point of the parent's own triangles.
				surface.nearest(point, this.place, hit);
				seamV[j] = hit.v - context.shift;
				seamN.set(hit.normal, j * 3);
			}
			seamS[j] = s;
			seamX.set(point, j * 3);
		}
		let lowest = Number.POSITIVE_INFINITY;
		let highest = 0;
		for (let j = 0; j < sides; j++) {
			lowest = Math.min(lowest, seamS[j] as number);
			highest = Math.max(highest, seamS[j] as number);
		}
		// A species whose bark draws the armpit's creases marks the parent's bark round the seam
		// too: the photograph's fan sits on the parent's crotch, not on the child's weld alone.
		if ((this.record.bark?.collar.creases ?? 0) > 0)
			this.markParentCrotch(parentContext.wood.key, parentRings, seamX, sides, rp);
		// The blend holds the whole fillet and collar, so the plain rings after it are the child's own.
		const end = Math.min(path.length, highest + Math.max(BLEND_RADII * rc, collarLength));
		// Blend rings follow the girth: a thin child's fillet is too small to need many.
		const blend =
			rc < THIN
				? 2
				: rc < 2.5 * THIN
					? 3
					: Math.max(3, Math.min(BLEND_RINGS[this.tube.level], Math.ceil((end - lowest) / rc) + 1));
		// One context per side, its fillet and collar easing from its own seam.
		const columns: AxisContext[] = [];
		for (let j = 0; j < sides; j++) columns.push({ ...seeking, collarFrom: seamS[j] as number });
		const f = this.frame;
		const normal = this.normal;
		const ring = new Float64Array(9);
		// The blend's rings are laid out first and written after, so each side's bark v can follow
		// the length of its own line over the fillet, from the parent's v at the seam to the child's
		// own v at its first plain ring.
		const frames = new Float64Array(blend * 13);
		const cells = new Float64Array(blend * sides * 9);
		const pipes = new Float64Array(blend * sides);
		for (let b = 0; b < blend; b++) {
			// Rings crowd toward the weld, where the fillet curves most, and the normal turns from the
			// parent's to the fillet's own over the first rings.
			const step = b / blend;
			const t = step * step;
			const turn = Math.min(1, 2 * step);
			const smooth = turn * turn * (3 - 2 * turn);
			const nominal = lowest + t * (end - lowest);
			frameAt(path, nominal, f);
			ring.set(f.position, 0);
			ring.set(f.normal, 3);
			ring.set(f.binormal, 6);
			frames[b * 13] = nominal;
			frames.set(f.position, b * 13 + 1);
			frames.set(f.tangent, b * 13 + 4);
			frames.set(f.normal, b * 13 + 7);
			frames.set(f.binormal, b * 13 + 10);
			for (let j = 0; j < sides; j++) {
				const column = columns[j] as AxisContext;
				const theta = (j / sides) * 2 * PI;
				const c = trig[j * 2] as number;
				const n = trig[j * 2 + 1] as number;
				const sj = seamS[j] as number;
				const s = sj + t * (end - sj);
				if (b === 0) {
					point[0] = seamX[j * 3] as number;
					point[1] = seamX[j * 3 + 1] as number;
					point[2] = seamX[j * 3 + 2] as number;
				} else {
					this.linePoint(column, s, theta, c, n, point);
					// On the sharp side of a crotch the fillet can curve back into the parent; keep the
					// blend just outside the parent's surface.
					// The first blend ring stands further clear, so a parent that curves outward, as a
					// flared foot does, cannot show through the short strip from the weld.
					const clearance = Math.max(CLEARANCE, (b === 1 ? 0.08 : 0.02) * rc);
					for (let tries = 0; tries < 4; tries++) {
						const d = surface.distance(point[0] as number, point[1] as number, point[2] as number);
						if (d >= clearance * 0.5) break;
						const out = this.outward;
						out[0] = 0;
						out[1] = 0;
						out[2] = 0;
						surface.normal(
							point[0] as number,
							point[1] as number,
							point[2] as number,
							Math.max(1e-4, 1e-3 * rp),
							out,
						);
						for (let k = 0; k < 3; k++)
							point[k] = (point[k] as number) + (clearance - d) * (out[k] as number);
					}
				}
				frameAt(path, s, f);
				this.surfaceNormal(column, s, theta, c, n, f, normal);
				const nl =
					Math.sqrt(
						(normal[0] as number) ** 2 + (normal[1] as number) ** 2 + (normal[2] as number) ** 2,
					) || 1;
				let ox = normal[0] as number;
				let oy = normal[1] as number;
				let oz = normal[2] as number;
				if (b === 0) {
					// In a steep crotch the parent's normal faces away from the child's first strip; bend
					// it toward the child's own normal just enough that the strip shades as facing out.
					const px = seamN[j * 3] as number;
					const py = seamN[j * 3 + 1] as number;
					const pz = seamN[j * 3 + 2] as number;
					const agree = (px * ox + py * oy + pz * oz) / nl;
					const lift = agree < FACING ? FACING - agree + 0.05 : 0;
					ox = px + (lift * ox) / nl;
					oy = py + (lift * oy) / nl;
					oz = pz + (lift * oz) / nl;
					const bent = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
					seamN[j * 3] = ox / bent;
					seamN[j * 3 + 1] = oy / bent;
					seamN[j * 3 + 2] = oz / bent;
				} else {
					ox = (seamN[j * 3] as number) * (1 - smooth) + (ox / nl) * smooth;
					oy = (seamN[j * 3 + 1] as number) * (1 - smooth) + (oy / nl) * smooth;
					oz = (seamN[j * 3 + 2] as number) * (1 - smooth) + (oz / nl) * smooth;
				}
				// The radius from the ring's centre in its plane, for the child's own children.
				const dx = (point[0] as number) - (ring[0] as number);
				const dy = (point[1] as number) - (ring[1] as number);
				const dz = (point[2] as number) - (ring[2] as number);
				const rx = dx * (ring[3] as number) + dy * (ring[4] as number) + dz * (ring[5] as number);
				const ry = dx * (ring[6] as number) + dy * (ring[7] as number) + dz * (ring[8] as number);
				const at = (b * sides + j) * 9;
				cells[at] = point[0] as number;
				cells[at + 1] = point[1] as number;
				cells[at + 2] = point[2] as number;
				cells[at + 3] = ox;
				cells[at + 4] = oy;
				cells[at + 5] = oz;
				cells[at + 6] = Math.sqrt(rx * rx + ry * ry);
				cells[at + 7] = junctionMask(s - sj, collarLength, c);
				cells[at + 8] = s;
				pipes[b * sides + j] = f.radius;
			}
		}
		// Past the blend the child is its own: no fillet, no collar, no mask.
		const welded: AxisContext = { ...context, collarFrom: highest, collarLength, swell, fillet: 0 };
		// Each side's v runs from the seam to the first plain ring in step with the length of its line.
		const vEnd = this.vAt(welded, end);
		const own = this.rho(welded, end, 0);
		const lengths = new Float64Array(blend + 1);
		const vs = new Float64Array(blend * sides);
		for (let j = 0; j < sides; j++) {
			const c = trig[j * 2] as number;
			const n = trig[j * 2 + 1] as number;
			frameAt(path, end, f);
			for (let k = 0; k < 3; k++)
				point[k] =
					(f.position[k] as number) +
					own * (c * (f.normal[k] as number) + n * (f.binormal[k] as number));
			for (let b = 1; b <= blend; b++) {
				const from = ((b - 1) * sides + j) * 9;
				const to = b < blend ? (b * sides + j) * 9 : -1;
				let step = 0;
				for (let k = 0; k < 3; k++)
					step +=
						((to >= 0 ? (cells[to + k] as number) : (point[k] as number)) -
							(cells[from + k] as number)) **
						2;
				lengths[b] = (lengths[b - 1] as number) + Math.sqrt(step);
			}
			const total = (lengths[blend] as number) || 1;
			const v0 = seamV[j] as number;
			for (let b = 0; b < blend; b++)
				vs[b * sides + j] = v0 + (vEnd - v0) * ((lengths[b] as number) / total);
		}
		for (let b = 0; b < blend; b++) {
			const fr = b * 13;
			rings.begin(
				sides,
				frames[fr] as number,
				frames.subarray(fr + 1, fr + 4),
				frames.subarray(fr + 4, fr + 7),
				frames.subarray(fr + 7, fr + 10),
				frames.subarray(fr + 10, fr + 13),
				this.vAt(context, frames[fr] as number),
			);
			for (let j = 0; j < sides; j++) {
				const at = (b * sides + j) * 9;
				rings.vertex(
					cells[at] as number,
					cells[at + 1] as number,
					cells[at + 2] as number,
					cells[at + 3] as number,
					cells[at + 4] as number,
					cells[at + 5] as number,
					cells[at + 6] as number,
					vs[b * sides + j] as number,
					cells[at + 7] as number,
					pipes[b * sides + j] as number,
					cells[at + 8] as number,
				);
			}
		}
		rings.welded = blend;
		return { context: welded, end, sides };
	}

	/**
	 * Marks the parent's written bark round a fork's end, where the leaders part: the creases gather
	 * over one and a half parent radii up the parent from the fork. The mark is strongest on the
	 * side the leader leans toward, where the two limbs form the armpit, so the fan stays on the
	 * crotch rather than ringing the whole stem. Only a record that names creases calls this, so
	 * every other species' bark coordinates stay as they were.
	 */
	private markParentFork(
		key: number,
		rings: AxisRings,
		arc: number,
		radius: number,
		toward: Float64Array,
	): void {
		const ends = this.outputRingFirst.get(key);
		if (!ends) return;
		const reach = Math.max(radius * 1.5, 1e-3);
		const uvs1 = this.writer.uvs1;
		for (let r = 0; r < rings.count; r++) {
			const out = ends[r] as number;
			if (out < 0) continue;
			const distance = Math.abs((rings.arc[r] as number) - arc);
			if (distance >= reach) continue;
			const fade = 1 - distance / reach;
			const count = rings.sides[r] as number;
			const cx = rings.centre[r * 3] as number;
			const cy = rings.centre[r * 3 + 1] as number;
			const cz = rings.centre[r * 3 + 2] as number;
			const first = rings.first[r] as number;
			for (let j = 0; j <= count; j++) {
				const i = first + (j % count);
				const dx = (rings.position[i * 3] as number) - cx;
				const dy = (rings.position[i * 3 + 1] as number) - cy;
				const dz = (rings.position[i * 3 + 2] as number) - cz;
				const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
				const side = Math.max(
					0,
					(dx * (toward[0] as number) + dy * (toward[1] as number) + dz * (toward[2] as number)) /
						length,
				);
				const mask = fade * fade * (0.25 + 0.75 * side);
				const to = (out + j) * 2 + 1;
				if ((uvs1[to] as number) < mask) uvs1[to] = mask;
			}
		}
	}

	/**
	 * Marks the parent's written bark round a child's seam, so the crease fan reaches the crotch on
	 * the parent as the photograph shows it. Only a record that names creases calls this, so every
	 * other species' bark coordinates stay as they were.
	 */
	private markParentCrotch(
		key: number,
		rings: AxisRings,
		seam: Float64Array,
		sides: number,
		radius: number,
	): void {
		const ends = this.outputRingFirst.get(key);
		if (!ends) return;
		let cx = 0;
		let cy = 0;
		let cz = 0;
		for (let j = 0; j < sides; j++) {
			cx += seam[j * 3] as number;
			cy += seam[j * 3 + 1] as number;
			cz += seam[j * 3 + 2] as number;
		}
		cx /= sides;
		cy /= sides;
		cz /= sides;
		const reach = Math.max(radius * 1.5, 1e-3);
		const uvs1 = this.writer.uvs1;
		for (let r = 0; r < rings.count; r++) {
			const out = ends[r] as number;
			if (out < 0) continue;
			const first = rings.first[r] as number;
			const count = rings.sides[r] as number;
			for (let j = 0; j <= count; j++) {
				const at = first + (j % count);
				const dx = (rings.position[at * 3] as number) - cx;
				const dy = (rings.position[at * 3 + 1] as number) - cy;
				const dz = (rings.position[at * 3 + 2] as number) - cz;
				const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (distance >= reach) continue;
				const fade = 1 - distance / reach;
				const mask = fade * fade;
				const to = (out + j) * 2 + 1;
				if ((uvs1[to] as number) < mask) uvs1[to] = mask;
			}
		}
	}

	/**
	 * Runs a side's line from inside the joint to past where it should have left the parent against
	 * every triangle of the parent near the joint. On a hit, `hit.share` holds the crossing's share of
	 * the straight segment from `from` to `to`.
	 */
	private wideSnap(
		surface: ParentSurface,
		line: (s: number, out: Float64Array) => void,
		s: number,
		reach: number,
		beyond: number,
		from: Float64Array,
		to: Float64Array,
		hit: SurfaceHit,
	): boolean {
		line(0, from);
		line(Math.min(reach, s + beyond), to);
		return surface.snap(from, to, undefined, hit);
	}

	/**
	 * The arc length at which a line along the child leaves the parent's surface, by stepping out
	 * from the joint by the distance to the surface and closing in by halves; undefined when the
	 * line starts outside the parent, and the reach when it never leaves.
	 */
	private exitAlong(
		surface: ParentSurface,
		line: (s: number, out: Float64Array) => void,
		reach: number,
		rc: number,
		point: Float64Array,
	): number | undefined {
		const at = (s: number) => {
			line(s, point);
			return surface.distance(point[0] as number, point[1] as number, point[2] as number);
		};
		let inside = 0;
		let d = at(0);
		if (!(d < 0)) return undefined;
		const least = Math.max(rc / 8, 1e-4);
		let outside = -1;
		while (inside < reach) {
			const s = Math.min(reach, inside + Math.max(least, -d * 0.8));
			d = at(s);
			if (!(d < 0)) {
				outside = s;
				break;
			}
			inside = s;
		}
		if (outside < 0) return reach;
		for (let k = 0; k < 24 && outside - inside > 1e-6; k++) {
			const middle = (inside + outside) / 2;
			if (at(middle) < 0) inside = middle;
			else outside = middle;
		}
		return outside;
	}

	/**
	 * A fork's leader starts from its parent's last ring: that ring, copied, is its first, so the
	 * weld is exact. The leader then eases from the parent's girth to its own, and its first ring of
	 * its own stands clear of the parent's end on every side.
	 */
	private lead(
		context: AxisContext,
		parentRings: AxisRings,
		parentContext: AxisContext,
		rings: AxisRings,
	): { context: AxisContext; end: number; sides: number } {
		const path = context.path;
		// The parent's last plain ring, before its rounded end.
		let last = parentRings.count - 1;
		while (last > 0 && (parentRings.arc[last] as number) > parentContext.path.length + 1e-9) last--;
		const sides = parentRings.sides[last] as number;
		const first = parentRings.first[last] as number;
		const c = last * 3;
		rings.begin(
			sides,
			0,
			parentRings.centre.subarray(c, c + 3),
			parentRings.tangent.subarray(c, c + 3),
			parentRings.normal.subarray(c, c + 3),
			parentRings.binormal.subarray(c, c + 3),
			(parentRings.v[last] as number) - context.shift,
		);
		let mean = 0;
		for (let j = 0; j < sides; j++) {
			const i = first + j;
			mean += parentRings.rho[i] as number;
			rings.vertex(
				parentRings.position[i * 3] as number,
				parentRings.position[i * 3 + 1] as number,
				parentRings.position[i * 3 + 2] as number,
				parentRings.vertexNormal[i * 3] as number,
				parentRings.vertexNormal[i * 3 + 1] as number,
				parentRings.vertexNormal[i * 3 + 2] as number,
				parentRings.rho[i] as number,
				(parentRings.vv[i] as number) - context.shift,
				0,
				parentRings.pipe[i] as number,
				0,
			);
		}
		rings.welded = 1;
		rings.shared = true;
		mean /= sides;
		const rc = path.radius[0] as number;
		const pt = Float64Array.from(
			frameAt(parentContext.path, parentContext.path.length, this.frame).tangent,
		);
		const lt = path.tangent;
		const cosine =
			(pt[0] as number) * (lt[0] as number) +
			(pt[1] as number) * (lt[1] as number) +
			(pt[2] as number) * (lt[2] as number);
		// A fork's leaders part from the parent's end, and the armpit's creases gather on the
		// parent's bark round the fork, on the side the leader leans toward.
		const toward = Float64Array.from([
			(lt[0] as number) - (pt[0] as number) * cosine,
			(lt[1] as number) - (pt[1] as number) * cosine,
			(lt[2] as number) - (pt[2] as number) * cosine,
		]);
		const sideways = Math.hypot(toward[0] as number, toward[1] as number, toward[2] as number);
		if (sideways > 1e-6) for (let k = 0; k < 3; k++) toward[k] = (toward[k] as number) / sideways;
		if ((this.record.bark?.collar.creases ?? 0) > 0)
			this.markParentFork(
				parentContext.wood.key,
				parentRings,
				parentContext.path.length,
				mean,
				toward,
			);
		const turn = acos(Math.min(1, Math.max(-1, cosine)));
		const angle = Math.min(LEADER_TILT, turn);
		const clear = mean * tan(angle) + 0.25 * rc;
		const led: AxisContext = {
			...context,
			taper: mean,
			taperLength: Math.max(BLEND_RADII * rc, mean),
		};
		const end = Math.min(
			path.length,
			Math.max(
				clear,
				0.5 * this.tube.edge,
				(this.record.bark?.fork?.bend ?? LEADER_BEND) * mean * turn,
			),
		);
		this.bend(led, parentRings, last, pt, end, sides, rings);
		// The bend's rings blend from the parent's own circle to the leader's, like a weld's.
		rings.welded = rings.count;
		return { context: led, end, sides };
	}

	/**
	 * The rings by which a fork's leader bends from its parent's last ring onto its own line. The
	 * axis runs on a curve that leaves the parent's ring along the parent's line and meets the
	 * leader's first plain ring along the leader's, and each ring is a circle about it, so the joint
	 * is one smooth elbow with no fold. Each side's bark `v` runs over the bend in step with the
	 * length of its own line, so the plates stay square round the ring instead of shearing across
	 * the long side. As many rings stand on the bend as the wood's turn between rings asks.
	 */
	private bend(
		context: AxisContext,
		parentRings: AxisRings,
		last: number,
		parentTangent: ArrayLike<number>,
		end: number,
		sides: number,
		rings: AxisRings,
	): void {
		const f = frameAt(context.path, end, this.frame);
		const lt = f.tangent;
		const cosine =
			(parentTangent[0] as number) * (lt[0] as number) +
			(parentTangent[1] as number) * (lt[1] as number) +
			(parentTangent[2] as number) * (lt[2] as number);
		const turn = acos(Math.min(1, Math.max(-1, cosine)));
		const first = parentRings.first[last] as number;
		let mean = 0;
		for (let j = 0; j < sides; j++) mean += parentRings.rho[first + j] as number;
		mean /= sides;
		const steps = bendRings(turn, mean, this.tube) + 1;
		const knot = Math.max(0, this.record.bark?.fork?.knot ?? 0);
		if (steps < 2 || end <= 0) return;
		const c3 = last * 3;
		const radius = this.rho(context, end, 0);
		const vEnd = this.vAt(context, end);
		const trig = ringTrig(sides);
		const bends = steps - 1;
		const centreFrom = parentRings.centre.subarray(c3, c3 + 3);
		// The leader's first plain ring, which the bend's last strip reaches on every side.
		const tip = new Float64Array(sides * 3);
		for (let j = 0; j < sides; j++) {
			const c = trig[j * 2] as number;
			const n = trig[j * 2 + 1] as number;
			for (let k = 0; k < 3; k++)
				tip[j * 3 + k] =
					(f.position[k] as number) +
					radius * (c * (f.normal[k] as number) + n * (f.binormal[k] as number));
		}
		const centre = new Float64Array(3);
		const tangent = new Float64Array(3);
		const normal = new Float64Array(3);
		const binormal = new Float64Array(3);
		// The bend's rings laid out first, so each side's bark can follow the length of its own line.
		const frames = new Float64Array(bends * 13);
		const rhos = new Float64Array(bends);
		const cells = new Float64Array(bends * sides * 3);
		const normals = new Float64Array(bends * sides * 3);
		const hermite = (
			a: ArrayLike<number>,
			ai: number,
			b: ArrayLike<number>,
			bi: number,
			u: number,
			target: Float64Array,
		) => {
			let reach = 0;
			for (let k = 0; k < 3; k++) reach += ((b[bi + k] as number) - (a[ai + k] as number)) ** 2;
			reach = Math.sqrt(reach);
			const u2 = u * u;
			const u3 = u2 * u;
			const h00 = 2 * u3 - 3 * u2 + 1;
			const h10 = u3 - 2 * u2 + u;
			const h01 = -2 * u3 + 3 * u2;
			const h11 = u3 - u2;
			for (let k = 0; k < 3; k++)
				target[k] =
					h00 * (a[ai + k] as number) +
					h10 * reach * (parentTangent[k] as number) +
					h01 * (b[bi + k] as number) +
					h11 * reach * (lt[k] as number);
		};
		for (let b = 0; b < bends; b++) {
			const u = (b + 1) / steps;
			hermite(centreFrom, 0, f.position, 0, u, centre);
			let tl = 0;
			for (let k = 0; k < 3; k++) {
				tangent[k] = (1 - u) * (parentTangent[k] as number) + u * (lt[k] as number);
				tl += (tangent[k] as number) ** 2;
			}
			tl = Math.sqrt(tl) || 1;
			let along = 0;
			for (let k = 0; k < 3; k++) {
				tangent[k] = (tangent[k] as number) / tl;
				normal[k] = (1 - u) * (parentRings.normal[c3 + k] as number) + u * (f.normal[k] as number);
				along += (normal[k] as number) * (tangent[k] as number);
			}
			let nl = 0;
			for (let k = 0; k < 3; k++) {
				normal[k] = (normal[k] as number) - along * (tangent[k] as number);
				nl += (normal[k] as number) ** 2;
			}
			nl = Math.sqrt(nl) || 1;
			for (let k = 0; k < 3; k++) normal[k] = (normal[k] as number) / nl;
			binormal[0] =
				(tangent[1] as number) * (normal[2] as number) -
				(tangent[2] as number) * (normal[1] as number);
			binormal[1] =
				(tangent[2] as number) * (normal[0] as number) -
				(tangent[0] as number) * (normal[2] as number);
			binormal[2] =
				(tangent[0] as number) * (normal[1] as number) -
				(tangent[1] as number) * (normal[0] as number);
			// The girth eases from the parent's own to the leader's, so the fork's collar swells wide
			// at its base and the surfaces meet without a step at either end of the bend; a knot
			// swells the middle of the bend and is gone at both ends.
			const ease = u * u * (3 - 2 * u);
			const eased = mean + (radius - mean) * ease;
			const swell = 1 + knot * 4 * u * (1 - u);
			const rho = eased * swell;
			rhos[b] = rho;
			const fr = b * 13;
			frames[fr] = u * end;
			frames.set(centre, fr + 1);
			frames.set(tangent, fr + 4);
			frames.set(normal, fr + 7);
			frames.set(binormal, fr + 10);
			// The surface tilts along the taper, so a ring wider than the next shades as a cone.
			const slope =
				((radius - mean) * 6 * u * (1 - u) * swell + eased * knot * 4 * (1 - 2 * u)) /
				Math.max(end, 1e-6);
			for (let j = 0; j < sides; j++) {
				const c = trig[j * 2] as number;
				const n = trig[j * 2 + 1] as number;
				const at = (b * sides + j) * 3;
				let rx = 0;
				let ry = 0;
				let rz = 0;
				for (let k = 0; k < 3; k++) {
					const radial = c * (normal[k] as number) + n * (binormal[k] as number);
					cells[at + k] = (centre[k] as number) + rho * radial;
					const value = radial - slope * (tangent[k] as number);
					if (k === 0) rx = value;
					else if (k === 1) ry = value;
					else rz = value;
				}
				const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
				// The normal turns from the parent's own to the cone's over the bend, so the elbow
				// shades as one surface with the parent below it.
				const px = parentRings.vertexNormal[(first + j) * 3] as number;
				const py = parentRings.vertexNormal[(first + j) * 3 + 1] as number;
				const pz = parentRings.vertexNormal[(first + j) * 3 + 2] as number;
				normals[at] = (1 - u) * px + (u * rx) / l;
				normals[at + 1] = (1 - u) * py + (u * ry) / l;
				normals[at + 2] = (1 - u) * pz + (u * rz) / l;
			}
		}
		// Each side's v runs from the parent's own to the leader's own in step with its line length.
		const lengths = new Float64Array(bends + 1);
		const vs = new Float64Array(bends * sides);
		for (let j = 0; j < sides; j++) {
			const i = first + j;
			lengths[0] = 0;
			for (let b = 0; b < bends; b++) {
				const at = (b * sides + j) * 3;
				// The first ring of the bend starts on the parent's own ring.
				const back = b === 0 ? -1 : at - sides * 3;
				const px = back < 0 ? (parentRings.position[i * 3] as number) : (cells[back] as number);
				const py =
					back < 0 ? (parentRings.position[i * 3 + 1] as number) : (cells[back + 1] as number);
				const pz =
					back < 0 ? (parentRings.position[i * 3 + 2] as number) : (cells[back + 2] as number);
				lengths[b + 1] =
					(lengths[b] as number) +
					Math.sqrt(
						((cells[at] as number) - px) ** 2 +
							((cells[at + 1] as number) - py) ** 2 +
							((cells[at + 2] as number) - pz) ** 2,
					);
			}
			// Past the last bend ring the side runs on to its own first plain ring, which holds the
			// leader's own v, so every side ends at the same v there.
			const lastAt = ((bends - 1) * sides + j) * 3;
			const tail = Math.sqrt(
				((tip[j * 3] as number) - (cells[lastAt] as number)) ** 2 +
					((tip[j * 3 + 1] as number) - (cells[lastAt + 1] as number)) ** 2 +
					((tip[j * 3 + 2] as number) - (cells[lastAt + 2] as number)) ** 2,
			);
			const total = (lengths[bends] as number) + tail || 1;
			const v0 = (parentRings.vv[i] as number) - context.shift;
			for (let b = 0; b < bends; b++)
				vs[b * sides + j] = v0 + (vEnd - v0) * ((lengths[b + 1] as number) / total);
		}
		for (let b = 0; b < bends; b++) {
			const fr = b * 13;
			let v = 0;
			for (let j = 0; j < sides; j++) v += vs[b * sides + j] as number;
			rings.begin(
				sides,
				frames[fr] as number,
				frames.subarray(fr + 1, fr + 4),
				frames.subarray(fr + 4, fr + 7),
				frames.subarray(fr + 7, fr + 10),
				frames.subarray(fr + 10, fr + 13),
				v / sides,
			);
			for (let j = 0; j < sides; j++) {
				const i = first + j;
				const at = (b * sides + j) * 3;
				const u = (b + 1) / steps;
				rings.vertex(
					cells[at] as number,
					cells[at + 1] as number,
					cells[at + 2] as number,
					normals[at] as number,
					normals[at + 1] as number,
					normals[at + 2] as number,
					rhos[b] as number,
					vs[b * sides + j] as number,
					0,
					(1 - u) * (parentRings.pipe[i] as number) + u * f.radius,
					u * end,
				);
			}
		}
	}

	/** The rounded end of an axis: a dome of rings and an apex ring of no radius. */
	private tip(context: AxisContext, rings: AxisRings, fork: boolean): void {
		const path = context.path;
		const last = rings.count - 1;
		if (last < 0) return;
		const f = frameAt(path, path.length, this.frame);
		const sides = rings.sides[last] as number;
		const first = rings.first[last] as number;
		let mean = 0;
		for (let j = 0; j < sides; j++) mean += rings.rho[first + j] as number;
		mean /= sides;
		const height = fork ? FORK_DOME : 0.55;
		const domes = mean < THIN ? 0 : this.tube.level === 0 && mean > 0.01 ? 2 : 1;
		const scale = this.bark.scale(f.radius);
		const v0 = rings.v[last] as number;
		const centre = new Float64Array(3);
		const tg = f.tangent;
		const trig = ringTrig(sides);
		for (let d = 1; d <= domes + 1; d++) {
			const phi = (d / (domes + 1)) * (PI / 2);
			const up = sin(phi);
			const across = cos(phi);
			const lift = mean * height * up;
			const shrink = d === domes + 1 ? 0 : across;
			for (let k = 0; k < 3; k++) centre[k] = (f.position[k] as number) + lift * (tg[k] as number);
			const v = v0 + (mean * phi) / scale;
			rings.begin(sides, path.length + lift, centre, tg, f.normal, f.binormal, v);
			for (let j = 0; j < sides; j++) {
				const i = first + j;
				const rho = (rings.rho[i] as number) * shrink;
				const c = trig[j * 2] as number;
				const n = trig[j * 2 + 1] as number;
				rings.vertex(
					(centre[0] as number) +
						rho * (c * (f.normal[0] as number) + n * (f.binormal[0] as number)),
					(centre[1] as number) +
						rho * (c * (f.normal[1] as number) + n * (f.binormal[1] as number)),
					(centre[2] as number) +
						rho * (c * (f.normal[2] as number) + n * (f.binormal[2] as number)),
					(rings.vertexNormal[i * 3] as number) * across + (tg[0] as number) * up,
					(rings.vertexNormal[i * 3 + 1] as number) * across + (tg[1] as number) * up,
					(rings.vertexNormal[i * 3 + 2] as number) * across + (tg[2] as number) * up,
					rho,
					v,
					rings.mask[i] as number,
					rings.pipe[i] as number,
					path.length,
				);
			}
		}
	}

	/**
	 * A stem's foot: the first ring where the flare and the buttress lobes have eased to within
	 * `FOOT_EASED` of the plain radius, and that ring's tile count, which every ring below it keeps.
	 * Bark plates spread apart over a flared foot, so the pattern widens there rather than jumping
	 * sideways where the count would change. Undefined for an axis that is not a stem with a base.
	 */
	private footTiles(
		rings: AxisRings,
		context: AxisContext,
	): { readonly ring: number; readonly tiles: number; readonly width: number } | undefined {
		const section = context.section;
		if (!section) return undefined;
		for (let r = 0; r < rings.count; r++) {
			const h = rings.centre[r * 3 + 1] as number;
			let swell = 0;
			for (let k = 0; k < FOOT_ANGLES; k++)
				swell = Math.max(swell, section.radius(h, (k / FOOT_ANGLES) * 2 * Math.PI, 1));
			if (swell > 1 + FOOT_EASED) continue;
			if (r === 0) return undefined;
			const pipe = rings.pipe[rings.first[r] as number] as number;
			const width = this.bark.width(pipe, h);
			const tiles = tilesRound(ringPerimeter(rings, r) / this.bark.scale(pipe), width, -1);
			return tiles > 0 ? { ring: r, tiles, width } : undefined;
		}
		return undefined;
	}

	/**
	 * The bark's `u` over an axis's rings: the tile count by runs, a repeated ring where it changes,
	 * and each run's top line a whole number of its tiles in, so `u` never falls below zero. The
	 * dome keeps the last plain ring's run.
	 */
	private barkOf(rings: AxisRings, context: AxisContext, inherit?: BarkRun): BarkRings {
		const out: BarkRings = { ring: [], span: [], top: [], restart: [], tiles: [], width: [] };
		const widths = out.width;
		let tiles = inherit ? inherit.tiles : -1;
		let width = inherit ? inherit.width : 0;
		let span = inherit ? inherit.span : 0;
		const foot = inherit ? undefined : this.footTiles(rings, context);
		for (let r = 0; r < rings.count; r++) {
			const first = rings.first[r] as number;
			const dome = (rings.arc[r] as number) > context.path.length + 1e-9;
			if (!dome) {
				const perimeter = ringPerimeter(rings, r);
				const pipe = rings.pipe[first] as number;
				const scale = this.bark.scale(pipe);
				const ringWidth = this.bark.width(pipe, rings.centre[r * 3 + 1] as number);
				const bark = perimeter / scale;
				// A leader's first ring is its parent's last, and keeps that ring's bark. A stem's foot
				// keeps the count of the plain stem above it.
				const inherited = inherit !== undefined && r === 0;
				const ringTiles = inherited
					? tiles
					: foot && r < foot.ring && ringWidth === foot.width
						? foot.tiles
						: tilesRound(bark, ringWidth, ringWidth === width ? tiles : -1);
				const usedWidth = inherited ? width : ringWidth;
				const ringSpan = inherited ? span : uSpan(ringTiles, ringWidth, bark);
				const changes =
					r > 0 &&
					(ringTiles !== tiles || usedWidth !== width || (ringTiles > 0 && ringSpan !== span));
				if (changes && !(ringTiles === 0 && tiles === 0)) {
					// Repeat the ring before with this ring's tiles, starting a new run.
					out.ring.push(r - 1);
					out.span.push(ringSpan);
					out.top.push(0);
					out.restart.push(true);
					out.tiles.push(ringTiles);
					widths.push(usedWidth);
				}
				tiles = ringTiles;
				width = usedWidth;
				span = ringSpan;
				if (this.rings) {
					const record = this.rings;
					record.axis.push(context.wood.axis);
					record.pipe.push(pipe);
					record.span.push(ringSpan);
					record.perimeter.push(perimeter);
					record.scale.push(scale);
					record.v.push(rings.v[r] as number);
					record.arc.push(rings.arc[r] as number);
					record.weld.push(r < rings.welded);
					record.foot.push(foot !== undefined && r < foot.ring);
				}
			}
			out.ring.push(r);
			out.span.push(span);
			out.top.push(0);
			out.restart.push(false);
			out.tiles.push(tiles);
			widths.push(width);
		}
		// Each run's top line a whole number of its tiles in, past half its widest span.
		let r = 0;
		const count = out.ring.length;
		while (r < count) {
			let end = r + 1;
			while (end < count && !out.restart[end]) end++;
			let widest = 0;
			for (let k = r; k < end; k++) widest = Math.max(widest, out.span[k] as number);
			const runWidth = widths[r] as number;
			let top = (Math.ceil(widest / (2 * runWidth)) + 1) * runWidth;
			// A leader's first run goes on from its parent's, when that keeps u above zero.
			if (r === 0 && inherit && inherit.top >= widest / 2) top = inherit.top;
			for (let k = r; k < end; k++) out.top[k] = top;
			r = end;
		}
		return out;
	}

	/** Writes an axis's peeling strips, at the nearest level. */
	private fins(rings: AxisRings, bark: BarkRings, context: AxisContext, wood: WoodAxis): void {
		const spec = this.record.bark;
		if (!spec?.peel) return;
		// Each ring's bark from its first written entry, and the rings before the rounded end.
		const top = new Float64Array(rings.count);
		const span = new Float64Array(rings.count);
		for (let e = bark.ring.length - 1; e >= 0; e--) {
			if (bark.restart[e]) continue;
			const r = bark.ring[e] as number;
			top[r] = bark.top[e] as number;
			span[r] = bark.span[e] as number;
		}
		let plain = 0;
		while (plain < rings.count && (rings.arc[plain] as number) <= context.path.length + 1e-9)
			plain++;
		const fins = peelFins(rings, plain, { top, span }, spec, [
			this.seed,
			this.record.seedSalt,
			this.variant,
			wood.key & 0xffff,
		]);
		const writer = this.writer;
		const base = writer.vertices;
		const length = Math.max(context.path.length, 1e-6);
		for (let i = 0; i < fins.u.length; i++) {
			const x = fins.positions[i * 3] as number;
			const y = fins.positions[i * 3 + 1] as number;
			const z = fins.positions[i * 3 + 2] as number;
			writer.free(
				x,
				y,
				z,
				fins.normals[i * 3] as number,
				fins.normals[i * 3 + 1] as number,
				fins.normals[i * 3 + 2] as number,
				fins.u[i] as number,
				fins.v[i] as number,
				fins.pipe[i] as number,
				wood.record,
				(fins.along[i] as number) / length,
				crownSkyAt(this.crown, x, y, z),
			);
		}
		for (const index of fins.indices) writer.indices.push(base + index);
	}

	/** Writes an axis's rings and the strips between them. */
	private write(rings: AxisRings, bark: BarkRings, context: AxisContext, wood: WoodAxis): void {
		const writer = this.writer;
		writer.grownBark = (this.axes.grownBark[wood.axis] as number) ?? 0;
		writer.youngRadius = this.record.bark?.youngRadius ?? 0;
		const length = Math.max(context.path.length, 1e-6);
		const firstVertex = writer.vertices;
		const starts: number[] = [];
		const count = bark.ring.length;
		for (let e = 0; e < count; e++) {
			const r = bark.ring[e] as number;
			const first = rings.first[r] as number;
			const sides = rings.sides[r] as number;
			const span = bark.span[e] as number;
			const top = bark.top[e] as number;
			starts.push(writer.vertices);
			for (let j = 0; j <= sides; j++) {
				const i = first + (j % sides);
				writer.vertex(
					rings,
					i,
					top + (j / sides - 0.5) * span,
					wood.record,
					(rings.along[i] as number) / length,
					crownSkyAt(
						this.crown,
						rings.position[i * 3] as number,
						rings.position[i * 3 + 1] as number,
						rings.position[i * 3 + 2] as number,
					),
				);
			}
		}
		const ends = new Int32Array(rings.count).fill(-1);
		for (let e = 0; e < count; e++) ends[bark.ring[e] as number] = starts[e] as number;
		this.outputRingFirst.set(wood.key, ends);
		const apex = count - 1;
		for (let e = 0; e < apex; e++) {
			if (bark.restart[e + 1]) continue;
			const a = starts[e] as number;
			const b = starts[e + 1] as number;
			const sidesA = rings.sides[bark.ring[e] as number] as number;
			if (e + 1 === apex) {
				// The apex: one triangle per side, to the apex's own copy of each side's `u`.
				for (let i = 0; i < sidesA; i++) writer.indices.push(a + i, a + i + 1, b + i);
				continue;
			}
			stitch(writer.indices, a, sidesA, b, rings.sides[bark.ring[e + 1] as number] as number);
		}
		if (this.tube.level === 0) this.fins(rings, bark, context, wood);
		if (this.welds) {
			this.welds.axisFirst.set(wood.key, [firstVertex, writer.vertices - firstVertex]);
			if (wood.parent >= 0) {
				this.welds.child.push(wood.key);
				this.welds.first.push(firstVertex);
				this.welds.vertices.push((rings.sides[0] as number) + 1);
			}
		}
	}
}

/**
 * How much a fillet of size `fillet` widens a child at `d` metres past where it leaves its parent:
 * a parabola that meets the child's side smoothly at `fillet` metres and the parent at a slope of
 * two, so the joint flares like a limb's foot yet never lies flat along the parent's surface, where
 * the two surfaces would fight for depth.
 */
function filletWidening(d: number, fillet: number): number {
	if (fillet <= 0 || d >= fillet) return 0;
	if (d <= 0) return fillet;
	const x = 1 - d / fillet;
	return fillet * x * x;
}

/** The arc length on a path nearest a point. */
function nearestArc(path: AxisPath, x: number, y: number, z: number): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	const q = path.position;
	for (let i = 0; i < path.count - 1; i++) {
		const ax = q[i * 3] as number;
		const ay = q[i * 3 + 1] as number;
		const az = q[i * 3 + 2] as number;
		const bx = (q[(i + 1) * 3] as number) - ax;
		const by = (q[(i + 1) * 3 + 1] as number) - ay;
		const bz = (q[(i + 1) * 3 + 2] as number) - az;
		const l2 = bx * bx + by * by + bz * bz;
		const t =
			l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / l2)) : 0;
		const d = (x - ax - t * bx) ** 2 + (y - ay - t * by) ** 2 + (z - az - t * bz) ** 2;
		if (d < bestDistance) {
			bestDistance = d;
			best = (path.arc[i] as number) + t * ((path.arc[i + 1] as number) - (path.arc[i] as number));
		}
	}
	return best;
}

/** Everything the mesher can report besides the mesh, for tests. */
export interface WoodReport {
	readonly mesh: MeshArrays;
	readonly rings: WoodRings;
	readonly welds: WoodWelds;
	/**
	 * The key of each meshed piece's parent, by the piece's key. A piece's key is its skeleton axis,
	 * or a number past the skeleton's axes for the wood that runs on past a fork where it divides.
	 */
	readonly parents: Map<number, number>;
	/** The rings of each meshed piece, by its key. */
	readonly axisRings: Map<number, AxisRings>;
	/** The skeleton axis of each meshed piece, by its key. */
	readonly axisOf: Map<number, number>;
	/** Meters of bark after which the bark repeats: a child's `v` may run whole repeats lower. */
	readonly vPeriod: number;
}

/** The orders of wood a level keeps. */
function ordersKept(input: MeshInput, level: MeshLevel): number {
	return level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
}

/**
 * Meshes the wood and reports its rings and welds, for tests that measure the bark and the joints.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The mesh and the reports.
 */
export function meshWoodReport(input: MeshInput, level: MeshLevel): WoodReport {
	const axes = woodAxes(input, ordersKept(input, level));
	const mesher = new Mesher(input, level, true);
	const mesh = mesher.run(axes, input.variant);
	const parents = new Map<number, number>();
	const axisRings = new Map<number, AxisRings>();
	const axisOf = new Map<number, number>();
	for (let i = 0; i < axes.length; i++) {
		const wood = axes[i] as WoodAxis;
		parents.set(wood.key, wood.parent >= 0 ? (axes[wood.parent] as WoodAxis).key : -1);
		axisOf.set(wood.key, wood.axis);
		const rings = mesher.ringsOf(i);
		if (rings) axisRings.set(wood.key, rings);
	}
	return {
		mesh,
		rings: mesher.rings as WoodRings,
		welds: mesher.welds as WoodWelds,
		parents,
		axisRings,
		axisOf,
		vPeriod: mesher.period,
	};
}

/**
 * The wood of one variant at a level: every axis at the nearest level, fewer orders and fewer sides
 * at the card levels.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The wood's mesh, with UVs in metres of bark.
 */
export function meshWood(input: MeshInput, level: MeshLevel): MeshArrays {
	return new Mesher(input, level, false).run(
		woodAxes(input, ordersKept(input, level)),
		input.variant,
	);
}
