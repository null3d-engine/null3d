// Tubes: where the rings of an axis stand, how many sides each has, and the rings themselves as the
// mesher builds them, after design §7.1. Rings stand closer where the axis bends, where its radius
// changes fast and near the ground; sides follow the ring's girth, so an edge round the ring keeps
// about the tier's length, from a twig's few sides to a trunk's 96. A ring's side count holds until
// the girth moves it by more than a step, and two rings of different counts are stitched by angle.
import { acos, cos, PI, sin } from '../core/math';
import type { Detail } from '../core/types';
import type { MeshLevel } from '../stages';
import type { AxisPath } from './frames';

/** The edge round a ring at the nearest level, in metres, by detail tier. */
const EDGE: Record<Detail, number> = { low: 0.05, medium: 0.035, high: 0.025, ultra: 0.018 };

/**
 * Wood thinner than this radius in metres is thin: three sides, the fewest blend rings and a plain
 * point for a tip. A macro skeleton's finest axes are mostly thin, and they are most of its axes.
 */
export const THIN = 0.008;

/** How much longer edges and ring steps grow at each card level. */
const LEVEL_SCALE = [1, 2, 4] as const;

/** How much longer edges and ring steps grow on the coarsest plant, over and above the level's. */
export const COARSE_EDGE = 2;

/** How much longer edges grow at the sparsest sections, over the coarseness's own growth. */
const SECTION_EDGE = 7;

/** Metres a ring step may reach at the sparsest sections, over the level's own cap. */
const SECTION_STEP = 8;

/** Radians an axis may turn between two rings at the sparsest sections. */
const SECTION_TURN = Math.PI / 2;

/** The fewest sides a ring has at the sparsest sections: a closed run of three. */
const SECTION_SIDES = 3;

/** The most sides a ring has at each level. */
const MAX_SIDES = [96, 48, 24] as const;

/** Radians an axis may turn between two rings at each level, so ring planes never cross inside. */
const MAX_TURN = [0.4, 0.55, 0.8] as const;

/**
 * The turn between two rings on thick wood, in radians, times the radius over the level's edge:
 * thick wood turns by less between rings, so its bends draw as smooth curves, not creases.
 */
const SMOOTH_TURN = 0.5;
/** The least turn, in radians, that thick wood may take between two rings. */
const LEAST_TURN = 0.1;

/**
 * Radians wood of a radius may turn between two rings at a level: the level's turn on thin wood,
 * less on thick wood, whose crease between two rings would show.
 *
 * @param radius The wood's radius in metres.
 * @param tube The level's detail.
 * @returns The turn.
 */
export function ringTurn(radius: number, tube: TubeDetail): number {
	return Math.max(LEAST_TURN, Math.min(tube.maxTurn, (SMOOTH_TURN * tube.edge) / radius));
}

/**
 * How far the axis may stray from the straight line between two rings, and the radius from the
 * straight taper between them, as a share of the radius, at each level.
 */
const STRAY = [0.1, 0.15, 0.25] as const;

/** The stray a step may keep as a share of its own length, so long gentle bends take few rings. */
const STRAY_ALONG = 0.02;

/** The least stray in metres that counts, so twigs do not take a ring per millimetre of crook. */
const LEAST_STRAY = [0.002, 0.004, 0.01] as const;

/**
 * How finely one level of the wood is meshed.
 */
export interface TubeDetail {
	/** The level. */
	readonly level: MeshLevel;
	/** Metres of an edge round a ring. */
	readonly edge: number;
	/** The most sides of a ring. */
	readonly maxSides: number;
	/** Radians the axis may turn between two rings. */
	readonly maxTurn: number;
	/** The share of the radius the axis and the radius may stray from straight between two rings. */
	readonly stray: number;
	/** The least stray in metres. */
	readonly leastStray: number;
	/** How far the sections are thinned, from 0 to the level's own counts, to 1, the fewest. */
	readonly sections: number;
	/** Metres the longest step between rings may reach. */
	readonly step: number;
}

/**
 * The tube detail of a level at a tier. A coarser plant takes longer edges, so its rings have fewer
 * sides and stand further apart. Thinned sections take longer edges still, fewer sides down to a
 * closed run of three, and a longer step between rings, so a whole tree can draw in tens of
 * triangles at the far levels.
 *
 * @param level The level.
 * @param detail The tier.
 * @param coarseness From 0, as the tier meshes, to 1, the coarsest.
 * @param sections From 0, the level's own sections, to 1, the fewest rings and sides.
 * @returns The detail.
 */
export function tubeDetail(
	level: MeshLevel,
	detail: Detail,
	coarseness = 0,
	sections = 0,
): TubeDetail {
	const thin = Math.max(0, Math.min(1, sections));
	const edge =
		EDGE[detail] *
		LEVEL_SCALE[level] *
		(coarseness > 0 ? 1 + COARSE_EDGE * Math.min(1, coarseness) : 1) *
		(1 + SECTION_EDGE * thin);
	return {
		level,
		edge,
		maxSides: Math.max(
			SECTION_SIDES,
			Math.round(MAX_SIDES[level] * (1 - thin) + SECTION_SIDES * thin),
		),
		maxTurn: Math.min(SECTION_TURN, MAX_TURN[level] * (1 + 3 * thin)),
		stray: STRAY[level] * (1 + 3 * thin),
		leastStray: LEAST_STRAY[level] * (1 + 4 * thin),
		sections: thin,
		step: 1.2 + SECTION_STEP * thin,
	};
}

/**
 * The sides of a ring of a given perimeter: the perimeter over the edge, held between the level's
 * fewest and most. Thin wood takes fewer sides at the card levels.
 *
 * @param perimeter The ring's perimeter in metres.
 * @param radius The ring's radius in metres.
 * @param tube The level's detail.
 * @returns The side count.
 */
export function sidesFor(perimeter: number, radius: number, tube: TubeDetail): number {
	const base = tube.level === 0 ? (radius >= 0.02 ? 6 : radius >= THIN ? 4 : 3) : 3;
	const fewest = Math.max(SECTION_SIDES, Math.round(base - (base - SECTION_SIDES) * tube.sections));
	return Math.min(tube.maxSides, Math.max(fewest, Math.round(perimeter / tube.edge)));
}

/**
 * The side count of the next ring: the ring before's count while the girth asks for nearly the same,
 * so the counts do not flicker along a gently tapering axis.
 *
 * @param wanted The count the ring's girth asks for.
 * @param previous The ring before's count, or 0 at an axis's first ring.
 * @returns The count.
 */
export function heldSides(wanted: number, previous: number): number {
	if (previous <= 0) return wanted;
	return Math.abs(wanted - previous) <= Math.max(1, Math.floor(previous * 0.15))
		? previous
		: wanted;
}

/** A point of the path at an arc length, by its samples. */
function pointAt(path: AxisPath, s: number, out: Float64Array): void {
	const arc = path.arc;
	let i = 0;
	let j = path.count - 1;
	while (j - i > 1) {
		const m = (i + j) >> 1;
		if ((arc[m] as number) <= s) i = m;
		else j = m;
	}
	const span = (arc[j] as number) - (arc[i] as number);
	const t = span > 0 ? Math.min(1, Math.max(0, (s - (arc[i] as number)) / span)) : 0;
	for (let k = 0; k < 3; k++)
		out[k] =
			(path.position[i * 3 + k] as number) * (1 - t) + (path.position[j * 3 + k] as number) * t;
}

const from = new Float64Array(3);
const to = new Float64Array(3);

/**
 * Whether a straight, linearly tapering piece from `s` to `next` stands close enough to the axis:
 * the curve's samples between stay near the chord, the radius halfway stays near the mean of its
 * ends, and the axis turns by less than the level allows.
 */
function fits(
	path: AxisPath,
	s: number,
	next: number,
	first: number,
	radiusAt: (s: number) => number,
	tube: TubeDetail,
): boolean {
	const r0 = radiusAt(s);
	const r1 = radiusAt(next);
	const tolerance = Math.max(
		tube.leastStray,
		tube.stray * Math.min(r0, r1),
		STRAY_ALONG * (next - s),
	);
	const middle = radiusAt((s + next) / 2);
	if (Math.abs(middle - (r0 + r1) / 2) > tolerance) return false;
	pointAt(path, s, from);
	pointAt(path, next, to);
	const cx = (to[0] as number) - (from[0] as number);
	const cy = (to[1] as number) - (from[1] as number);
	const cz = (to[2] as number) - (from[2] as number);
	const c2 = cx * cx + cy * cy + cz * cz;
	const turn = ringTurn(Math.max(r0, r1), tube);
	const t = path.tangent;
	const fx = t[first * 3] as number;
	const fy = t[first * 3 + 1] as number;
	const fz = t[first * 3 + 2] as number;
	for (let i = first; i < path.count; i++) {
		const a = path.arc[i] as number;
		if (a >= next) break;
		if (a <= s) continue;
		const dot =
			fx * (t[i * 3] as number) + fy * (t[i * 3 + 1] as number) + fz * (t[i * 3 + 2] as number);
		if (acos(Math.min(1, Math.max(-1, dot))) > turn) return false;
		const px = (path.position[i * 3] as number) - (from[0] as number);
		const py = (path.position[i * 3 + 1] as number) - (from[1] as number);
		const pz = (path.position[i * 3 + 2] as number) - (from[2] as number);
		const along = c2 > 0 ? (px * cx + py * cy + pz * cz) / c2 : 0;
		const ox = px - along * cx;
		const oy = py - along * cy;
		const oz = pz - along * cz;
		if (ox * ox + oy * oy + oz * oz > tolerance * tolerance) return false;
	}
	return true;
}

/**
 * The arc lengths at which an axis's rings stand, from `start` to the path's end. Each step is as
 * long as the level allows, then halved until a straight, linearly tapering piece fits the axis:
 * so rings crowd where the axis bends or its radius curves, as in a stem's flared foot, and thin
 * out along straight, evenly tapering wood.
 *
 * @param path The axis's path.
 * @param start The arc length of the first ring.
 * @param radiusAt The mean radius of a ring at an arc length, with flare and collar.
 * @param tube The level's detail.
 * @param nearGround Whether an arc length lies in the stem's flared foot.
 * @returns The arc lengths, rising, the last at the path's end.
 */
export function ringArcs(
	path: AxisPath,
	start: number,
	radiusAt: (s: number) => number,
	tube: TubeDetail,
	nearGround: (s: number) => boolean,
): number[] {
	const arcs = [start];
	const end = path.length;
	if (end - start <= 1e-6) return arcs;
	const scale = tube.edge / EDGE.high;
	let s = start;
	let first = 0;
	while (s < end - 1e-6) {
		while (first < path.count - 1 && (path.arc[first + 1] as number) <= s) first++;
		const r = radiusAt(s);
		const longest = nearGround(s)
			? Math.max(0.02, r / 2) * scale
			: Math.min(tube.step, 1.2 * scale);
		// The longest step that fits; failing that, the farthest of the axis's points within reach,
		// where its radius and direction kink; failing that, halves of the step.
		let next = Math.min(end, s + longest);
		if (!fits(path, s, next, first, radiusAt, tube)) {
			let found = false;
			const knots = path.knots;
			for (let k = knots.length - 1; k >= 0 && !found; k--) {
				const knot = knots[k] as number;
				if (knot >= next || knot <= s + tube.edge * 0.25) continue;
				if (fits(path, s, knot, first, radiusAt, tube)) {
					next = knot;
					found = true;
				}
			}
			for (let k = 0; k < 10 && !found; k++) {
				next = s + (next - s) / 2;
				found = next - s <= tube.edge * 0.25 || fits(path, s, next, first, radiusAt, tube);
			}
		}
		// Do not leave a sliver of a step before the end.
		if (end - next < 0.3 * (next - s)) next = end;
		s = next;
		arcs.push(s);
	}
	return arcs;
}

/** A child at its parent's end leads a fork when it has at least this share of the parent's girth. */
export const LEADER_SHARE = 0.5;

/**
 * A side child of at least this share of its parent's girth is codominant with the parent's own
 * wood: the parent's wood divides there into a fork, rather than taking the child on its side.
 */
export const CODOMINANT = 0.75;

/** A leader bends on rings of its own only where its turn sweeps its girth over this many edges. */
const BEND_EDGES = 2;

/**
 * The rings on the bend by which a fork's leader turns from its parent's line onto its own: one
 * for each turn the wood allows between rings, past the first. Wood whose turn sweeps its girth
 * over less than a few edges takes none, since its fold does not show.
 *
 * @param turn Radians between the parent's line and the leader's.
 * @param girth The parent's radius at the fork, in metres.
 * @param tube The level's detail.
 * @returns The rings between the parent's last ring and the leader's first plain ring.
 */
export function bendRings(turn: number, girth: number, tube: TubeDetail): number {
	// A thinned section takes the fold on one ring, so its fork draws a hard corner or none at all.
	const allowed = turn * (1 - tube.sections);
	if (girth * allowed < BEND_EDGES * tube.edge) return 0;
	return Math.max(0, Math.ceil(allowed / ringTurn(girth, tube)) - 1);
}

/** The cosine and sine of each side's angle, by side count, made once. */
const angles = new Map<number, Float64Array>();

/**
 * The cosine and sine of each angle round a ring of `sides` sides, interleaved: side j's cosine at
 * 2j and sine at 2j + 1, from angle 0 to one past the last side.
 *
 * @param sides The side count.
 * @returns The table.
 */
export function ringTrig(sides: number): Float64Array {
	let table = angles.get(sides);
	if (!table) {
		table = new Float64Array((sides + 1) * 2);
		for (let j = 0; j <= sides; j++) {
			const theta = (j / sides) * 2 * PI;
			table[j * 2] = cos(theta);
			table[j * 2 + 1] = sin(theta);
		}
		angles.set(sides, table);
	}
	return table;
}

/** A copy of `array` with room for `size` numbers. */
function grown(array: Float64Array, size: number): Float64Array<ArrayBuffer> {
	const next = new Float64Array(size);
	next.set(array);
	return next;
}

/**
 * The rings of one axis as the mesher builds them: per ring its frame, its `v` and its side count,
 * and per side its vertex. A ring's last vertex is not repeated here; the writer repeats it for the
 * seam of `u`. The arrays grow as rings arrive and hold spare room past the counts.
 */
export class AxisRings {
	/** Rings stored. */
	count = 0;
	/** Vertices stored, over all rings. */
	vertices = 0;
	/** The rings at the start that blend from a weld on the parent to the axis's own circle. */
	welded = 0;
	/** Whether the first ring is the parent's own last ring, as a fork's leader's is. */
	shared = false;
	/** Per ring: first vertex, sides, arc length on the path, `v` at the centre. */
	first = new Int32Array(16);
	sides = new Int32Array(16);
	arc = new Float64Array(16);
	v = new Float64Array(16);
	/** Per ring, 3 numbers each: centre, tangent, normal, binormal. */
	centre = new Float64Array(48);
	tangent = new Float64Array(48);
	normal = new Float64Array(48);
	binormal = new Float64Array(48);
	/** Per vertex, 3 numbers each: position and unit normal. */
	position = new Float64Array(3 * 256);
	vertexNormal = new Float64Array(3 * 256);
	/** Per vertex: radius from the ring's centre in its plane, `v`, junction mask, pipe radius, arc. */
	rho = new Float64Array(256);
	vv = new Float64Array(256);
	mask = new Float64Array(256);
	pipe = new Float64Array(256);
	along = new Float64Array(256);

	/**
	 * Starts a ring.
	 *
	 * @param sides Its side count.
	 * @param arc Its arc length on the axis's path.
	 * @param centre Its centre.
	 * @param tangent Its frame's tangent.
	 * @param normal Its frame's normal, where its angle 0 points.
	 * @param binormal Its frame's binormal.
	 * @param v The bark's `v` at its centre.
	 * @returns The ring's index.
	 */
	begin(
		sides: number,
		arc: number,
		centre: ArrayLike<number>,
		tangent: ArrayLike<number>,
		normal: ArrayLike<number>,
		binormal: ArrayLike<number>,
		v: number,
	): number {
		const ring = this.count;
		if (ring === this.first.length) {
			const size = ring * 2;
			const first = new Int32Array(size);
			first.set(this.first);
			this.first = first;
			const count = new Int32Array(size);
			count.set(this.sides);
			this.sides = count;
			this.arc = grown(this.arc, size);
			this.v = grown(this.v, size);
			this.centre = grown(this.centre, size * 3);
			this.tangent = grown(this.tangent, size * 3);
			this.normal = grown(this.normal, size * 3);
			this.binormal = grown(this.binormal, size * 3);
		}
		this.first[ring] = this.vertices;
		this.sides[ring] = sides;
		this.arc[ring] = arc;
		this.v[ring] = v;
		for (let k = 0; k < 3; k++) {
			this.centre[ring * 3 + k] = centre[k] as number;
			this.tangent[ring * 3 + k] = tangent[k] as number;
			this.normal[ring * 3 + k] = normal[k] as number;
			this.binormal[ring * 3 + k] = binormal[k] as number;
		}
		this.count++;
		return ring;
	}

	/** Adds a vertex to the ring begun last; its normal is made unit length. */
	vertex(
		px: number,
		py: number,
		pz: number,
		nx: number,
		ny: number,
		nz: number,
		rho: number,
		v: number,
		mask: number,
		pipe: number,
		along: number,
	): void {
		const i = this.vertices;
		if (i === this.rho.length) {
			const size = i * 2;
			this.position = grown(this.position, size * 3);
			this.vertexNormal = grown(this.vertexNormal, size * 3);
			this.rho = grown(this.rho, size);
			this.vv = grown(this.vv, size);
			this.mask = grown(this.mask, size);
			this.pipe = grown(this.pipe, size);
			this.along = grown(this.along, size);
		}
		const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
		this.position[i * 3] = px;
		this.position[i * 3 + 1] = py;
		this.position[i * 3 + 2] = pz;
		this.vertexNormal[i * 3] = nx / l;
		this.vertexNormal[i * 3 + 1] = ny / l;
		this.vertexNormal[i * 3 + 2] = nz / l;
		this.rho[i] = rho;
		this.vv[i] = v;
		this.mask[i] = mask;
		this.pipe[i] = pipe;
		this.along[i] = along;
		this.vertices++;
	}
}

/**
 * Writes the triangles of the strip between two rings of `count` and `next` sides, each ring given
 * by the index of its first written vertex and holding sides + 1 vertices (the seam repeated). The
 * two rings are walked together by their share of the way round, so rings of different side counts
 * join without a gap.
 *
 * @param indices The index list to add to.
 * @param a The first vertex of the lower ring.
 * @param sidesA Its sides.
 * @param b The first vertex of the upper ring.
 * @param sidesB Its sides.
 */
export function stitch(
	indices: number[],
	a: number,
	sidesA: number,
	b: number,
	sidesB: number,
): void {
	let i = 0;
	let j = 0;
	while (i < sidesA || j < sidesB) {
		const nextA = (i + 1) / sidesA;
		const nextB = (j + 1) / sidesB;
		if (j >= sidesB || (i < sidesA && nextA <= nextB)) {
			indices.push(a + i, a + i + 1, b + j);
			i++;
		} else {
			indices.push(a + i, b + j + 1, b + j);
			j++;
		}
	}
}
