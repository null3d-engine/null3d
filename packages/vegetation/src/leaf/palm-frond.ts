// The pinnate frond's foliage, for a palm or a tree fern: a frond drawn as separate leaflets along
// its rachis, rather than one sheet cut from a picture of a whole blade. Each leaflet is a folded
// ribbon whose silhouette comes from the species' own leaf texture, so it reads as the picture
// shows it. The leaflets leave the rachis in small groups at several angles out of the frond's
// plane, so the frond reads bristly.
//
// A species' leaf picture holds one of two things, and the record's pinnae name which. A palm's
// holds one narrow blade: long, V-folded, with a fine point. A tree fern's holds a whole pinna
// with its lobes painted in. Each kind takes a style of its own below: how many leaflets stand at
// a place, how wide a ribbon is, where it samples its picture, and how a piece cut from a frond
// carries its leaflets.
//
// The rachis itself is the skeleton's rachis axis, which the wood mesher draws as thin wood. A
// frond's age browns its leaflets. Each vertex carries the wind record, a flutter phase that drifts
// along the frond and the crown's sky visibility, and its second coordinates hold the share along
// the frond and how brown it is.
import type { MeshArrays } from '../asset';
import { AXIS_RACHIS, AXIS_STEM } from '../core/graph';
import { cos, quatAxisAngle, quatRotate, radians, sin, tan, type Vector3 } from '../core/math';
import type { CrownRosette, FrondShape, LeafShape, PinnaSpec, Species } from '../core/record';
import { curveAt, spreadMean } from '../core/types';
import { crownSkyAt } from '../crown/visibility';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { type AxisPath, axisPath, emptyFrame, frameAt, type PathFrame } from '../wood/frames';

import { type LeafOutline, textureOutline } from './outline';
import { MeshWriter } from './writer';

/** Leaflet rows along its length, and columns across it, at the two levels past the nearest. */
const FAR_GRID: Readonly<Record<1 | 2, { readonly rows: number; readonly columns: number }>> = {
	1: { rows: 1, columns: 2 },
	2: { rows: 1, columns: 2 },
};
/** Columns across a leaflet at the nearest level. */
const NEAR_COLUMNS = 3;

/** Degrees that a group member's angle departs from its place's. */
const GROUP_ANGLE = 16;
/** The share of a frond's length that a group member stands along from its place's. */
const GROUP_STEP = 0.012;
/** Degrees the planes of a V-section frond fan to either side of the rachis's own upper face. */
const PLANE_FAN = 62;
/** The share of a leaflet's length and width that a spine keeps. */
const SPINE_LENGTH = 0.42;
const SPINE_WIDTH = 0.16;
/** Steps along a place's spacing, for the pinnae's own spacing curve. */
const PLACE_SAMPLES = 64;

/** How the frond draws one kind of leaflet. */
interface LeafletStyle {
	/** Rows along a leaflet at the nearest level. */
	readonly rows: number;
	/** The share of a frond's pinna places that each level draws. */
	readonly share: Readonly<Record<MeshLevel, number>>;
	/** The most leaflets that stand in one group at a rachis place. */
	readonly group: number;
	/**
	 * The ribbon's width past the nearest level, as a share of the texture's own leaflet width. A
	 * thin ribbon vanishes between the camera and the coarse levels, so a narrow blade is drawn
	 * wider there for the far crown's silhouette.
	 */
	readonly width: number;
	/** The ribbon's width at the nearest level, where a leaflet shows the picture's own proportion. */
	readonly closeWidth: number;
	/**
	 * How far from the picture's midrib toward its drawn edge the ribbon's columns sample it, from
	 * 0, the midrib alone, to 1, the edge. The ribbon's own columns stand on the leaflet's
	 * silhouette, where the picture's alpha runs out and a coarse mip averages it to nothing. A
	 * simple blade is solid along its midrib, so its colour comes from there and the ribbon's
	 * columns give the shape. A divided pinna's picture holds its lobes, so its columns sample
	 * across it, a little inside the edge.
	 */
	readonly sample: number;
	/**
	 * The share of a dead frond's places that a skirt drawn as a mass keeps. The skirt reads as a
	 * brown mass where its dried leaflets hang close; the coarsest level's share leaves the
	 * rachises bare, and the middle level's share costs more than the variant's bytes allow.
	 */
	readonly deadShare: number;
	/**
	 * A short piece cut from a frond, where the species' close photographs show one: metres
	 * between its pinna places, set denser than a whole frond's own count spreads them, and the
	 * share of the nearest level's ribbon width its blades keep, so they stand apart inside the
	 * piece's own box. A piece is its own small mesh, so it carries that density without the
	 * variant's bytes. Absent, a piece keeps the leaflets of the place on the frond it was cut
	 * from: the record's curves are read at the shares of the original axis the piece covers.
	 */
	readonly closeCut?: { readonly spacing: number; readonly width: number };
}

/** The style of each kind of leaflet a record's pinnae may name. */
const STYLES: Readonly<Record<NonNullable<PinnaSpec['leaflet']>, LeafletStyle>> = {
	pinna: {
		rows: 2,
		share: { 0: 1, 1: 0.34, 2: 0.14 },
		group: 2,
		width: 0.62,
		closeWidth: 0.62,
		sample: 0.8,
		deadShare: 0.14,
	},
	blade: {
		rows: 1,
		share: { 0: 1, 1: 0.3, 2: 0.1 },
		group: 1,
		width: 1.4,
		closeWidth: 0.9,
		sample: 0,
		deadShare: 1 / 7,
		closeCut: { spacing: 0.03, width: 0.6 },
	},
};

/** The record's crown-rosette growth, or a fault for another model. */
function crownOf(record: Species): CrownRosette {
	const growth = record.growth;
	if (growth.model !== 'crown-rosette')
		throw new Error(
			`@null3d/vegetation: the palm foliage got a '${growth.model}' record, not a crown rosette`,
		);
	return growth;
}

/** The crown-rosette frond's pinnate shape, or a fault for another kind of frond. */
function frondOf(growth: CrownRosette): FrondShape {
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
 * leaflets' own length, close at the tip where they are short. The spacing reads the curve where
 * the rachis stands on its original axis, so a span cut near a frond's tip carries the tip's
 * spacing rather than the whole frond's.
 */
function pinnaPlaces(pinnae: PinnaSpec, share: number, shareAt: (at: number) => number): number[] {
	const count = Math.max(1, Math.round(spreadMean(pinnae.count) * share));
	const weight: number[] = [0];
	for (let i = 0; i < PLACE_SAMPLES; i++) {
		const t = (i + 0.5) / PLACE_SAMPLES;
		weight.push((weight[i] as number) + 1 / (0.1 + curveAt(pinnae.length, shareAt(t))));
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
	pinnae: PinnaSpec,
	origin: number,
	places: readonly number[],
	petioleShare: number,
	pinnaShare: number,
	group: number,
	shareAt: (at: number) => number,
	closeBlade?: number,
): Leaflet[] {
	const out: Leaflet[] = [];
	const planes = Math.max(1, pinnae.planes);
	// A coarser level keeps every so many places along the whole frond, so its tip keeps leaflets.
	const stride = Math.max(1, Math.round(1 / pinnaShare));
	places.forEach((place, p) => {
		if (p % stride !== 0) return;
		if (place < petioleShare) return;
		const spine = p < Math.round((pinnae.spines ?? 0) / 2);
		// A close piece takes the species' own leaflet length, as the leaflet pictures show it;
		// the whole frond takes the frond's share of its length.
		const blade = closeBlade ?? curveAt(pinnae.length, shareAt(place)) * origin;
		for (let g = 0; g < group; g++) {
			const at = place + (g - (group - 1) / 2) * GROUP_STEP;
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

/**
 * What a leaflet's ribbon needs: the outline, the row and column grid, the fold, its width over
 * the texture leaflet's own, and how far from the midrib its columns sample the picture.
 */
interface RibbonShape {
	readonly outline: LeafOutline;
	readonly rows: number;
	readonly columns: number;
	readonly fold: number;
	readonly widthShare: number;
	readonly sample: number;
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
			const u = 0.5 + (uLow + (uHigh - uLow) * column - 0.5) * shape.sample;
			mesh.vertex(at, normalAt, [u, v], [second[0], second[1]], colour(at));
		}
	}
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns - 1; c++) {
			const a = first + r * columns + c;
			mesh.quad(a, a + 1, a + columns + 1, a + columns);
		}
}

/** Whether a skeleton carries a stem, so it is a whole plant rather than a cut piece. */
function hasStemAxis(skeleton: MeshInput['skeleton']): boolean {
	const { axes } = skeleton;
	for (let a = 0; a < axes.count; a++) if ((axes.kind[a] as number) === AXIS_STEM) return true;
	return false;
}

/** The frond's own browning, 0 green to 1 dead, from the age its bud carries. */
/** One frond of a variant, read from its skeleton: its rachis path, its age and its wind record. */
interface PalmFrond {
	readonly path: AxisPath;
	/**
	 * Metres of the path that run from the stem's own node out to the frond's base. A palm's rachis
	 * leaves the stem's axis, so the path's first sample stands on the stem rather than at the
	 * blade's base; the leaflets start past this lead.
	 */
	readonly lead: number;
	/** The share of the axis this piece was cut from where its first and last nodes stand. */
	readonly cutFrom: number;
	readonly cutTo: number;
	readonly age: number;
	readonly record: number;
	readonly phase: number;
}

/**
 * The fronds a palm variant carries: one at each bud site on a rachis axis, the rachis's path from
 * its junction with the stem through its nodes, the upper face where the bud's +Z points, and the
 * age the bud's vigor holds.
 */
function palmFronds(input: MeshInput): PalmFrond[] {
	const { axes, buds, position } = input.skeleton;
	const fronds: PalmFrond[] = [];
	const up: Vector3 = [0, 0, 0];
	for (let b = 0; b < buds.count; b++) {
		const axis = buds.axis[b] as number;
		if ((axes.kind[axis] as number) !== AXIS_RACHIS) continue;
		const first = axes.first[axis] as number;
		const last = axes.last[axis] as number;
		const pts: number[] = [];
		const radii: number[] = [];
		let lead = 0;
		const parentNode = axes.parentNode[axis] as number;
		if ((axes.parent[axis] as number) >= 0 && parentNode >= 0) {
			pts.push(
				position[parentNode * 3] as number,
				position[parentNode * 3 + 1] as number,
				position[parentNode * 3 + 2] as number,
			);
			radii.push(input.skeleton.radius[first] as number);
			const dx = (position[first * 3] as number) - (position[parentNode * 3] as number);
			const dy = (position[first * 3 + 1] as number) - (position[parentNode * 3 + 1] as number);
			const dz = (position[first * 3 + 2] as number) - (position[parentNode * 3 + 2] as number);
			lead = Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
		for (let n = first; n <= last; n++) {
			pts.push(
				position[n * 3] as number,
				position[n * 3 + 1] as number,
				position[n * 3 + 2] as number,
			);
			radii.push(input.skeleton.radius[n] as number);
		}
		if (radii.length < 2) continue;
		quatRotate(buds.frame, b * 4, [0, 0, 1], up);
		const path = axisPath(new Float64Array(pts), new Float64Array(radii), radii.length, up);
		fronds.push({
			path,
			lead,
			cutFrom: axes.cutFrom[axis] as number,
			cutTo: axes.cutTo[axis] as number,
			age: buds.vigor[b] as number,
			record: input.variant * VARIANT_RECORDS + (axes.record[axis] as number),
			phase: (axis * 97) & 255,
		});
	}
	return fronds;
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
	const growth = crownOf(input.record);
	const shape = frondOf(growth);
	const leaf = leafOf(input.record);
	const pinnae = shape.pinnae as PinnaSpec;
	const style = STYLES[pinnae.leaflet ?? 'pinna'];
	if (!input.kit.manifest.leaf)
		throw new Error('@null3d/vegetation: a palm frond needs the species leaf texture');
	const outline = textureOutline(input.kit.manifest.leaf);
	const ribbon: RibbonShape = {
		outline,
		rows: level === 0 ? style.rows : FAR_GRID[level].rows,
		columns: level === 0 ? NEAR_COLUMNS : FAR_GRID[level].columns,
		fold: leaf.fold,
		widthShare: level === 0 ? style.closeWidth : style.width,
		sample: style.sample,
	};
	// The dead ribbons keep the far width at every level, so the skirt stays a mass in a close view.
	const deadRibbon: RibbonShape = {
		...ribbon,
		rows: FAR_GRID[2].rows,
		columns: FAR_GRID[2].columns,
		widthShare: style.width,
	};
	// A close cut piece keeps the same rachis length and leaflet length as the picture, with
	// narrower blades, so its leaflets stand apart inside its own box.
	const cutRibbon: RibbonShape = {
		...ribbon,
		widthShare: ribbon.widthShare * (style.closeCut?.width ?? 1),
	};
	// A cut piece of a frond keeps the original's leaflets: the record's frond length gives their
	// size, and the piece's own run gives only how many of its places it carries. A whole plant's
	// frond is its own measure, so its leaflets follow the length it grew.
	const hasStem = hasStemAxis(input.skeleton);
	const recordFrond = spreadMean(shape.length) + shape.petiole.length;
	// A spanned piece may begin at the frond's bare petiole or past it. The bare share is the part
	// of that petiole the span carries, so a piece that starts at the base shows the bare stem and
	// one cut from the middle shows leaflets from its cut, as the two leaflet pictures do.
	const cutFrom = input.cutting?.from ?? 0;
	const spanned = !hasStem && input.cutting?.span !== undefined;
	const mesh = new MeshWriter();
	const base = input.variant * VARIANT_RECORDS;
	const frame: PathFrame = emptyFrame();
	const point: Vector3 = [0, 0, 0];
	const across: Vector3 = [0, 0, 0];
	const normal: Vector3 = [0, 0, 0];
	const q = [0, 0, 0, 1];
	for (const frond of palmFronds(input)) {
		// The frond's own run, past the lead that reaches out from the stem's axis to its base.
		const length = frond.path.length - frond.lead;
		if (length < 0.05) continue;
		// A dead frond usually hangs as a brown mass in the skirt, where its leaflets read as the
		// mass rather than as blades, so it takes the coarsest grid and the fewest places at every
		// level. A species whose dead skirt still shows its pinnae keeps the level's detail.
		const dead = frond.age > 0.99;
		const mass = dead && growth.crown.dead.blades !== true;
		const origin = hasStem ? length : Math.max(length, recordFrond);
		// A close cut piece takes its density from the picture's own leaflet spacing; a whole
		// frond, grown or cut, takes the frond's count.
		const closeCut = style.closeCut !== undefined && !hasStem && length < recordFrond * 0.5;
		const count =
			closeCut && style.closeCut
				? Math.max(1, Math.round(length / style.closeCut.spacing))
				: Math.max(1, Math.round(spreadMean(pinnae.count) * (length / origin)));
		// Where along the original axis this run stands: a whole frond covers the axis from 0 to 1,
		// and a cut piece covers the shares it was taken from. The record's curves are read there,
		// so a piece carries the pinnae of the place it came from. A species with a close cut of
		// its own reads the curves along the piece instead.
		const shareAt = (at: number): number =>
			style.closeCut
				? at
				: Math.max(0, Math.min(1, frond.cutFrom + at * (frond.cutTo - frond.cutFrom)));
		const places = pinnaPlaces({ ...pinnae, count }, 1, shareAt);
		const closeBlade = closeCut ? spreadMean(leaf.length) : undefined;
		// The bare stalk's share of the run. A species with a close cut measures it on the whole
		// frond, and a spanned piece of it carries only the part of the stalk its span covers.
		const petioleShare = !style.closeCut
			? Math.min(0.3, shape.petiole.length / Math.max(length, 1e-6))
			: spanned
				? Math.max(0, Math.min(1, (shape.petiole.length - cutFrom) / Math.max(length, 1e-6)))
				: Math.min(0.3, shape.petiole.length / Math.max(origin, 1e-6));
		const list = leafletsOf(
			pinnae,
			origin,
			places,
			petioleShare,
			mass ? style.deadShare : style.share[level],
			style.group,
			shareAt,
			closeBlade,
		);
		const frondRibbon = mass ? deadRibbon : closeCut ? cutRibbon : ribbon;
		const bytes: number[] = [0, 0, 0, 0];
		const record = base + frond.record;
		const brown = Math.max(0, Math.min(1, (frond.age - 0.5) * 2));
		for (const leaflet of list) {
			const share = Math.max(0, Math.min(1, leaflet.at));
			const along = frond.lead + share * length;
			frameAt(frond.path, along, frame);
			point[0] = frame.position[0] as number;
			point[1] = frame.position[1] as number;
			point[2] = frame.position[2] as number;
			// The leaflet leaves the rachis at its place's angle, on its own side.
			const angle = radians(curveAt(pinnae.angle, shareAt(leaflet.at)));
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
				curveAt(pinnae.droop, shareAt(leaflet.at)),
				(at) => {
					bytes[0] = record >> 8;
					bytes[1] = record & 255;
					bytes[2] = (frond.phase + Math.round(leaflet.at * 64)) & 255;
					const sky = crownSkyAt(input.crown, at[0] as number, at[1] as number, at[2] as number);
					bytes[3] = Math.round(255 * Math.max(0, Math.min(1, sky)));
					return bytes;
				},
				[share, brown],
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
