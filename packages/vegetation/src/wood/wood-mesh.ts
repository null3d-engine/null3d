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
import { AXIS_STEM, type MacroSkeleton } from '../core/graph';
import { acos, cos, PI, sin, tan } from '../core/math';
import type { Species } from '../core/record';
import type { CrownLight, MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { type StemSection, stemSection, surfaceRoots } from './flare';
import {
	type AxisPath,
	axisPath,
	emptyFrame,
	frameAt,
	type PathFrame,
	type PathSample,
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
	heldSides,
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

/** A child at its parent's end leads a fork when it has at least this share of the parent's girth. */
const LEADER_SHARE = 0.5;

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

/** Whether an axis leaves its parent at the parent's last kept node. */
function atEnd(skeleton: MacroSkeleton, axis: number, parentLast: number): boolean {
	const axes = skeleton.axes;
	const parentNode = axes.parentNode[axis] as number;
	return (
		parentNode === parentLast ||
		(parentNode === parentLast - 1 && (axes.parentT[axis] as number) >= 1 - 1e-6)
	);
}

/**
 * The axes to mesh at a level, parents before children. Where a parent ends and children of nearly
 * its girth go on, those children are the fork's leaders: each takes the parent's last ring as its
 * own first ring, so the parent needs no rounded end. A thinner child at that end hangs on the
 * thickest leader instead.
 */
function woodAxes(input: MeshInput, keep: number): WoodAxis[] {
	const { skeleton } = input;
	const axes = skeleton.axes;
	const p = skeleton.position;
	const base = input.variant * VARIANT_RECORDS;
	const lastKept = keptNodes(skeleton);
	// A limb with no parent has nothing to weld onto and would float, so only stems start the tree.
	const meshed = (a: number) =>
		(axes.order[a] as number) <= keep &&
		(lastKept[a] as number) >= (axes.first[a] as number) &&
		((axes.parent[a] as number) >= 0 || (axes.kind[a] as number) === AXIS_STEM);
	// Leaders and the parent each axis hangs on.
	const hangsOn = new Int32Array(axes.count);
	const leads = new Uint8Array(axes.count);
	for (let a = 0; a < axes.count; a++) hangsOn[a] = axes.parent[a] as number;
	const ends: number[][] = [];
	for (let a = 0; a < axes.count; a++) ends.push([]);
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if (parent >= 0 && meshed(a) && atEnd(skeleton, a, lastKept[parent] as number))
			ends[parent]?.push(a);
	}
	for (let a = 0; a < axes.count; a++) {
		const atTip = ends[a] as number[];
		if (atTip.length === 0) continue;
		const girth = skeleton.radius[lastKept[a] as number] as number;
		let thickest = -1;
		for (const child of atTip) {
			const r = skeleton.radius[axes.first[child] as number] as number;
			if (r < LEADER_SHARE * girth) continue;
			leads[child] = 1;
			if (thickest < 0 || r > (skeleton.radius[axes.first[thickest] as number] as number))
				thickest = child;
		}
		if (thickest >= 0) for (const child of atTip) if (!leads[child]) hangsOn[child] = thickest;
	}
	const children: number[][] = [];
	for (let a = 0; a < axes.count; a++) children.push([]);
	const queue: number[] = [];
	for (let a = 0; a < axes.count; a++) {
		const parent = hangsOn[a] as number;
		if (parent < 0) queue.push(a);
		else if (leads[a]) children[parent]?.unshift(a);
		else children[parent]?.push(a);
	}
	const list: WoodAxis[] = [];
	const indexOf = new Int32Array(axes.count).fill(-1);
	let stems = 0;
	for (let q = 0; q < queue.length; q++) {
		const a = queue[q] as number;
		const parent = hangsOn[a] as number;
		const first = axes.first[a] as number;
		const kept = lastKept[a] as number;
		if (!meshed(a)) continue;
		const parentIndex = parent >= 0 ? (indexOf[parent] as number) : -1;
		if (parent >= 0 && parentIndex < 0) continue;
		const pts: number[] = [];
		const radii: number[] = [];
		if (parent < 0) {
			// A stem starts below the ground, along its first internode's line.
			const r0 = skeleton.radius[first] as number;
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
		} else {
			// A child starts at its junction on the skeleton's parent: along the internode after its
			// parent node.
			const own = axes.parent[a] as number;
			const parentNode = axes.parentNode[a] as number;
			const parentLast = lastKept[own] as number;
			if (parentNode < 0 || parentNode > parentLast) continue;
			const next = parentNode < parentLast ? parentNode + 1 : parentNode;
			const t = axes.parentT[a] as number;
			const jx = (p[parentNode * 3] as number) * (1 - t) + (p[next * 3] as number) * t;
			const jy = (p[parentNode * 3 + 1] as number) * (1 - t) + (p[next * 3 + 1] as number) * t;
			const jz = (p[parentNode * 3 + 2] as number) * (1 - t) + (p[next * 3 + 2] as number) * t;
			const gap = Math.sqrt(
				(jx - (p[first * 3] as number)) ** 2 +
					(jy - (p[first * 3 + 1] as number)) ** 2 +
					(jz - (p[first * 3 + 2] as number)) ** 2,
			);
			if (leads[a]) {
				const parentWood = list[parentIndex];
				if (parentWood) parentWood.fork = true;
			}
			if (gap > 1e-6) {
				pts.push(jx, jy, jz);
				radii.push(skeleton.radius[first] as number);
			}
		}
		for (let n = first; n <= kept; n++) {
			pts.push(p[n * 3] as number, p[n * 3 + 1] as number, p[n * 3 + 2] as number);
			radii.push(skeleton.radius[n] as number);
		}
		const count = radii.length;
		if (count < 2) continue;
		indexOf[a] = list.length;
		list.push({
			axis: a,
			parent: parentIndex,
			record: base + (axes.record[a] as number),
			points: new Float64Array(pts),
			radii: new Float64Array(radii),
			count,
			stem: parent < 0 ? stems++ : -1,
			fork: false,
			leader: leads[a] === 1,
		});
		if (parent < 0) addRoots(input, list, list.length - 1, base + (axes.record[a] as number));
		for (const child of children[a] ?? []) queue.push(child);
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
			parent: stemIndex,
			record,
			points: root.points,
			radii: root.radii,
			count: root.radii.length,
			stem: -1,
			fork: false,
			leader: false,
		});
}

/** Sky visibility at a point, trilinear in the crown's grid. */
function skyAt(crown: CrownLight, x: number, y: number, z: number): number {
	const [nx, ny, nz] = crown.cells;
	const cell = crown.cell > 0 ? crown.cell : 1;
	const fx = Math.min(nx - 1, Math.max(0, (x - crown.min[0]) / cell - 0.5));
	const fy = Math.min(ny - 1, Math.max(0, (y - crown.min[1]) / cell - 0.5));
	const fz = Math.min(nz - 1, Math.max(0, (z - crown.min[2]) / cell - 0.5));
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const z0 = Math.floor(fz);
	const x1 = Math.min(nx - 1, x0 + 1);
	const y1 = Math.min(ny - 1, y0 + 1);
	const z1 = Math.min(nz - 1, z0 + 1);
	const tx = fx - x0;
	const ty = fy - y0;
	const tz = fz - z0;
	const sky = crown.sky;
	const at = (i: number, j: number, k: number) => (sky[(k * ny + j) * nx + i] as number) ?? 1;
	const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
	const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
	const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
	const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
	const c0 = c00 * (1 - ty) + c10 * ty;
	const c1 = c01 * (1 - ty) + c11 * ty;
	return Math.min(1, Math.max(0, c0 * (1 - tz) + c1 * tz));
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
		uvs1[w * 2] = Math.min(1, (rings.pipe[i] as number) / WOOD_RADIUS_RANGE);
		uvs1[w * 2 + 1] = Math.min(1, Math.max(0, rings.mask[i] as number));
		const colors = this.colors;
		colors[w * 4] = (record >>> 8) & 255;
		colors[w * 4 + 1] = record & 255;
		colors[w * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, bend)));
		colors[w * 4 + 3] = Math.round(255 * sky);
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
 * scale, its `v` and arc length, and whether it blends from a weld.
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
	/** The first written vertex of each axis and its count, by skeleton axis. */
	readonly axisFirst: Map<number, [number, number]>;
}

/**
 * The mesher for one variant at one level. It keeps the rings of every axis it has built, so each
 * child welds onto its parent.
 */
class Mesher {
	private readonly record: Species;
	private readonly bark: BarkScale;
	private readonly tube: TubeDetail;
	private readonly seed: number;
	private readonly crown: CrownLight;
	private readonly writer = new WoodWriter();
	private readonly built: (AxisRings | undefined)[] = [];
	private readonly contexts: (AxisContext | undefined)[] = [];
	private readonly barks: (BarkRings | undefined)[] = [];
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
		this.seed = input.seed;
		this.crown = input.crown;
		this.bark = barkScale(input.record, input.kit.manifest, largestRadius(input.skeleton));
		this.tube = tubeDetail(level, input.detail);
		this.rings = report
			? { axis: [], pipe: [], span: [], perimeter: [], scale: [], v: [], arc: [], weld: [] }
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
			rings.begin(
				sides,
				nominal,
				f.position,
				f.tangent,
				f.normal,
				f.binormal,
				this.vAt(context, nominal),
			);
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
				rings.vertex(
					point[0] as number,
					point[1] as number,
					point[2] as number,
					ox,
					oy,
					oz,
					Math.sqrt(rx * rx + ry * ry),
					(seamV[j] as number) * (1 - t) + this.vAt(context, s) * t,
					junctionMask(s - sj, collarLength, c),
					f.radius,
					s,
				);
			}
		}
		rings.welded = blend;
		// Past the blend the child is its own: no fillet, no collar, no mask.
		const welded: AxisContext = { ...context, collarFrom: highest, collarLength, swell, fillet: 0 };
		return { context: welded, end, sides };
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
		const pt = frameAt(parentContext.path, parentContext.path.length, this.frame).tangent;
		const lt = path.tangent;
		const cosine =
			(pt[0] as number) * (lt[0] as number) +
			(pt[1] as number) * (lt[1] as number) +
			(pt[2] as number) * (lt[2] as number);
		const angle = Math.min(LEADER_TILT, acos(Math.min(1, Math.max(-1, cosine))));
		const clear = mean * tan(angle) + 0.25 * rc;
		const led: AxisContext = {
			...context,
			taper: mean,
			taperLength: Math.max(BLEND_RADII * rc, mean),
		};
		return {
			context: led,
			end: Math.min(path.length, Math.max(clear, 0.5 * this.tube.edge)),
			sides,
		};
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
		for (let r = 0; r < rings.count; r++) {
			const first = rings.first[r] as number;
			const sides = rings.sides[r] as number;
			const dome = (rings.arc[r] as number) > context.path.length + 1e-9;
			if (!dome) {
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
				const pipe = rings.pipe[first] as number;
				const scale = this.bark.scale(pipe);
				const ringWidth = this.bark.width(pipe, rings.centre[r * 3 + 1] as number);
				const bark = perimeter / scale;
				// A leader's first ring is its parent's last, and keeps that ring's bark.
				const inherited = inherit !== undefined && r === 0;
				const ringTiles = inherited
					? tiles
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

	/** Writes an axis's rings and the strips between them. */
	private write(rings: AxisRings, bark: BarkRings, context: AxisContext, wood: WoodAxis): void {
		const writer = this.writer;
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
					skyAt(
						this.crown,
						rings.position[i * 3] as number,
						rings.position[i * 3 + 1] as number,
						rings.position[i * 3 + 2] as number,
					),
				);
			}
		}
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
		if (this.welds) {
			this.welds.axisFirst.set(wood.axis, [firstVertex, writer.vertices - firstVertex]);
			if (wood.parent >= 0) {
				this.welds.child.push(wood.axis);
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
	/** The skeleton axis of each meshed axis's parent, by skeleton axis. */
	readonly parents: Map<number, number>;
	/** The rings of each meshed axis, by skeleton axis. */
	readonly axisRings: Map<number, AxisRings>;
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
	for (let i = 0; i < axes.length; i++) {
		const wood = axes[i] as WoodAxis;
		parents.set(wood.axis, wood.parent >= 0 ? (axes[wood.parent] as WoodAxis).axis : -1);
		const rings = mesher.ringsOf(i);
		if (rings) axisRings.set(wood.axis, rings);
	}
	return {
		mesh,
		rings: mesher.rings as WoodRings,
		welds: mesher.welds as WoodWelds,
		parents,
		axisRings,
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
