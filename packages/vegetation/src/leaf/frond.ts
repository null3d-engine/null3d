// The frond foliage kind: a fern's frond, pinnate or bipinnate, as one sheet over the leaf
// texture's outline. The texture holds the whole blade, so its alpha cuts the pinnae, the pinnules
// and their lobes, and the geometry gives the blade its shape in space: the rachis's curve, each
// pinna's line bending off the rachis, the V of each pinna's pinnules about its costa, and twist.
//
// A pinna leaves the rachis at the angle the record gives for its place, so every point of the flat
// blade lies on one pinna line: the line at that angle through it, which meets the rachis at y0.
// The point goes where that line goes in space: from the rachis's frame at y0, out along the pinna
// and bending over its length. The map is smooth across the whole blade, so the sheet never tears
// between pinnae even where the record's pinnae do not stand exactly where the texture's do. The V
// about each costa is the point's distance from the nearest pinna's line, which is continuous too:
// where two pinnae meet, both give the same distance.
//
// A frond's age runs from 0, a crozier just risen, through 0.5, mature, to 1, brown and dead. A
// crozier's rachis and pinnae are rolled toward their upper faces in a coil that tightens toward the
// tip, and unroll from the base; a mature frond droops by its record; a browning frond droops
// further and browns from its pinnae's tips inward.
//
// Frond space for the kit's leaf: the stipe's foot at the origin, the rachis up +Y, the upper face
// toward +Z. On a plant the rachis is the skeleton's rachis axis and the blade follows it.
import type { MeshArrays, PrototypeArrays } from '../asset';
import { AXIS_RACHIS, type MacroSkeleton } from '../core/graph';
import { atan2, cos, PI, pow, quatRotate, radians, sin, tan, type Vector3 } from '../core/math';
import type { FrondShape, PinnaSpec, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { type Curve, curveAt, DETAILS, type Detail, spreadMean } from '../core/types';
import { crownSkyAt } from '../crown/visibility';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';
import type { FoliageBuilder } from './kinds';
import { cutLeaf, type LeafCut } from './leaf-mesh';
import { type LeafOutline, textureOutline } from './outline';
import { MeshWriter, phaseByte, SURFACE_LEAF, tube } from './writer';

/**
 * A frond's age in the two shares its shape reads.
 *
 * @category api/vegetation
 */
export interface FrondAge {
	/** How far the crozier has unrolled, 0 rolled to 1 open. */
	readonly unrolled: number;
	/** How far the frond has browned and slumped, 0 green to 1 dead. */
	readonly brown: number;
}

/**
 * The age of a mature frond: open and green. Below it a frond is a crozier, above it it browns.
 *
 * @category api/vegetation
 */
export const MATURE_AGE = 0.5;

/** The coil of a wholly rolled rachis or pinna, in radians from its unrolled part to its tip. */
const COIL = 2.6 * PI;
/** How fast the coil tightens toward the tip: its bend grows as this power of the rolled share. */
const COIL_POWER = 1.8;
/** How much further a dead frond droops than a mature one. */
const SLUMP = 0.6;
/** How far ahead of the rachis's unrolling a pinna unrolls, as a share of the rachis. */
const PINNA_LEAD = 0.6;
/** Steps along a pinna when its bend is not a single arc. */
const PINNA_STEPS = 8;
/** Steps along the rachis when its curve is laid out. */
const RACHIS_STEPS = 256;
/** The longest step between two of the rachis's nodes, in metres. */
const RACHIS_NODE = 0.03;
/** The most the rachis turns between two of its nodes, in radians. */
const RACHIS_TURN = 0.18;
/** The thinnest a rachis or stipe gets, in metres of radius. */
const THINNEST = 0.0005;
/** Where a parametric frond's blade starts and ends in v, and the texels it stands for. */
const PARAMETRIC_BASE = 0.04;
const PARAMETRIC_TIP = 0.96;
const PARAMETRIC_TEXELS = 1024;
/** The height in plant space that no frond of a plant goes below: a blade lying on the ground. */
const GROUND = 0.003;
/** Samples along the rachis of a parametric frond's outline, per side. */
const PARAMETRIC_SAMPLES = 24;

/**
 * The frond's grid at each detail, coarsest first. The nearest level of a tier takes the cut one
 * above its index; each card level takes two cuts fewer.
 */
const CUTS: readonly LeafCut[] = [
	{ rows: 4, columns: 1, smooth: 1, points: 16 },
	{ rows: 8, columns: 2, smooth: 2, points: 24 },
	{ rows: 16, columns: 3, smooth: 2, points: 40 },
	{ rows: 32, columns: 5, smooth: 3, points: 64 },
	{ rows: 56, columns: 8, smooth: 3, points: 96 },
];

/** Sides of the stipe tube of the kit's leaf by tier. */
const STIPE_SIDES: Readonly<Record<Detail, number>> = { low: 3, medium: 4, high: 5, ultra: 6 };

/**
 * The cut a frond takes at a tier and level.
 *
 * @param detail The tier.
 * @param level The level: 0 nearest, 1 and 2 the card levels.
 * @returns The grid.
 * @category api/vegetation
 */
export function frondCut(detail: Detail, level: MeshLevel): LeafCut {
	const index = Math.max(0, Math.min(CUTS.length - 1, DETAILS.indexOf(detail) + 1 - 2 * level));
	return CUTS[index] as LeafCut;
}

/**
 * A frond's age as its two shares.
 *
 * @param age 0 a new crozier, 0.5 mature, 1 brown and dead.
 * @returns How far it has unrolled and browned.
 * @category api/vegetation
 */
export function frondAge(age: number): FrondAge {
	const a = Math.max(0, Math.min(1, age));
	return {
		unrolled: Math.min(1, a / MATURE_AGE),
		brown: Math.max(0, (a - MATURE_AGE) / (1 - MATURE_AGE)),
	};
}

/**
 * The frond of a species whose foliage is fronds: a frond colony's or a crown rosette's.
 *
 * @param record The species record.
 * @returns The frond's shape.
 * @category api/vegetation
 */
export function frondShapeOf(record: Species): FrondShape {
	const growth = record.growth;
	if (growth.model === 'frond-colony' || growth.model === 'crown-rosette') return growth.frond;
	throw new Error(
		`@null3d/vegetation: frond foliage needs a frond-colony or crown-rosette grower, not '${growth.model}'`,
	);
}

/** The pinnae of a pinnate or bipinnate frond. */
export function pinnaeOf(shape: FrondShape): PinnaSpec {
	if ((shape.kind === 'pinnate' || shape.kind === 'bipinnate') && shape.pinnae) return shape.pinnae;
	throw new Error(
		`@null3d/vegetation: a '${shape.kind}' frond is not built; pinnate and bipinnate fronds with pinnae are`,
	);
}

/** A curve's value in radians at t. */
function angleAt(curve: Curve, t: number): number {
	return radians(curveAt(curve, t));
}

/**
 * How far the rachis has turned toward its lower face at a share of its length, in radians: the
 * record's droop on the unrolled part, scaled by how far the frond has opened and deepened as it
 * dies, then the coil on the rolled part, toward the upper face, tightening to the tip.
 *
 * @param shape The frond.
 * @param age The frond's age.
 * @param t The share along the rachis.
 * @returns The turn; below 0 it turns toward the upper face.
 * @category api/vegetation
 */
export function rachisBend(shape: FrondShape, age: FrondAge, t: number): number {
	const open = age.unrolled * age.unrolled * (3 - 2 * age.unrolled);
	const droop = (at: number) => angleAt(shape.droop, at) * open * (1 + SLUMP * age.brown);
	const u = age.unrolled;
	if (t <= u || u >= 1) return droop(t);
	const q = (t - u) / (1 - u);
	return droop(u) - COIL * pow(q, COIL_POWER);
}

/**
 * A rachis laid out in its own plane: points as metres along its base direction and toward its
 * lower face, with the turn at each, from the blade's base to its tip. Points stand closer where
 * the rachis turns fast, so a crozier's coil stays round.
 *
 * @param shape The frond.
 * @param age The frond's age.
 * @param length The rachis's length in metres.
 * @returns Along, toward the lower face and the turn, three numbers a point.
 * @category api/vegetation
 */
export function rachisCurve(shape: FrondShape, age: FrondAge, length: number): number[] {
	const out = [0, 0, 0];
	let a = 0;
	let b = 0;
	let since = 0;
	let turned = rachisBend(shape, age, 0);
	const step = length / RACHIS_STEPS;
	for (let i = 0; i < RACHIS_STEPS; i++) {
		const middle = rachisBend(shape, age, (i + 0.5) / RACHIS_STEPS);
		a += step * cos(middle);
		b += step * sin(middle);
		since += step;
		const end = rachisBend(shape, age, (i + 1) / RACHIS_STEPS);
		if (
			i === RACHIS_STEPS - 1 ||
			since >= RACHIS_NODE - 1e-9 ||
			Math.abs(end - turned) >= RACHIS_TURN
		) {
			out.push(a, b, end);
			since = 0;
			turned = end;
		}
	}
	return out;
}

/**
 * Where each pinna pair leaves the rachis, as shares of its length: spaced in step with the pinnae's
 * own length, close at the tip where they are short, from the base to near the tip.
 *
 * @param pinnae The pinnae.
 * @returns The shares, base first.
 * @category api/vegetation
 */
export function pinnaPlaces(pinnae: PinnaSpec): number[] {
	const count = Math.max(1, Math.round(spreadMean(pinnae.count)));
	const samples = 64;
	const weight: number[] = [0];
	for (let i = 0; i < samples; i++) {
		const t = (i + 0.5) / samples;
		// Pinnae stand in step with their length: the rachis between them runs at one over it.
		weight.push((weight[i] as number) + 1 / (0.1 + curveAt(pinnae.length, t)));
	}
	const total = weight[samples] as number;
	const places: number[] = [];
	for (let k = 0; k < count; k++) {
		const goal = (k / count) * total;
		let i = 0;
		while (i < samples - 1 && (weight[i + 1] as number) < goal) i++;
		const low = weight[i] as number;
		const high = weight[i + 1] as number;
		places.push((i + (high > low ? (goal - low) / (high - low) : 0)) / samples);
	}
	return places;
}

/**
 * A frond's outline drawn from its pinnae, for a species with no texture leaf: the base, each
 * pinna's tip on both sides and the blade's tip, in texture coordinates.
 *
 * @param shape The frond.
 * @returns The outline.
 * @category api/vegetation
 */
export function frondOutline(shape: FrondShape): LeafOutline {
	const pinnae = pinnaeOf(shape);
	const span = PARAMETRIC_TIP - PARAMETRIC_BASE;
	const right: number[] = [];
	for (let i = 0; i <= PARAMETRIC_SAMPLES; i++) {
		const t = i / PARAMETRIC_SAMPLES;
		const reach = curveAt(pinnae.length, t) * span;
		const angle = angleAt(pinnae.angle, t);
		// Pinnules reach a little past the costa's line on its lower side.
		const u = Math.min(0.49, reach * sin(angle) * 1.04 + 0.006);
		const v = Math.min(PARAMETRIC_TIP, PARAMETRIC_BASE + t * span + reach * cos(angle));
		right.push(u, v);
	}
	const points: number[] = [0.5, PARAMETRIC_BASE - 0.01];
	for (let i = 0; i < right.length; i += 2)
		points.push(0.5 + (right[i] as number), right[i + 1] as number);
	points.push(0.5, PARAMETRIC_TIP);
	for (let i = right.length - 2; i >= 0; i -= 2)
		points.push(0.5 - (right[i] as number), right[i + 1] as number);
	return {
		points,
		petiole: [0.5, 0],
		base: [0.5, PARAMETRIC_BASE],
		tip: [0.5, PARAMETRIC_TIP],
		texels: PARAMETRIC_TEXELS,
	};
}

/**
 * A frond's outline: the texture's measured contour, or one drawn from its pinnae.
 *
 * @param shape The frond.
 * @param manifest The species' texture manifest.
 * @returns The outline.
 * @category api/vegetation
 */
export function frondOutlineOf(shape: FrondShape, manifest: TextureManifest): LeafOutline {
	return manifest.leaf ? textureOutline(manifest.leaf) : frondOutline(shape);
}

/** Where a point of the flat blade goes, and what its vertex carries. */
interface BladePoint {
	/** The point in space. */
	readonly at: Vector3;
	/** Its share along the frond, for the bend and flutter weight. */
	share: number;
	/** How brown it is, 0 to 1. */
	brown: number;
}

/**
 * One frond's blade in space: the flat blade's points, in metres across and along the rachis from
 * the blade's base, carried onto the rachis's path and out along the pinnae.
 *
 * @category api/vegetation
 */
export class FrondBlade {
	private readonly frame: PathFrame = emptyFrame();
	private readonly pinnae: PinnaSpec;
	private readonly places: number[];
	private readonly twist: number;
	private readonly fold: number;

	/**
	 * @param shape The frond.
	 * @param age The frond's age.
	 * @param path The rachis's path from the blade's base, its normal on the upper face.
	 * @param foldWeight How much of the pinnae's fold the grid can show, 0 to 1.
	 * @param ground The height no point of the blade goes below, in the path's space.
	 */
	constructor(
		readonly shape: FrondShape,
		readonly age: FrondAge,
		readonly path: AxisPath,
		foldWeight: number,
		private readonly ground = Number.NEGATIVE_INFINITY,
	) {
		this.pinnae = pinnaeOf(shape);
		this.places = pinnaPlaces(this.pinnae);
		this.twist = radians(shape.twist);
		this.fold = tan(radians(this.pinnae.fold)) * foldWeight;
	}

	/** The blade's length: the rachis's. */
	get length(): number {
		return this.path.length;
	}

	/**
	 * Places one point of the flat blade.
	 *
	 * @param x Metres across the rachis, toward the right side of the upper face when above 0.
	 * @param y Metres along the rachis from the blade's base.
	 * @param out The point to write.
	 * @returns `out`.
	 */
	place(x: number, y: number, out: BladePoint): BladePoint {
		const length = Math.max(this.length, 1e-6);
		const pinnae = this.pinnae;
		const across = Math.abs(x);
		const side = x < 0 ? -1 : 1;
		// The pinna line through the point meets the rachis at y0.
		let y0 = y;
		let angle = angleAt(pinnae.angle, Math.max(0, Math.min(1, y / length)));
		for (let i = 0; i < 4 && across > 0; i++) {
			y0 = y - (across * cos(angle)) / Math.max(sin(angle), 0.05);
			angle = angleAt(pinnae.angle, Math.max(0, Math.min(1, y0 / length)));
		}
		let reach = across / Math.max(sin(angle), 0.05);
		if (y0 < 0 || y0 > length) {
			// Beyond the first or last pinna the point lies on a line from the rachis's end.
			y0 = y0 < 0 ? 0 : length;
			const dy = y - y0;
			reach = Math.sqrt(across * across + dy * dy);
			angle = reach > 0 ? atan2(across, dy) : angle;
		}
		const t = y0 / length;
		const frame = frameAt(this.path, y0, this.frame);
		const twist = this.twist * t;
		const ct = cos(twist);
		const st = sin(twist);
		const tg = frame.tangent;
		const nm = frame.normal;
		const bn = frame.binormal;
		// The upper face's normal and the right side, turned by the twist.
		const n0 = (nm[0] as number) * ct + (bn[0] as number) * st;
		const n1 = (nm[1] as number) * ct + (bn[1] as number) * st;
		const n2 = (nm[2] as number) * ct + (bn[2] as number) * st;
		const r0 = (bn[0] as number) * ct - (nm[0] as number) * st;
		const r1 = (bn[1] as number) * ct - (nm[1] as number) * st;
		const r2 = (bn[2] as number) * ct - (nm[2] as number) * st;
		const ca = cos(angle);
		const sa = sin(angle) * side;
		const d0 = (tg[0] as number) * ca + r0 * sa;
		const d1 = (tg[1] as number) * ca + r1 * sa;
		const d2 = (tg[2] as number) * ca + r2 * sa;
		// The pinna's line, bending toward its upper face (a coil) or away from it (a droop).
		const pinnaLength = Math.max(curveAt(pinnae.length, t) * length, 1e-4);
		const opened = Math.max(0, Math.min(1, this.age.unrolled * (1 + PINNA_LEAD) - t * PINNA_LEAD));
		const droop = radians(pinnae.droop) * (1 + SLUMP * this.age.brown);
		let along = 0;
		let up = 0;
		let bend = 0;
		if (reach > 0) {
			const steps = opened >= 1 ? 1 : PINNA_STEPS;
			const step = reach / steps;
			for (let i = 0; i < steps; i++) {
				const middle = pinnaBend((i + 0.5) * step, pinnaLength, droop, opened);
				along += step * cos(middle);
				up += step * sin(middle);
			}
			bend = pinnaBend(reach, pinnaLength, droop, opened);
		}
		// The V of the pinnules about the nearest pinna's costa, from the point's distance to it.
		let lift = 0;
		if (this.fold !== 0 && reach > 0) {
			let nearest = Number.POSITIVE_INFINITY;
			for (const place of this.places) nearest = Math.min(nearest, Math.abs(y0 - place * length));
			lift = nearest * sin(angle) * this.fold * Math.min(1, reach / (0.15 * pinnaLength));
		}
		// The pinna's own normal at the point, for the lift.
		const cb = cos(bend);
		const sb = sin(bend);
		const p = frame.position;
		out.at[0] = (p[0] as number) + d0 * along + n0 * up + (n0 * cb - d0 * sb) * lift;
		out.at[1] = Math.max(
			this.ground,
			(p[1] as number) + d1 * along + n1 * up + (n1 * cb - d1 * sb) * lift,
		);
		out.at[2] = (p[2] as number) + d2 * along + n2 * up + (n2 * cb - d2 * sb) * lift;
		out.share = Math.max(0, Math.min(1, y / length));
		const tipward = Math.min(1, reach / pinnaLength);
		out.brown = Math.max(0, Math.min(1, this.age.brown * 1.3 - 0.3 * (1 - tipward)));
		return out;
	}
}

/**
 * How far a pinna has turned toward its upper face at a distance along it, in radians: a droop that
 * grows evenly over its length, or, where it is still rolled, a coil that tightens to its tip.
 */
function pinnaBend(s: number, pinnaLength: number, droop: number, opened: number): number {
	const share = s / pinnaLength;
	if (opened >= 1 || share <= opened) return -droop * share * opened;
	const q = Math.min(1.5, (share - opened) / (1 - opened));
	return -droop * opened * opened + COIL * pow(q, COIL_POWER);
}

/** The vertex bytes and second coordinates of one frond in a variant's mesh. */
interface FrondVertex {
	/** The wind record's high and low bytes, the flutter phase and the sky visibility. */
	colour(at: Vector3, share: number): ArrayLike<number>;
}

/**
 * Writes one frond's blade: the outline's triangles carried into space, with normals from the bent
 * sheet, upper face front-facing.
 *
 * @param mesh The writer.
 * @param blade The frond's blade.
 * @param outline The outline the triangles were cut from.
 * @param cut The outline's points and triangles.
 * @param vertex The bytes of each vertex.
 * @param second The second coordinates of each vertex: share along and browning on a plant, metres
 *   along and across in the kit's leaf.
 */
export function writeBlade(
	mesh: MeshWriter,
	blade: FrondBlade,
	outline: LeafOutline,
	cut: { readonly points: number[]; readonly triangles: number[] },
	vertex: FrondVertex,
	second: (point: BladePoint, x: number, y: number) => [number, number],
): void {
	const { points, triangles } = cut;
	const count = points.length / 2;
	const scale = blade.length / Math.max(outline.tip[1] - outline.base[1], 1e-6);
	const placed: BladePoint = { at: [0, 0, 0], share: 0, brown: 0 };
	const at = new Float64Array(count * 3);
	const extra: [number, number][] = [];
	const shares = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const x = ((points[i * 2] as number) - 0.5) * scale;
		const y = ((points[i * 2 + 1] as number) - outline.base[1]) * scale;
		blade.place(x, y, placed);
		at[i * 3] = placed.at[0];
		at[i * 3 + 1] = placed.at[1];
		at[i * 3 + 2] = placed.at[2];
		shares[i] = placed.share;
		extra.push(second(placed, x, y));
	}
	// Normals from the bent sheet, each triangle weighted by its area.
	const normal = new Float64Array(count * 3);
	const kept: number[] = [];
	for (let t = 0; t < triangles.length; t += 3) {
		const a = triangles[t] as number;
		const b = triangles[t + 1] as number;
		const c = triangles[t + 2] as number;
		const ux = (at[b * 3] as number) - (at[a * 3] as number);
		const uy = (at[b * 3 + 1] as number) - (at[a * 3 + 1] as number);
		const uz = (at[b * 3 + 2] as number) - (at[a * 3 + 2] as number);
		const vx = (at[c * 3] as number) - (at[a * 3] as number);
		const vy = (at[c * 3 + 1] as number) - (at[a * 3 + 1] as number);
		const vz = (at[c * 3 + 2] as number) - (at[a * 3 + 2] as number);
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		if (nx * nx + ny * ny + nz * nz < 1e-24) continue;
		kept.push(a, b, c);
		for (const corner of [a, b, c]) {
			normal[corner * 3] = (normal[corner * 3] as number) + nx;
			normal[corner * 3 + 1] = (normal[corner * 3 + 1] as number) + ny;
			normal[corner * 3 + 2] = (normal[corner * 3 + 2] as number) + nz;
		}
	}
	const first = mesh.vertices;
	const p: Vector3 = [0, 0, 0];
	const n: Vector3 = [0, 0, 1];
	for (let i = 0; i < count; i++) {
		p[0] = at[i * 3] as number;
		p[1] = at[i * 3 + 1] as number;
		p[2] = at[i * 3 + 2] as number;
		const nx = normal[i * 3] as number;
		const ny = normal[i * 3 + 1] as number;
		const nz = normal[i * 3 + 2] as number;
		const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (l > 0) {
			n[0] = nx / l;
			n[1] = ny / l;
			n[2] = nz / l;
		}
		mesh.vertex(
			p,
			n,
			[points[i * 2] as number, points[i * 2 + 1] as number],
			extra[i] as [number, number],
			vertex.colour(p, shares[i] as number),
		);
	}
	for (const index of kept) mesh.indices.push(first + index);
}

/** How much of the pinnae's fold a grid can show: none until it has two rows to a pinna. */
export function foldWeight(cut: LeafCut, pinnae: PinnaSpec): number {
	const perPinna = cut.rows / Math.max(1, spreadMean(pinnae.count));
	return Math.max(0, Math.min(1, (perPinna - 2) / 2));
}

/**
 * One frond in frond space at one tier, mature and unbent, standing on its stipe: the cut frond of
 * the species' studio stills, and the 'leaf' review piece.
 *
 * @param record The species record.
 * @param manifest The species' texture manifest.
 * @param detail The tier.
 * @returns The frond's mesh: the blade, and the stipe as a stem in metres of young bark.
 * @category api/vegetation
 */
export function frondLeaf(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	age = MATURE_AGE,
): PrototypeArrays {
	const shape = frondShapeOf(record);
	const growth = record.growth;
	const stipe =
		growth.model === 'frond-colony'
			? spreadMean(growth.stipe.length)
			: Math.max(shape.petiole.length, 0);
	const length = spreadMean(shape.length);
	const radius = Math.max(shape.petiole.width / 2, THINNEST);
	const outline = frondOutlineOf(shape, manifest);
	const cut = frondCut(detail, 0);
	const points = new Float64Array(6);
	points.set([0, stipe, 0, 0, stipe + length, 0]);
	const path = axisPath(points, new Float64Array([radius, THINNEST]), 2, [0, 0, 1]);
	const blade = new FrondBlade(shape, frondAge(age), path, foldWeight(cut, pinnaeOf(shape)));
	const mesh = new MeshWriter();
	const leafBytes = [0, 0, SURFACE_LEAF, 255] as const;
	writeBlade(
		mesh,
		blade,
		outline,
		cutLeaf(outline, cut),
		{ colour: () => leafBytes },
		(placed, x) => [placed.share * length, x],
	);
	if (stipe > 0) {
		const rings = 4;
		const stem = [];
		for (let r = 0; r < rings; r++) {
			const along = (stipe * r) / (rings - 1);
			const share = r / (rings - 1);
			stem.push({ at: [0, along, 0] as Vector3, radius: radius * (1 - 0.25 * share), along });
		}
		// The leaf texture paints the stipe along the line from its cut to the blade's base, so the
		// tube samples that band and the stipe takes the colours its own picture gives it.
		const foot = outline.petiole;
		const head = outline.base;
		const stipeUv = (_around: number, ring: number): readonly [number, number] => {
			const t = ring / (rings - 1);
			return [foot[0], foot[1] + (head[1] - foot[1]) * t];
		};
		tube(mesh, stem, STIPE_SIDES[detail], () => [0, 0, SURFACE_LEAF, 255], false, stipeUv);
	}
	return mesh.finishPrototype();
}

/** One frond of a variant, read from its skeleton: the rachis's path and the frond's age. */
interface PlantFrond {
	readonly path: AxisPath;
	readonly age: FrondAge;
	readonly record: number;
	readonly phase: number;
}

/**
 * The fronds a skeleton carries: one at each bud site on a rachis axis, the rachis's path from its
 * junction with the stipe through its nodes, the upper face where the bud's +Z points, and the age
 * the bud's vigor holds.
 *
 * @param skeleton The grown or cut skeleton.
 * @param variant The variant, for the wind records' base.
 * @returns The fronds.
 * @category api/vegetation
 */
export function skeletonFronds(skeleton: MacroSkeleton, variant: number): PlantFrond[] {
	const { axes, buds, position } = skeleton;
	const fronds: PlantFrond[] = [];
	const up: Vector3 = [0, 0, 0];
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if ((axes.kind[axis] as number) !== AXIS_RACHIS) continue;
		const first = axes.first[axis] as number;
		const last = axes.last[axis] as number;
		const pts: number[] = [];
		const radii: number[] = [];
		const parentNode = axes.parentNode[axis] as number;
		if ((axes.parent[axis] as number) >= 0 && parentNode >= 0) {
			pts.push(
				position[parentNode * 3] as number,
				position[parentNode * 3 + 1] as number,
				position[parentNode * 3 + 2] as number,
			);
			radii.push(skeleton.radius[first] as number);
		}
		for (let n = first; n <= last; n++) {
			pts.push(
				position[n * 3] as number,
				position[n * 3 + 1] as number,
				position[n * 3 + 2] as number,
			);
			radii.push(skeleton.radius[n] as number);
		}
		if (radii.length < 2) continue;
		quatRotate(buds.frame, b * 4, [0, 0, 1], up);
		const path = axisPath(new Float64Array(pts), new Float64Array(radii), radii.length, up);
		fronds.push({
			path,
			age: frondAge(buds.vigor[b] as number),
			record: variant * VARIANT_RECORDS + (axes.record[axis] as number),
			phase: (axis * 97) & 255,
		});
	}
	return fronds;
}

/**
 * A frond plant's merged foliage at a level: every frond's blade on its rachis. Each vertex's
 * colour bytes are its frond's wind record, a flutter phase that drifts along the frond, and the
 * crown's sky visibility; its second coordinates are its share along the frond and how brown it is.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The fronds' mesh.
 * @category api/vegetation
 */
export function frondFoliage(input: MeshInput, level: MeshLevel): MeshArrays {
	const shape = frondShapeOf(input.record);
	const pinnae = pinnaeOf(shape);
	const outline = frondOutlineOf(shape, input.kit.manifest);
	const grid = frondCut(input.detail, level);
	const cut = cutLeaf(outline, grid);
	const weight = foldWeight(grid, pinnae);
	const mesh = new MeshWriter();
	for (const frond of skeletonFronds(input.skeleton, input.variant)) {
		const blade = new FrondBlade(shape, frond.age, frond.path, weight, GROUND);
		const bytes = [frond.record >> 8, frond.record & 255, 0, 0];
		writeBlade(
			mesh,
			blade,
			outline,
			cut,
			{
				colour(at, share) {
					bytes[2] = phaseByte(frond.phase + Math.round(share * 64));
					const sky = crownSkyAt(input.crown, at[0], at[1], at[2]);
					bytes[3] = Math.round(255 * Math.max(0, Math.min(1, sky)));
					return bytes;
				},
			},
			(placed) => [placed.share, placed.brown],
		);
	}
	return mesh.finishMesh();
}

/** The frond foliage kind's leaf builder: one whole frond on its stipe, per tier. */
export const builder: FoliageBuilder = {
	leaves(
		record: Species,
		manifest: TextureManifest,
		detail: Detail,
		age?: number,
	): readonly PrototypeArrays[] {
		if (record.foliage.kind !== 'frond')
			throw new Error(`@null3d/vegetation: the frond builder got '${record.foliage.kind}' foliage`);
		return [frondLeaf(record, manifest, detail, age)];
	},
};
