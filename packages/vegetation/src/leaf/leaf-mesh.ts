// The blade foliage kind: a leaf mesh fitted to the texture's measured contour, or to a parametric
// outline where a species has no texture leaf. The outline is smoothed through its points, pushed
// out by three texels so the alpha test, not the geometry, cuts the margin's teeth and sinuses,
// simplified per tier without cutting into the blade, triangulated, and cut by rows along the
// midrib and columns across it. Each point then maps through the leaf's shape in space
// (`surface.ts`), so a folded leaf shades as two planes. A stalk tube runs from the attach point to
// the blade. A compound leaf places the same blade as its leaflets (`compound.ts`).
//
// Leaf space: the stalk's end at the origin, the midrib up +Y, the upper face toward +Z. One mesh
// carries both faces: the material is two-sided, and a back face samples the lower-face layer at
// the same texture coordinates.
import type { PrototypeArrays } from '../asset';
import { cos, sin } from '../core/math';
import type { LeafShape, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { DETAILS, type Detail, spreadMean } from '../core/types';
import { WOOD_RADIUS_RANGE } from '../wood/wood-mesh';
import { compoundLeaf } from './compound';
import type { FoliageBuilder } from './kinds';
import {
	type LeafOutline,
	offsetPolygon,
	parametricOutline,
	simplifyCovering,
	smoothPolygon,
	splitPolygon,
	textureOutline,
	triangulate,
} from './outline';
import { LeafSurface } from './surface';
import { MeshWriter, SURFACE_LEAF, SURFACE_PETIOLE } from './writer';

/**
 * How finely a leaf's outline is cut into triangles: bands along the midrib, bands across each half,
 * and the outline's smoothing and points.
 *
 * @category api/vegetation
 */
export interface LeafCut {
	/** Bands along the midrib. */
	readonly rows: number;
	/** Bands across each half. */
	readonly columns: number;
	/** Samples per outline edge before simplifying. */
	readonly smooth: number;
	/** Outline points kept. */
	readonly points: number;
}

/** How finely each tier meshes a leaf. */
export interface LeafTier extends LeafCut {
	/** Sides of the stalk tube; 0 draws a two-triangle ribbon, and -1 no stalk. */
	readonly stalkSides: number;
	/**
	 * Whether the leaf is one cut-out card: two triangles over the outline's bounds, whose texture's
	 * coverage draws the outline. The low tier draws leaves a few pixels long, where a stalk is
	 * smaller than a pixel and a cut-out edge is as sharp as a meshed one.
	 */
	readonly card?: boolean;
	/**
	 * Whether a card is split along its midrib into two planes, four triangles, so it keeps the leaf's
	 * fold: seen edge on, it shows the V of its two halves where a flat card shows a line.
	 */
	readonly folded?: boolean;
}

/**
 * The tiers' leaf meshes: rows, columns per half and outline points rise with the tier; the low
 * tier's leaf is a cut-out card.
 */
const TIERS: Readonly<Record<Detail, LeafTier>> = {
	low: { rows: 1, columns: 1, smooth: 1, points: 12, stalkSides: -1, card: true },
	medium: { rows: 3, columns: 1, smooth: 2, points: 24, stalkSides: 0 },
	high: { rows: 6, columns: 2, smooth: 3, points: 48, stalkSides: 3 },
	ultra: { rows: 12, columns: 4, smooth: 3, points: 96, stalkSides: 3 },
};

/**
 * The tiers' leaf meshes on a branch piece. A tree carries thousands of pieces, so its leaves are
 * cut-out cards below the finest tier: flat cards of two triangles at the low and medium tiers, and
 * cards folded along the midrib at the high tier, which keep a piece's depth seen edge on. At the
 * medium and high tiers a card draws a one-quad ribbon stalk where the leaf's stalk runs past the
 * texture's own. The ultra tier keeps the meshed outline.
 */
const PIECE_TIERS: Readonly<Record<Detail, LeafTier>> = {
	low: TIERS.low,
	medium: { ...TIERS.low, stalkSides: 0 },
	high: { ...TIERS.low, stalkSides: 0, folded: true },
	ultra: TIERS.ultra,
};

/** Texels the mesh's outline stands outside the measured contour. */
const MARGIN_TEXELS = 3;

/** Colour bytes of a leaf vertex before a shoot places it: no bend, no phase, leaf, unoccluded. */
const LEAF_COLOUR = [0, 0, SURFACE_LEAF, 255] as const;

/**
 * A leaf's outline: the texture's measured contour, or the record's parametric one.
 *
 * @param shape The record's leaf.
 * @param manifest The species' texture manifest.
 * @returns The outline.
 * @category api/vegetation
 */
export function outlineOf(shape: LeafShape, manifest: TextureManifest): LeafOutline {
	if (shape.outline !== 'texture') return parametricOutline(shape.outline);
	if (!manifest.leaf)
		throw new Error(
			`@null3d/vegetation: the leaf outline is 'texture', but the manifest of '${manifest.species}' has no leaf`,
		);
	return textureOutline(manifest.leaf);
}

/** Swaps each point's u and v, which mirrors the polygon and turns its winding round. */
function swapped(points: readonly number[]): number[] {
	const out: number[] = [];
	for (let i = 0; i < points.length; i += 2) out.push(points[i + 1] as number, points[i] as number);
	return out;
}

/**
 * A polygon split by the line v = `at` across the leaf: the split along a line of u, on the
 * polygon with u and v swapped, and swapped back, which restores its winding.
 */
function splitAcross(points: readonly number[], at: number): number[][] {
	return splitPolygon(swapped(points), at, []).map(swapped);
}

/**
 * The flat leaf's triangles in texture coordinates at one tier: the outline smoothed, pushed out by
 * the margin, simplified without cutting into the blade, split along the midrib and along columns
 * across each half with points at each row, and each piece triangulated. Points that pieces share
 * are one point.
 *
 * @param outline The leaf's outline.
 * @param detail The tier.
 * @param tier How the tier cuts a leaf; the crown's own cut by default.
 * @returns The points, u then v, and the triangles, three indices each.
 * @category api/vegetation
 */
export function leafTriangles(
	outline: LeafOutline,
	detail: Detail,
	tier: LeafTier = TIERS[detail],
): { readonly points: number[]; readonly triangles: number[] } {
	return tier.card ? cardLeaf(outline, tier.folded === true) : cutLeaf(outline, tier);
}

/**
 * A leaf as one cut-out card over the bounds of its outline, pushed out by the margin, from the
 * stalk's foot to the tip, so the texture's coverage draws the whole leaf: two triangles, or four
 * with the card split along its midrib.
 *
 * @param outline The leaf's outline.
 * @param folded Whether the card is split along its midrib.
 * @returns The points, u then v, and the triangles.
 */
function cardLeaf(
	outline: LeafOutline,
	folded: boolean,
): {
	readonly points: number[];
	readonly triangles: number[];
} {
	const margin = MARGIN_TEXELS / outline.texels;
	let low = outline.petiole[1];
	let high = outline.tip[1];
	let left = 0.5;
	let right = 0.5;
	for (let i = 0; i < outline.points.length; i += 2) {
		const u = outline.points[i] as number;
		const v = outline.points[i + 1] as number;
		left = Math.min(left, u);
		right = Math.max(right, u);
		low = Math.min(low, v);
		high = Math.max(high, v);
	}
	left = Math.max(0, left - margin);
	right = Math.min(1, right + margin);
	low = Math.max(0, low - margin);
	high = Math.min(1, high + margin);
	if (folded)
		return {
			points: [left, low, 0.5, low, right, low, right, high, 0.5, high, left, high],
			triangles: [0, 1, 4, 0, 4, 5, 1, 2, 3, 1, 3, 4],
		};
	return {
		points: [left, low, right, low, right, high, left, high],
		triangles: [0, 1, 2, 0, 2, 3],
	};
}

/**
 * The flat leaf's triangles in texture coordinates, cut as finely as asked: `leafTriangles` with
 * the bands and outline points given rather than a tier's.
 *
 * @param outline The leaf's outline.
 * @param tier The bands and outline points.
 * @returns The points, u then v, and the triangles, three indices each.
 * @category api/vegetation
 */
export function cutLeaf(
	outline: LeafOutline,
	tier: LeafCut,
): { readonly points: number[]; readonly triangles: number[] } {
	const margin = MARGIN_TEXELS / outline.texels;
	const polygon = simplifyCovering(
		offsetPolygon(smoothPolygon(outline.points, tier.smooth), margin),
		tier.points,
	);
	const { base, tip } = outline;
	// Bands across the leaf first, from the blade's base up, then the midrib and the columns: each
	// crossing of two cuts is made once, on the band's edge, so the cells round it share it exactly.
	let pieces = [polygon];
	for (let r = 0; r < tier.rows; r++) {
		const at = base[1] + ((tip[1] - base[1]) * r) / tier.rows;
		pieces = pieces.flatMap((piece) => splitAcross(piece, at));
	}
	let half = 0;
	for (let i = 0; i < polygon.length; i += 2)
		half = Math.max(half, Math.abs((polygon[i] as number) - 0.5));
	pieces = pieces.flatMap((piece) => splitPolygon(piece, 0.5, []));
	for (let c = 1; c < tier.columns; c++)
		for (const sign of [1, -1])
			pieces = pieces.flatMap((piece) =>
				splitPolygon(piece, 0.5 + (sign * half * c) / tier.columns, []),
			);
	const points: number[] = [];
	const triangles: number[] = [];
	const known = new Map<string, number>();
	for (const piece of pieces) {
		const local: number[] = [];
		for (let i = 0; i < piece.length; i += 2) {
			const u = piece[i] as number;
			const v = piece[i + 1] as number;
			const key = `${u}:${v}`;
			let index = known.get(key);
			if (index === undefined) {
				index = points.length / 2;
				points.push(u, v);
				known.set(key, index);
			}
			local.push(index);
		}
		for (const corner of triangulate(piece)) triangles.push(local[corner] as number);
	}
	return { points, triangles };
}

/**
 * One blade leaf mesh in leaf space at one tier.
 *
 * @param shape The record's leaf.
 * @param outline The leaf's outline.
 * @param detail The tier.
 * @param length The blade's length in metres; the record's mean by default.
 * @param tier How the tier cuts the leaf; the crown's own cut by default.
 * @returns The mesh.
 * @category api/vegetation
 */
export function bladeMesh(
	shape: LeafShape,
	outline: LeafOutline,
	detail: Detail,
	length = spreadMean(shape.length),
	tier: LeafTier = TIERS[detail],
): PrototypeArrays {
	const surface = new LeafSurface(shape, outline, length);
	const { points, triangles } = leafTriangles(outline, detail, tier);
	const mesh = new MeshWriter();
	const made = new Map<number, number>();
	const p = [0, 0, 0];
	const n = [0, 0, 0];
	const creased = shape.fold !== 0;
	for (let t = 0; t < triangles.length; t += 3) {
		const i0 = triangles[t] as number;
		const i1 = triangles[t + 1] as number;
		const i2 = triangles[t + 2] as number;
		const u0 = points[i0 * 2] as number;
		const v0 = points[i0 * 2 + 1] as number;
		const twice =
			((points[i1 * 2] as number) - u0) * ((points[i2 * 2 + 1] as number) - v0) -
			((points[i1 * 2 + 1] as number) - v0) * ((points[i2 * 2] as number) - u0);
		if (twice <= 1e-14) continue;
		const centre = (u0 + (points[i1 * 2] as number) + (points[i2 * 2] as number)) / 3;
		const side = centre < 0.5 ? -1 : 1;
		for (const index of [i0, i1, i2]) {
			const u = points[index * 2] as number;
			const v = points[index * 2 + 1] as number;
			// A vertex on a folded midrib is made once per side, so each half keeps its own normal.
			const onMidrib = creased && Math.abs(u - 0.5) < 1e-12;
			const key = onMidrib ? index * 3 + side + 1 : index * 3 + 1;
			let vertex = made.get(key);
			if (vertex === undefined) {
				const x = (u - 0.5) * surface.across;
				const along = surface.extra + (v - outline.petiole[1]) * surface.scale;
				surface.place(x, along, p);
				surface.normal(x, along, onMidrib ? side : 0, n);
				vertex = mesh.vertex(p, n, [u, v], [along, x], LEAF_COLOUR);
				made.set(key, vertex);
			}
			mesh.indices.push(vertex);
		}
	}
	// A card's texture draws the stalk it holds, so a card adds one, of one run, only where the stalk
	// runs past it.
	const stalkSides = tier.card && surface.extra <= 0 ? -1 : tier.stalkSides;
	if (stalkSides >= 0) addStalk(mesh, surface, shape, outline, stalkSides, tier.card ? 1 : 2);
	addSori(mesh, surface, shape, outline, length);
	return mesh.finishPrototype();
}

/** Sides of one sorus's disc. */
const SORUS_SIDES = 8;

/**
 * The sori: small discs standing proud of the leaf's under face. Each takes its colour from the
 * spot of the texture the record names, so the photograph's own spore cases are what is drawn; the
 * disc's under-facing normal samples the leaf's lower face, and the material is two-sided.
 */
function addSori(
	mesh: MeshWriter,
	surface: LeafSurface,
	shape: LeafShape,
	outline: LeafOutline,
	length: number,
): void {
	const sori = shape.sori;
	if (!sori || sori.count <= 0 || sori.size <= 0) return;
	const baseV = outline.base[1] as number;
	const tipV = outline.tip[1] as number;
	const centre = [0, 0, 0];
	const normal = [0, 0, 0];
	const along = [0, 0, 0];
	const across = [0, 0, 0];
	for (let i = 0; i < sori.count; i++) {
		const share = (i + 1) / (sori.count + 1);
		const t = surface.extra + share * length;
		surface.place(0, t, centre);
		surface.normal(0, t, 0, normal);
		surface.tangent(t, along);
		// Across the blade, square to its length and its normal.
		across[0] =
			(along[1] as number) * (normal[2] as number) - (along[2] as number) * (normal[1] as number);
		across[1] =
			(along[2] as number) * (normal[0] as number) - (along[0] as number) * (normal[2] as number);
		across[2] =
			(along[0] as number) * (normal[1] as number) - (along[1] as number) * (normal[0] as number);
		// The disc stands under the blade, its face turned away from the leaf.
		const lift = sori.size * 0.4;
		const hub = mesh.vertex(
			[
				(centre[0] as number) - (normal[0] as number) * lift,
				(centre[1] as number) - (normal[1] as number) * lift,
				(centre[2] as number) - (normal[2] as number) * lift,
			],
			[-(normal[0] as number), -(normal[1] as number), -(normal[2] as number)],
			sori.at,
			[baseV + (tipV - baseV) * share, 0],
			LEAF_COLOUR,
		);
		const first = mesh.vertices;
		for (let k = 0; k <= SORUS_SIDES; k++) {
			const angle = (2 * Math.PI * k) / SORUS_SIDES;
			const dx = cos(angle) * sori.size;
			const dy = sin(angle) * sori.size;
			mesh.vertex(
				[
					(centre[0] as number) -
						(normal[0] as number) * lift +
						(along[0] as number) * dx +
						(across[0] as number) * dy,
					(centre[1] as number) -
						(normal[1] as number) * lift +
						(along[1] as number) * dx +
						(across[1] as number) * dy,
					(centre[2] as number) -
						(normal[2] as number) * lift +
						(along[2] as number) * dx +
						(across[2] as number) * dy,
				],
				[-(normal[0] as number), -(normal[1] as number), -(normal[2] as number)],
				sori.at,
				[baseV + (tipV - baseV) * share, 0],
				LEAF_COLOUR,
			);
		}
		for (let k = 0; k < SORUS_SIDES; k++) mesh.indices.push(hub, first + k, first + k + 1);
	}
}

/**
 * The stalk: a tube of a few sides, or a ribbon, from the attach point to the blade's base, in two
 * runs that follow its droop, or in one.
 */
function addStalk(
	mesh: MeshWriter,
	surface: LeafSurface,
	shape: LeafShape,
	outline: LeafOutline,
	sides: number,
	runs: number,
): void {
	const radius = shape.petiole.radius;
	if (radius <= 0 || surface.stalk <= 0) return;
	const rings = runs + 1;
	// A flat stalk is wider along the blade's normal than across the blade.
	const flat = shape.petiole.flat;
	const across = radius * (1 - 0.6 * flat);
	const normalWise = radius * (1 + 0.6 * flat);
	const stalkU = Math.max(radius / surface.across, 0.5 / outline.texels);
	const centre = [0, 0, 0];
	const tangent = [0, 0, 0];
	const count = sides > 0 ? sides + 1 : 2;
	const first = mesh.vertices;
	for (let r = 0; r < rings; r++) {
		const t = (surface.stalk * r) / (rings - 1);
		surface.place(0, t, centre);
		surface.tangent(t, tangent);
		// The leaf's normal at the midline, square to its tangent in the y-z plane.
		const ny = -(tangent[2] as number);
		const nz = tangent[1] as number;
		const v = Math.max(
			outline.petiole[1],
			outline.petiole[1] + (t - surface.extra) / surface.scale,
		);
		for (let k = 0; k < count; k++) {
			let ox: number;
			let on: number;
			let normal: number[];
			if (sides > 0) {
				const angle = (2 * Math.PI * k) / sides;
				ox = cos(angle) * across;
				on = sin(angle) * normalWise;
				normal = [cos(angle), sin(angle) * ny, sin(angle) * nz];
			} else if (flat >= 0.5) {
				// A flat stalk's ribbon stands across the blade.
				ox = 0;
				on = (k === 0 ? -1 : 1) * normalWise;
				normal = [1, 0, 0];
			} else {
				ox = (k === 0 ? -1 : 1) * across;
				on = 0;
				normal = [0, ny, nz];
			}
			const u = 0.5 + (sides > 0 ? cos((2 * Math.PI * k) / sides) : k === 0 ? -1 : 1) * stalkU;
			mesh.vertex(
				[
					(centre[0] as number) + ox,
					(centre[1] as number) + on * ny,
					(centre[2] as number) + on * nz,
				],
				normal,
				[u, v],
				// The petiole's radius in the wood's units, so the shader widens a stalk thinner than
				// the least drawn width, as it widens the wood and the shoot stems.
				[Math.min(1, radius / WOOD_RADIUS_RANGE), 0],
				[0, 0, SURFACE_PETIOLE, 255],
			);
		}
	}
	const quads = sides > 0 ? sides : 1;
	for (let r = 0; r < rings - 1; r++)
		for (let k = 0; k < quads; k++) {
			const a = first + r * count + k;
			mesh.quad(a, a + 1, a + count + 1, a + count);
		}
}

/** The blade foliage kind's leaf builder: one leaf, or one compound leaf, per tier. */
/** An outline whose drawn stalk takes a share of its own run, the blade's base moved up to meet it. */
function shortenedStalk(outline: LeafOutline, share: number): LeafOutline {
	const drawn = outline.base[1] - outline.petiole[1];
	return { ...outline, petiole: [outline.petiole[0], outline.base[1] - drawn * share] };
}

/**
 * A blade species' leaf meshes at one tier: one leaf, or one compound leaf, each leaf or leaflet cut
 * as the tier table says.
 */
function bladeLeaves(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	tiers: Readonly<Record<Detail, LeafTier>>,
): readonly PrototypeArrays[] {
	const foliage = record.foliage;
	if (foliage.kind !== 'blade')
		throw new Error(`@null3d/vegetation: the blade builder got '${foliage.kind}' foliage`);
	const outline = outlineOf(foliage.leaf, manifest);
	if (!foliage.compound)
		return [bladeMesh(foliage.leaf, outline, detail, undefined, tiers[detail])];
	// A leaflet is a fraction of the leaf's size, so it takes a coarser cut unless the record asks
	// for the leaf's own. A tier that draws its leaves as cards draws its leaflets as cards too, and
	// any other takes the crown's meshed cut at the coarser tier.
	const step = Math.max(0, Math.min(2, Math.round(foliage.compound.leafletStep ?? 1)));
	const leafletDetail = DETAILS[Math.max(0, DETAILS.indexOf(detail) - step)] ?? detail;
	const leafletTier = tiers[detail].card ? tiers[detail] : TIERS[leafletDetail];
	// Each leaflet keeps a short stalk of its own and no droop: the rachis carries the droop. A
	// record may shorten that stalk, and at nothing the blade begins where the leaflet meets the
	// rachis, so no stalk texels stand between the two.
	const stalk = Math.min(1, Math.max(0, foliage.compound.leafletStalk ?? 1));
	const leaflet = bladeMesh(
		{
			...foliage.leaf,
			petiole: {
				...foliage.leaf.petiole,
				length: foliage.leaf.petiole.length * 0.12 * stalk,
				droop: 0,
			},
		},
		stalk === 1 ? outline : shortenedStalk(outline, stalk),
		leafletDetail,
		undefined,
		leafletTier,
	);
	return [compoundLeaf(foliage.leaf, foliage.compound, outline, leaflet, detail)];
}

export const builder: FoliageBuilder = {
	leaves: (record, manifest, detail) => bladeLeaves(record, manifest, detail, TIERS),
	pieceLeaves: (record, manifest, detail) => bladeLeaves(record, manifest, detail, PIECE_TIERS),
};
