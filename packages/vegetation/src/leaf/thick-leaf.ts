// The thick foliage kind: hosta's broad leaf of deep relief. The blade's outline comes from the
// texture's measured contour or the record's parametric one, heart-shaped base and all: each half is
// a grid of rows up the blade and columns from its inner edge (the midrib, or the sinus beside the
// stalk below the blade's base) to its margin, so the grid follows the outline without cutting it.
//
// The relief follows the veins. A vein of rank u (0 the margin, 1 the midrib) leaves the midrib at
// `ribs.start · u` of the blade's length, sweeps out over `ribs.sweep · u` of it to its share of the
// half-width, 1 - u, and runs on to the tip, where every vein meets the others as the outline
// closes. Each vertex finds the rank of the vein through it, and the blade between two veins puffs
// up toward the upper face by `ribs.depth` of their spacing while the veins and the midrib stay sunk:
// the pleated ribs that give the plant its look, in the silhouette and the shading alike. Each half
// curves up into a cup, or rolls round the midrib in a young leaf; the margin waves.
//
// The blade lies along a midrib path that the grower bends (the turn at the stalk's top and the
// curl to the tip), its upper face toward the path's normal; below the blade's base the lobes run on
// along the path's first tangent. The stalk is a channelled crescent along its own path, wider where
// it sheathes the crown and where it opens into the blade.
import type { PrototypeArrays } from '../asset';
import { cos, radians, sin } from '../core/math';
import type { Species, ThickLeaf } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt, type Detail, spreadMean } from '../core/types';
import {
	type AxisBytes,
	leafStrip,
	skyByte,
	smoothNormals,
	smoothstep,
	stalkRange,
	writeStem,
} from '../grow/ground';
import type { CrownLight } from '../stages';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';
import type { FoliageBuilder } from './kinds';
import { type LeafOutline, parametricOutline, textureOutline } from './outline';
import { MeshWriter } from './writer';

/** Degrees each half of a rolled young leaf wraps round its midrib. */
const ROLLED_WRAP = 290;

/**
 * The least sky a leaf's stalk takes, from 0 to 1. A stalk stands under its own shoot's blades, so
 * the crown's sky there is low, and without a floor it draws as black wood among green leaves.
 */
export const STALK_LEAST_SKY = 0.22;
/** How far a lobe's veins run back into it, as a share of the way they run up the blade. */
const LOBE_VEINS = 0.6;

/** The outline of a thick leaf: the texture's contour, or the record's parametric one. */
export function thickOutline(leaf: ThickLeaf, manifest: TextureManifest): LeafOutline {
	if (leaf.outline === 'texture' && manifest.leaf) return textureOutline(manifest.leaf);
	if (leaf.outline === 'texture')
		return parametricOutline({ width: 0.38, tip: 'acuminate', base: 'cordate' });
	return parametricOutline(leaf.outline);
}

/** One half of an outline as rows: at each v, the inner edge and the margin, in u from the midrib. */
interface HalfRows {
	readonly v: Float64Array;
	readonly inner: Float64Array;
	readonly outer: Float64Array;
}

/** The u offsets from the midrib where a horizontal line at v crosses one half of the outline. */
function crossings(points: readonly number[], v: number, side: 1 | -1, out: number[]): void {
	out.length = 0;
	const n = points.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const u0 = ((points[i * 2] as number) - 0.5) * side;
		const v0 = points[i * 2 + 1] as number;
		const u1 = ((points[j * 2] as number) - 0.5) * side;
		const v1 = points[j * 2 + 1] as number;
		if ((v0 <= v && v1 > v) || (v1 <= v && v0 > v)) {
			const u = u0 + ((v - v0) / (v1 - v0)) * (u1 - u0);
			if (u > 0) out.push(u);
		}
	}
	out.sort((a, b) => a - b);
}

/** One half's rows from the outline's lowest point to its tip. */
function halfRows(outline: LeafOutline, side: 1 | -1, rows: number): HalfRows {
	const points = outline.points;
	let low = outline.base[1];
	for (let i = 0; i < points.length; i += 2) {
		const u = ((points[i] as number) - 0.5) * side;
		if (u > 0) low = Math.min(low, points[i + 1] as number);
	}
	const top = outline.tip[1];
	const v = new Float64Array(rows + 1);
	const inner = new Float64Array(rows + 1);
	const outer = new Float64Array(rows + 1);
	const found: number[] = [];
	for (let r = 0; r <= rows; r++) {
		// Rows crowd a little toward both ends, where the outline turns fastest.
		const s = r / rows;
		const eased = s - (0.06 * sin(2 * Math.PI * s)) / (2 * Math.PI);
		const at = low + (top - low) * eased;
		v[r] = at;
		crossings(points, Math.min(top - 1e-6, Math.max(low + 1e-6, at)), side, found);
		const last = found[found.length - 1] ?? 0;
		outer[r] = last;
		// Above the blade's base the half starts at the midrib; below it, at the sinus beside the stalk.
		inner[r] =
			at >= outline.base[1] ? 0 : found.length >= 2 ? (found[found.length - 2] as number) : last;
	}
	return { v, inner, outer };
}

/** A vein's share of the half-width at a height: 0 before it leaves the midrib, then sweeping out. */
function veinShare(rank: number, t: number, ribs: ThickLeaf['ribs']): number {
	if (rank <= 0) return 1;
	const run = (t - ribs.start * rank) / Math.max(1e-4, ribs.sweep * rank);
	if (run <= 0) return 0;
	const eased = run >= 1 ? 1 : run * (2 - run);
	return (1 - rank) * eased;
}

/** The rank of the vein through a point at a share of the half-width and a height up the blade. */
function veinRank(share: number, t: number, ribs: ThickLeaf['ribs']): number {
	let low = 0;
	let high = 1;
	for (let i = 0; i < 22; i++) {
		const mid = 0.5 * (low + high);
		if (veinShare(mid, t, ribs) > share) low = mid;
		else high = mid;
	}
	return 0.5 * (low + high);
}

/** One blade as written. */
export interface ThickBladeForm {
	/** The blade's length in metres, base to tip. */
	readonly length: number;
	/** The record's leaf. */
	readonly leaf: ThickLeaf;
	/** Its outline. */
	readonly outline: LeafOutline;
	/** 0 open; 1 rolled tight round the midrib, as a young leaf rises. */
	readonly roll: number;
	/** How far it has browned, 0 to 1. */
	readonly browning: number;
	/** The share along the whole leaf where the blade starts and where it ends, for the bend weight. */
	readonly along: readonly [number, number];
	/** A turn of the margin wave's phase, this leaf's own. */
	readonly wavePhase: number;
}

/** How finely a blade is written: rows up it, columns a half, and whether the ribs are geometry. */
export interface ThickDetail {
	readonly rows: number;
	readonly columns: number;
	readonly ribs: boolean;
}

/**
 * The blade's grid by tier: two columns a rib from medium up, so the pleats light, and at ultra
 * more rows than at high, so the blade's curl reads smoother while a plant of a hundred leaves
 * stays inside its class's nearest-level cap.
 */
export function thickDetail(leaf: ThickLeaf, detail: Detail): ThickDetail {
	const count = Math.max(1, leaf.ribs.count);
	switch (detail) {
		case 'low':
			return { rows: 8, columns: 5, ribs: false };
		case 'medium':
			return { rows: 14, columns: count * 2, ribs: true };
		case 'high':
			return { rows: 12, columns: count * 2, ribs: true };
		case 'ultra':
			return { rows: 20, columns: count * 2, ribs: true };
	}
}

/**
 * One half of a blade's grid in the outline's own units, the same for every leaf of a species at a
 * tier: each vertex's place across the half from the midrib, in u, its row's v, and the ribs' lift
 * per metre of leaf, so a leaf of any size scales it.
 */
interface HalfTemplate {
	readonly rows: number;
	readonly columns: number;
	readonly v: Float64Array;
	/** Per row: the share of the blade's length above its base, below 0 in the lobes. */
	readonly t: Float64Array;
	readonly across: Float64Array;
	readonly lift: Float64Array;
	/** The half's widest reach from the midrib, in u. */
	readonly widest: number;
}

/** The two halves' grids, by outline and tier, so a plant's leaves share them. */
const TEMPLATES = new WeakMap<LeafOutline, Map<string, readonly [HalfTemplate, HalfTemplate]>>();

/** One half's grid and its ribs' lift per metre of leaf. */
function halfTemplate(
	outline: LeafOutline,
	leaf: ThickLeaf,
	detail: ThickDetail,
	side: 1 | -1,
): HalfTemplate {
	const vBase = outline.base[1];
	const vTip = outline.tip[1];
	const ribs = leaf.ribs;
	const count = Math.max(1, ribs.count);
	const rows = detail.rows;
	const columns = Math.max(1, detail.columns);
	const half = halfRows(outline, side, rows);
	const t = new Float64Array(rows + 1);
	const across = new Float64Array((rows + 1) * (columns + 1));
	const lift = new Float64Array((rows + 1) * (columns + 1));
	let widest = 0;
	for (let r = 0; r <= rows; r++) {
		const inner = half.inner[r] as number;
		const outer = half.outer[r] as number;
		widest = Math.max(widest, outer);
		const tr = ((half.v[r] as number) - vBase) / Math.max(1e-6, vTip - vBase);
		t[r] = tr;
		// Below the base, the lobes' veins run back into them as they run up the blade above.
		const veinT = tr >= 0 ? tr : -LOBE_VEINS * tr;
		for (let c = 0; c <= columns; c++) {
			const at = r * (columns + 1) + c;
			const u = inner + (outer - inner) * (c / columns);
			across[at] = u;
			if (!detail.ribs || ribs.depth <= 0 || outer - inner < 1e-6) continue;
			const share = u / Math.max(1e-6, outer);
			const rank = veinRank(share, veinT, ribs);
			const pleat = 0.5 - 0.5 * cos(2 * Math.PI * rank * count);
			const step = 0.5 / count;
			const spacing =
				Math.abs(
					veinShare(Math.max(0, rank - step), veinT, ribs) -
						veinShare(Math.min(1, rank + step), veinT, ribs),
				) * outer;
			const fade =
				smoothstep(-0.05, 0.06, veinT) *
				(1 - smoothstep(0.82, 1, tr)) *
				(1 - 0.6 * smoothstep(0.85, 1, share));
			lift[at] = ribs.depth * spacing * pleat * fade;
		}
	}
	return { rows, columns, v: half.v, t, across, lift, widest };
}

/** The two halves' grids of an outline at a tier, built once. */
function templates(
	outline: LeafOutline,
	leaf: ThickLeaf,
	detail: ThickDetail,
): readonly [HalfTemplate, HalfTemplate] {
	let byDetail = TEMPLATES.get(outline);
	if (!byDetail) {
		byDetail = new Map();
		TEMPLATES.set(outline, byDetail);
	}
	const key = `${detail.rows}:${detail.columns}:${detail.ribs}:${JSON.stringify(leaf.ribs)}`;
	let pair = byDetail.get(key);
	if (!pair) {
		pair = [halfTemplate(outline, leaf, detail, 1), halfTemplate(outline, leaf, detail, -1)];
		byDetail.set(key, pair);
	}
	return pair;
}

const frame: PathFrame = emptyFrame();

/**
 * Writes one blade along its midrib path.
 *
 * @param mesh The writer.
 * @param path The midrib from the blade's base to its tip; the first frame's normal is the upper face.
 * @param form The blade.
 * @param detail Rows, columns and ribs.
 * @param bytes The axis's record and flutter bytes.
 * @param crown The crown's light, for each vertex's sky; none for the kit's leaf.
 */
export function writeThickBlade(
	mesh: MeshWriter,
	path: AxisPath,
	form: ThickBladeForm,
	detail: ThickDetail,
	bytes: AxisBytes,
	crown: CrownLight | undefined,
): void {
	const { outline, leaf } = form;
	const vBase = outline.base[1];
	// Metres of leaf per unit of the texture, along and across alike.
	const metres = form.length / Math.max(1e-6, outline.tip[1] - vBase);
	const cupAngle = radians(leaf.cup + (ROLLED_WRAP - leaf.cup) * form.roll);
	const [waveAmplitude, waves] = leaf.wave;
	const colour = [bytes.high, bytes.low, bytes.phase, 255];
	const p = [0, 0, 0];
	const pair = templates(outline, leaf, detail);
	for (const side of [1, -1] as const) {
		const half = side > 0 ? pair[0] : pair[1];
		const { rows, columns } = half;
		const curvature = cupAngle / Math.max(1e-6, half.widest * metres);
		const firstVertex = mesh.vertices;
		const firstIndex = mesh.indices.length;
		for (let r = 0; r <= rows; r++) {
			const v = half.v[r] as number;
			const t = half.t[r] as number;
			frameAt(path, (v - vBase) * metres, frame);
			const wave = waveAmplitude * sin(2 * Math.PI * (waves * t + form.wavePhase));
			const along = form.along[0] + (form.along[1] - form.along[0]) * Math.max(0, t);
			for (let c = 0; c <= columns; c++) {
				const at = r * (columns + 1) + c;
				const across = half.across[at] as number;
				const a = c / columns;
				const x = across * metres;
				const lift = (half.lift[at] as number) * metres + wave * a * a;
				// The half bends up on an arc of the cup's curvature; the lift stands square to the arc.
				const angle = curvature * x;
				const ca = cos(angle);
				const sa = sin(angle);
				const bx = curvature > 1e-9 ? sa / curvature : x;
				const bz = curvature > 1e-9 ? (1 - ca) / curvature : 0;
				const ox = side * (bx - sa * lift);
				const oz = bz + ca * lift;
				for (let k = 0; k < 3; k++)
					p[k] =
						(frame.position[k] as number) +
						(frame.binormal[k] as number) * ox +
						(frame.normal[k] as number) * oz;
				if (crown) colour[3] = skyByte(crown, p);
				mesh.vertex(
					p,
					[frame.normal[0] as number, frame.normal[1] as number, frame.normal[2] as number],
					[0.5 + side * across, v],
					[along, form.browning],
					colour,
				);
			}
			if (r > 0) {
				const a0 = firstVertex + (r - 1) * (columns + 1);
				const b0 = firstVertex + r * (columns + 1);
				for (let c = 0; c < columns; c++) {
					// Columns run outward on both halves, so the left half winds the other way round.
					if (side > 0) mesh.quad(a0 + c, a0 + c + 1, b0 + c + 1, b0 + c);
					else mesh.quad(a0 + c, b0 + c, b0 + c + 1, a0 + c + 1);
				}
			}
		}
		smoothNormals(mesh, firstVertex, firstIndex);
	}
}

/** A stalk to write: its path, its run, its radius where it meets the blade, its bytes. */
export interface StalkForm {
	readonly path: AxisPath;
	/** Arc lengths where it leaves the crown and where it meets the blade. */
	readonly from: number;
	readonly to: number;
	/** Its radius in metres where it meets the blade. */
	readonly radius: number;
	/** The share of the radius its groove sinks. */
	readonly channel: number;
	/** The share along the whole leaf where the blade starts. */
	readonly bladeStart: number;
	readonly browning: number;
}

/** Faces round a stalk and rings along it, by tier. */
export function stalkDetail(detail: Detail): { readonly sides: number; readonly rings: number } {
	switch (detail) {
		case 'low':
			return { sides: 4, rings: 4 };
		case 'medium':
			return { sides: 6, rings: 7 };
		case 'high':
			return { sides: 8, rings: 10 };
		case 'ultra':
			return { sides: 10, rings: 14 };
	}
}

/**
 * Writes a leaf's stalk: a crescent with its groove on the upper side, wider where it sheathes the
 * crown and where it opens into the blade, on the texture's stalk strip.
 *
 * @param mesh The writer.
 * @param stalk The stalk.
 * @param resolution Faces round and rings along.
 * @param manifest The texture manifest.
 * @param bytes The axis's record and flutter bytes.
 * @param crown The crown's light.
 */
export function writeStalk(
	mesh: MeshWriter,
	stalk: StalkForm,
	resolution: { readonly sides: number; readonly rings: number },
	manifest: TextureManifest,
	bytes: AxisBytes,
	crown: CrownLight,
): void {
	const channel = Math.min(0.9, Math.max(0, stalk.channel));
	writeStem(mesh, {
		path: stalk.path,
		from: stalk.from,
		to: stalk.to,
		rings: resolution.rings,
		radius: (share) =>
			stalk.radius * (1 + 0.7 * (1 - smoothstep(0, 0.12, share)) + 0.5 * smoothstep(0.9, 1, share)),
		section: {
			sides: resolution.sides,
			// Wider than deep, with a groove along the top (angle 0) and a rounded keel below.
			shape: (angle) => {
				const up = cos(angle);
				const groove = up > 0 ? channel * (up * up) * (up * up) : 0;
				return (1 + 0.25 * sin(angle) ** 2) * (1 - groove);
			},
		},
		v: stalkRange(leafStrip(manifest)),
		uHalf: leafStrip(manifest).stalkHalf,
		bytes,
		crown,
		along: [0, stalk.bladeStart],
		browning: stalk.browning,
		leastSky: STALK_LEAST_SKY,
	});
}

/**
 * The midrib path of a blade from its base, in a frame whose +Y is the blade's first direction and
 * +Z its upper face: curling down toward the lower face by `curl` degrees, more toward the tip.
 *
 * @param length The blade's length in metres.
 * @param curl Degrees the tip curls.
 * @param count Points.
 * @returns The points, 3 a point.
 */
export function midribPoints(length: number, curl: number, count: number): Float64Array {
	const points = new Float64Array(count * 3);
	let y = 0;
	let z = 0;
	const step = length / (count - 1);
	for (let i = 1; i < count; i++) {
		const s = (i - 0.5) / (count - 1);
		const angle = radians(curl) * s * s;
		y += cos(angle) * step;
		z -= sin(angle) * step;
		points[i * 3 + 1] = y;
		points[i * 3 + 2] = z;
	}
	return points;
}

/** The thick foliage kind's leaf builder: one open leaf of the record's mean size per tier. */
export const builder: FoliageBuilder = {
	leaves(record: Species, manifest: TextureManifest, detail: Detail): readonly PrototypeArrays[] {
		if (record.foliage.kind !== 'thick') return [];
		const leaf = record.foliage.leaf;
		const length = spreadMean(leaf.length);
		const growth = record.growth;
		const stalkLength = growth.model === 'rosette' ? curveAt(growth.stalk, 0.5) : 0.5 * length;
		const mesh = new MeshWriter();
		const bladeStart = stalkLength / (stalkLength + length);
		const zero: AxisBytes = { high: 0, low: 0, phase: 0 };
		const flat: CrownLight = {
			cells: [1, 1, 1],
			min: [-9, -9, -9],
			cell: 99,
			sky: new Float32Array([1]),
		};
		const stalkPoints = new Float64Array([0, 0, 0, 0, stalkLength * 0.5, 0, 0, stalkLength, 0]);
		writeStalk(
			mesh,
			{
				path: axisPath(stalkPoints, new Float64Array(3), 3, [0, 0, 1]),
				from: 0,
				to: stalkLength,
				radius: leaf.stalk.radius,
				channel: leaf.stalk.channel,
				bladeStart,
				browning: 0,
			},
			stalkDetail(detail),
			manifest,
			zero,
			flat,
		);
		const midrib = midribPoints(length, leaf.curl, 8);
		for (let i = 0; i < 8; i++) midrib[i * 3 + 1] = (midrib[i * 3 + 1] as number) + stalkLength;
		writeThickBlade(
			mesh,
			axisPath(midrib, new Float64Array(8), 8, [0, 0, 1]),
			{
				length,
				leaf,
				outline: thickOutline(leaf, manifest),
				roll: 0,
				browning: 0,
				along: [bladeStart, 1],
				wavePhase: 0,
			},
			thickDetail(leaf, detail),
			zero,
			undefined,
		);
		return [mesh.finishPrototype()];
	},
};
