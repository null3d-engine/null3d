// The palm frond's foliage: a pinnate frond drawn as separate leaflets along its rachis, rather
// than one sheet cut from a picture of a whole blade. Each leaflet is a folded ribbon whose
// silhouette comes from the species' own leaf texture, so it reads as the picture shows it: long,
// narrow, V-folded, with a fine point. The leaflets leave the rachis in small groups at several
// angles out of the frond's plane, so the frond reads bristly.
//
// The rachis itself is the skeleton's rachis axis, which the wood mesher draws as thin wood. A
// frond's age browns its leaflets. Each vertex carries the wind record, a flutter phase that drifts
// along the frond and the crown's sky visibility, and its second coordinates hold the share along
// the frond and how brown it is.
import type { MeshArrays } from '../asset';
import { cos, quatAxisAngle, quatRotate, radians, sin, tan, type Vector3 } from '../core/math';
import type { FrondShape, LeafShape, PinnaSpec, Species } from '../core/record';
import { curveAt, spreadMean } from '../core/types';
import { crownSkyAt } from '../crown/visibility';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { emptyFrame, frameAt, type PathFrame } from '../wood/frames';
import { skeletonFronds } from './frond';
import { type LeafOutline, textureOutline } from './outline';
import { MeshWriter } from './writer';

/** Leaflet rows along its length, and columns across it, at each level. */
const GRID: Readonly<Record<MeshLevel, { readonly rows: number; readonly columns: number }>> = {
	0: { rows: 2, columns: 3 },
	1: { rows: 1, columns: 2 },
	2: { rows: 1, columns: 2 },
};

/** The share of a frond's pinna places that a level draws. */
const PINNA_SHARE: Readonly<Record<MeshLevel, number>> = { 0: 1, 1: 0.34, 2: 0.14 };

/** The most leaflets that stand in one group at a rachis place. */
const GROUP = 2;
/** Degrees that a group member's angle departs from its place's. */
const GROUP_ANGLE = 16;
/** The share of a frond's length that a group member stands along from its place's. */
const GROUP_STEP = 0.012;
/** The narrowest a leaflet ribbon is drawn, as a share of the texture's own leaflet width. */
const WIDTH_SHARE = 0.62;
/** Degrees the planes of a V-section frond fan to either side of the rachis's own upper face. */
const PLANE_FAN = 62;
/** The share of a leaflet's length and width that a spine keeps. */
const SPINE_LENGTH = 0.42;
const SPINE_WIDTH = 0.16;
/** Steps along a place's spacing, for the pinnae's own spacing curve. */
const PLACE_SAMPLES = 64;

/** The record's crown-rosette frond, or a fault for another model. */
function frondOf(record: Species): FrondShape {
	const growth = record.growth;
	if (growth.model !== 'crown-rosette')
		throw new Error(
			`@null3d/vegetation: the palm foliage got a '${growth.model}' record, not a crown rosette`,
		);
	if (growth.frond.kind !== 'pinnate' || !growth.frond.pinnae)
		throw new Error(
			`@null3d/vegetation: a palm frond is drawn from pinnate pinnae, not a '${growth.frond.kind}' frond`,
		);
	return growth.frond;
}

/** The leaflet's own shape, from the species' leaf. */
function leafOf(record: Species): LeafShape {
	if (record.foliage.kind !== 'blade')
		throw new Error(
			`@null3d/vegetation: a palm frond's leaflet is a 'blade', not '${record.foliage.kind}' foliage`,
		);
	return record.foliage.leaf;
}

/**
 * Where each leaflet pair leaves the rachis, as shares of its length: spaced in step with the
 * leaflets' own length, close at the tip where they are short.
 */
function pinnaPlaces(pinnae: PinnaSpec, share: number): number[] {
	const count = Math.max(1, Math.round(spreadMean(pinnae.count) * share));
	const weight: number[] = [0];
	for (let i = 0; i < PLACE_SAMPLES; i++) {
		const t = (i + 0.5) / PLACE_SAMPLES;
		weight.push((weight[i] as number) + 1 / (0.1 + curveAt(pinnae.length, t)));
	}
	const total = weight[PLACE_SAMPLES] as number;
	const places: number[] = [];
	for (let k = 0; k < count; k++) {
		const goal = (k / count) * total;
		let i = 0;
		while (i < PLACE_SAMPLES - 1 && (weight[i + 1] as number) < goal) i++;
		const low = weight[i] as number;
		const high = weight[i + 1] as number;
		places.push((i + (high > low ? (goal - low) / (high - low) : 0)) / PLACE_SAMPLES);
	}
	return places;
}

/** The left and right edges of a leaf outline at a texture row, as u. */
function edgesAt(outline: LeafOutline, v: number): [number, number] {
	const points = outline.points;
	const count = points.length / 2;
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const j = (i + 1) % count;
		const v0 = points[i * 2 + 1] as number;
		const v1 = points[j * 2 + 1] as number;
		if ((v < v0 && v < v1) || (v > v0 && v > v1)) continue;
		const u0 = points[i * 2] as number;
		const u1 = points[j * 2] as number;
		const t = Math.abs(v1 - v0) < 1e-9 ? 0 : (v - v0) / (v1 - v0);
		const u = u0 + (u1 - u0) * t;
		if (u < low) low = u;
		if (u > high) high = u;
	}
	if (!(Number.isFinite(low) && Number.isFinite(high))) return [0.4358, 0.5642];
	return [low, high];
}

/** One leaflet to draw: its place on the rachis, its side, its plane and its size. */
interface Leaflet {
	/** Share along the rachis, 0 at the rachis's base. */
	readonly at: number;
	/** Which side of the rachis, -1 left or 1 right. */
	readonly side: number;
	/** Degrees the leaflet's plane turns about its own length. */
	readonly plane: number;
	/** Its length in metres. */
	readonly length: number;
	/** Whether the record gives it as a spine rather than a blade. */
	readonly spine: boolean;
	/** Its width as a share of the texture leaflet's own. */
	readonly width: number;
}

/**
 * The leaflets of one frond: a group at each rachis place on both sides, their planes fanned so the
 * frond carries its bristles in several planes. The lowest places give spines in place of blades,
 * as a date palm's frond base does.
 */
function leafletsOf(
	shape: FrondShape,
	pinnae: PinnaSpec,
	length: number,
	level: MeshLevel,
	places: readonly number[],
): Leaflet[] {
	const out: Leaflet[] = [];
	const planes = Math.max(1, pinnae.planes);
	const petioleShare = Math.min(0.3, shape.petiole.length / Math.max(length, 1e-6));
	let drew = 0;
	places.forEach((place, p) => {
		if (drew >= Math.round(places.length * PINNA_SHARE[level])) return;
		if (place < petioleShare) return;
		drew++;
		const spine = p < Math.round((pinnae.spines ?? 0) / 2);
		const blade = curveAt(pinnae.length, place) * length;
		for (let g = 0; g < GROUP; g++) {
			const at = place + (g - (GROUP - 1) / 2) * GROUP_STEP;
			if (at < 0 || at > 1) continue;
			for (const side of [-1, 1] as const) {
				const k = (p + g + (side < 0 ? 1 : 0)) % planes;
				out.push({
					at,
					side,
					plane: radians(((k + 0.5) / planes - 0.5) * PLANE_FAN) + radians(GROUP_ANGLE * (g - 0.5)),
					length: blade * (spine ? SPINE_LENGTH : 1),
					spine,
					width: spine ? SPINE_WIDTH : 1,
				});
			}
		}
	});
	return out;
}

/** What a leaflet's ribbon needs: the outline, the row and column grid, and the fold. */
interface RibbonShape {
	readonly outline: LeafOutline;
	readonly rows: number;
	readonly columns: number;
	readonly fold: number;
	readonly widthShare: number;
}

/** Writes one leaflet's folded ribbon: rows along it, whose outer columns follow the texture. */
function writeLeaflet(
	mesh: MeshWriter,
	shape: RibbonShape,
	leaflet: Leaflet,
	base: Vector3,
	direction: Vector3,
	across: Vector3,
	normal: Vector3,
	droop: number,
	colour: (at: Vector3) => number[],
	second: readonly [number, number],
): void {
	const { outline, rows, columns, fold } = shape;
	const baseV = outline.base[1] as number;
	const tipV = outline.tip[1] as number;
	const vSpan = Math.max(1e-6, tipV - baseV);
	const length = leaflet.length;
	const first = mesh.vertices;
	const at: Vector3 = [0, 0, 0];
	const normalAt: Vector3 = [0, 0, 0];
	for (let r = 0; r <= rows; r++) {
		const s = r / rows;
		const v = baseV + vSpan * s;
		const [uLow, uHigh] = edgesAt(outline, v);
		// The texture is square, so one unit across is one unit along: the leaflet keeps the
		// picture's own proportions, narrowed by the crown's share.
		const half = ((uHigh - uLow) * (length / vSpan) * shape.widthShare * leaflet.width) / 2;
		const reach = length * s;
		// The leaflet droops away from its upper face as it runs out.
		const bend = radians(droop) * s * s;
		const drop = length * s * tan(bend);
		for (let c = 0; c < columns; c++) {
			const column = columns === 1 ? 0.5 : c / (columns - 1);
			const sideways = (column - 0.5) * 2 * half;
			const ridge = (1 - Math.abs(column - 0.5) * 2) * half * 0.5 * tan(radians(fold));
			at[0] =
				(base[0] as number) +
				direction[0] * reach +
				across[0] * sideways -
				normal[0] * drop +
				normal[0] * ridge;
			at[1] =
				(base[1] as number) +
				direction[1] * reach +
				across[1] * sideways -
				normal[1] * drop +
				normal[1] * ridge;
			at[2] =
				(base[2] as number) +
				direction[2] * reach +
				across[2] * sideways -
				normal[2] * drop +
				normal[2] * ridge;
			const tilt = (column - 0.5) * 2 * radians(fold);
			normalAt[0] = normal[0] * cos(tilt) + across[0] * sin(tilt);
			normalAt[1] = normal[1] * cos(tilt) + across[1] * sin(tilt);
			normalAt[2] = normal[2] * cos(tilt) + across[2] * sin(tilt);
			const u = uLow + (uHigh - uLow) * column;
			mesh.vertex(at, normalAt, [u, v], [second[0], second[1]], colour(at));
		}
	}
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns - 1; c++) {
			const a = first + r * columns + c;
			mesh.quad(a, a + 1, a + columns + 1, a + columns);
		}
}

/**
 * A palm plant's merged foliage at a level: every frond's leaflets along its rachis.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The leaflets' mesh.
 * @category api/vegetation
 */
export function palmFoliage(input: MeshInput, level: MeshLevel): MeshArrays {
	const shape = frondOf(input.record);
	const leaf = leafOf(input.record);
	const pinnae = shape.pinnae as PinnaSpec;
	if (!input.kit.manifest.leaf)
		throw new Error('@null3d/vegetation: a palm frond needs the species leaf texture');
	const outline = textureOutline(input.kit.manifest.leaf);
	const grid = GRID[level];
	const ribbon: RibbonShape = {
		outline,
		rows: grid.rows,
		columns: grid.columns,
		fold: leaf.fold,
		widthShare: WIDTH_SHARE,
	};
	const deadRibbon: RibbonShape = {
		...ribbon,
		rows: GRID[2].rows,
		columns: GRID[2].columns,
	};
	const places = pinnaPlaces(pinnae, 1);
	const mesh = new MeshWriter();
	const base = input.variant * VARIANT_RECORDS;
	const frame: PathFrame = emptyFrame();
	const point: Vector3 = [0, 0, 0];
	const across: Vector3 = [0, 0, 0];
	const normal: Vector3 = [0, 0, 0];
	const q = [0, 0, 0, 1];
	for (const frond of skeletonFronds(input.skeleton, input.variant)) {
		const length = frond.path.length;
		if (length < 0.05) continue;
		// A dead frond hangs as a brown mass in the skirt, where its leaflets read as the mass rather
		// than as blades: it takes the coarsest grid and the fewest places at every level.
		const dead = frond.age.brown > 0.9;
		const drawn = dead ? 2 : level;
		const list = leafletsOf(shape, pinnae, length, drawn, places);
		const frondRibbon = dead ? deadRibbon : ribbon;
		const bytes: number[] = [0, 0, 0, 0];
		const record = base + frond.record;
		const brown = Math.max(0, Math.min(1, frond.age.brown));
		for (const leaflet of list) {
			const along = Math.max(0, Math.min(1, leaflet.at)) * length;
			frameAt(frond.path, along, frame);
			point[0] = frame.position[0] as number;
			point[1] = frame.position[1] as number;
			point[2] = frame.position[2] as number;
			// The leaflet leaves the rachis at its place's angle, on its own side.
			const angle = radians(curveAt(pinnae.angle, leaflet.at));
			const side = leaflet.side;
			const outward: Vector3 = [
				(frame.tangent[0] as number) * cos(angle) +
					(frame.binormal[0] as number) * sin(angle) * side,
				(frame.tangent[1] as number) * cos(angle) +
					(frame.binormal[1] as number) * sin(angle) * side,
				(frame.tangent[2] as number) * cos(angle) +
					(frame.binormal[2] as number) * sin(angle) * side,
			];
			// Its plane turns about its own length, so the frond's bristles stand in several planes.
			const upper: Vector3 = [
				frame.normal[0] as number,
				frame.normal[1] as number,
				frame.normal[2] as number,
			];
			quatAxisAngle(outward, leaflet.plane, q);
			quatRotate(q, 0, upper, normal);
			across[0] = outward[1] * normal[2] - outward[2] * normal[1];
			across[1] = outward[2] * normal[0] - outward[0] * normal[2];
			across[2] = outward[0] * normal[1] - outward[1] * normal[0];
			square(outward, normal, across);
			writeLeaflet(
				mesh,
				frondRibbon,
				leaflet,
				point,
				outward,
				across,
				normal,
				curveAt(pinnae.droop, leaflet.at),
				(at) => {
					bytes[0] = record >> 8;
					bytes[1] = record & 255;
					bytes[2] = (frond.phase + Math.round(leaflet.at * 64)) & 255;
					const sky = crownSkyAt(input.crown, at[0] as number, at[1] as number, at[2] as number);
					bytes[3] = Math.round(255 * Math.max(0, Math.min(1, sky)));
					return bytes;
				},
				[leaflet.at, brown],
			);
		}
	}
	return mesh.finishMesh();
}

/** Normalizes a leaflet's line, its upper face and its across axis, each square to the others. */
function square(direction: Vector3, normal: Vector3, across: Vector3): void {
	normalize(direction);
	normalize(normal);
	across[0] = direction[1] * normal[2] - direction[2] * normal[1];
	across[1] = direction[2] * normal[0] - direction[0] * normal[2];
	across[2] = direction[0] * normal[1] - direction[1] * normal[0];
	normalize(across);
	normal[0] = across[1] * direction[2] - across[2] * direction[1];
	normal[1] = across[2] * direction[0] - across[0] * direction[2];
	normal[2] = across[0] * direction[1] - across[1] * direction[0];
}

/** Normalizes a vector in place. */
function normalize(vector: Vector3): void {
	const length = Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
	if (length < 1e-9) {
		vector[0] = 0;
		vector[1] = 1;
		vector[2] = 0;
		return;
	}
	vector[0] /= length;
	vector[1] /= length;
	vector[2] /= length;
}
