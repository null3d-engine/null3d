// The card bake: each shoot prototype drawn orthographically onto three planes through the middle
// of its bounds (two vertical and crossed, one horizontal), or a long piece onto a face and an edge
// plane for each stretch of its line, seen from the front and from behind,
// into a card atlas on the CPU. The front views fill layer 0 and the views from behind fill layer 1
// at the same place, each drawn so that one point of a card samples one point of the shoot from
// either side.
//
// A leaf takes the face's linear mean colour from the texture manifest, times its luminance profile
// from base to tip, and keeps it where the leaf's outline covers its texture coordinates: the CPU
// never reads the KTX2 texels, and at the distance where cards draw, a leaf covers a few pixels, so
// its mip-mapped colour is that mean. Stems and buds take the young bark's mean times the record's
// tint of thin wood, as the drawn wood does, and extras their record's colour. Each texel is drawn from several samples, so a part thinner than a texel keeps
// its share: the texel's colour is the mean of what covers it, and its kind is the kind that covers
// most of it, so twig wood never takes a texel that needles mostly cover. Colour is stored as the
// textures store it, sRGB. The surface map holds the normal (octahedral, in the plane's own frame:
// along its right, along its up, and toward the face's viewer), how fast the cell's cut falls a mip
// level, and one byte of the surface kind (a leaf adds 128) with the shade inside the shoot in its
// low seven bits.
// Colour then spreads into the empty texels of each cell, so the mip levels the GPU averages never
// darken a card's edge. Then each texel that ends a thin run turns whole, with the cover that adds
// taken from the run behind it, so a leaflet's tip keeps its reach; each texel the shoot covers half
// or more turns whole, and error diffusion keeps each cell's cover through the texels under half,
// the parts thinner than a texel among them, so the mip levels average to the shoot's own cover. Last, each cell
// measures how fast the coverage it must reach to draw has to fall as the GPU's mip levels average
// it, so a far card keeps the cover the near one draws.
import type { CardCell, MeshArrays } from '../asset';
import { atan2, cos, length3, pow, sin } from '../core/math';
import type { Species } from '../core/record';
import { barkColourOf, type TextureManifest } from '../core/textures';
import type { Rgb } from '../core/types';
import { DETAILS, type Detail } from '../core/types';
import { outlineMask, textureOutline } from '../leaf/outline';
import type { UncardedPrototype } from '../leaf/shoot';
import { leafSurface, SURFACE_EXTRA, SURFACE_PIECE, SURFACE_PIECE_SHEATH } from '../leaf/writer';
import { foliageOptics } from '../render/records';
import type { CardAtlas } from '../stages';
import { rasterise, rasterTarget } from './raster';

/**
 * Texels a side of one card cell by tier. The first card level starts where its longest shoot spans
 * the record's first switch pixels, which on most species is more than a cell holds, so near its
 * start a card is drawn larger than its picture; a finer cell costs four times the atlas memory. A
 * prototype without leaves (a bare winter twin) takes a cell of half the side: its card holds thin
 * stems and buds. So does each stretch of a prototype cut along its line, unless its record's
 * `lod.cardCuts` asks for whole cells.
 *
 * @category api/vegetation
 */
export const CARD_CELL: Readonly<Record<Detail, number>> = {
	low: 64,
	medium: 64,
	high: 64,
	ultra: 64,
};

/** Texels of each cell's border that stay empty, so mip levels never bleed one cell into the next. */
const BORDER = 2;
/** Samples a side of each texel the bake draws, from which a texel takes its cover and its means. */
const SAMPLES = 4;
/** How far a card plane reaches past the prototype's bounds. */
const MARGIN = 1.04;
/** Texels a side of the outline mask that tests a leaf texel's coverage. */
const MASK_SIZE = 512;
/** The tier whose meshes the bake draws. */
const BAKE_TIER = DETAILS.indexOf('high');

/** Linear to sRGB, as a byte. */
function srgbByte(linear: number): number {
	const x = Math.min(1, Math.max(0, linear));
	const s = x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055;
	return Math.round(s * 255);
}

/** A unit normal as two bytes of an octahedral code. */
function octahedral(x: number, y: number, z: number): [number, number] {
	const sum = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
	let u = x / sum;
	let v = y / sum;
	if (z < 0) {
		const ou = u;
		u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
		v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
	}
	return [Math.round((u * 0.5 + 0.5) * 255), Math.round((v * 0.5 + 0.5) * 255)];
}

/** A card plane as the bake plans it: its frame, what it shows, and the triangles it pictures. */
interface PlannedPlane extends CardPlane {
	/** What the plane shows of its piece: 0 its face, 1 its edge, 2 across its line. */
	readonly role: 0 | 1 | 2;
	/** The share of the piece's line the plane spans, from its base. */
	readonly along: readonly [number, number];
	/** The triangles it pictures, three indices each; every triangle where absent. */
	readonly triangles?: Uint32Array;
}

/** The three planes of a prototype through the middle of its bounds, each across the whole of it. */
function planesOf(mesh: MeshArrays): PlannedPlane[] {
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < mesh.positions.length; i += 3)
		for (let c = 0; c < 3; c++) {
			lo[c] = Math.min(lo[c] as number, mesh.positions[i + c] as number);
			hi[c] = Math.max(hi[c] as number, mesh.positions[i + c] as number);
		}
	const centre = [0, 1, 2].map((c) => ((lo[c] as number) + (hi[c] as number)) / 2);
	const half = [0, 1, 2].map((c) =>
		Math.max(1e-4, (((hi[c] as number) - (lo[c] as number)) / 2) * MARGIN),
	);
	const [hx, hy, hz] = half as [number, number, number];
	const whole = [0, 1] as const;
	return [
		{ centre, right: [hx, 0, 0], up: [0, hy, 0], normal: [0, 0, 1], role: 0, along: whole },
		{ centre, right: [0, 0, -hz], up: [0, hy, 0], normal: [1, 0, 0], role: 1, along: whole },
		{ centre, right: [hx, 0, 0], up: [0, 0, -hz], normal: [0, 1, 0], role: 2, along: whole },
	];
}

/** Steps from a prototype's base to its tip that its line is traced in. */
const LINE_STEPS = 12;
/** Length over width from which a shoot's card is cut along its line. */
const SHOOT_LONG = 4;
/** Length over width from which a placed piece's card is cut along its line. */
const PIECE_LONG = 1.5;
/**
 * Metres a prototype reaches from its attach point under which its card is never cut: its texels
 * are already fine, and more cells would cost atlas memory for nothing seen.
 */
const CUT_LEAST = 0.25;
/**
 * The most cards along one prototype where its record names no other: one, so a card is cut along
 * its piece only where the record asks. Each stretch draws planes of its own, so a cut card costs
 * more triangles at every card level and more atlas cells.
 */
const CUTS_MOST = 1;

/** A prototype's line: points from its base to its tip, and each triangle's place along it. */
interface PieceLine {
	readonly points: readonly (readonly [number, number, number])[];
	/** Metres along the line from its base at each point. */
	readonly lengths: readonly number[];
	/** Each triangle's place along the line, in metres from the base. */
	readonly placeOf: Float64Array;
	/** The widest the prototype stands across its line at any step. */
	readonly width: number;
	/** The farthest a triangle's centre stands from the attach point. */
	readonly reach: number;
}

/** a . b. */
function dot(a: readonly number[], b: readonly number[]): number {
	return (
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number)
	);
}

/** a x b. */
function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
	return [
		(a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
		(a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
		(a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
	];
}

/** A direction made unit length, or the fallback where it has none. */
function unit(v: readonly number[], fallback: readonly number[]): [number, number, number] {
	const l = length3(v[0] as number, v[1] as number, v[2] as number);
	return l > 1e-9
		? [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l]
		: [fallback[0] as number, fallback[1] as number, fallback[2] as number];
}

/** A vertex's place. */
function vertexAt(mesh: MeshArrays, v: number): [number, number, number] {
	return [
		mesh.positions[v * 3] as number,
		mesh.positions[v * 3 + 1] as number,
		mesh.positions[v * 3 + 2] as number,
	];
}

/**
 * The directions across a line in which a set of points spreads most and least: the principal axes
 * of their spread in the plane square to the line.
 */
function crossAxes(
	mesh: MeshArrays,
	vertices: Iterable<number>,
	line: readonly number[],
): { wide: [number, number, number]; thin: [number, number, number] } {
	const seed = Math.abs(line[1] as number) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const e0 = unit(cross(line, seed), [1, 0, 0]);
	const e1 = cross(line, e0);
	let n = 0;
	let s0 = 0;
	let s1 = 0;
	let s00 = 0;
	let s01 = 0;
	let s11 = 0;
	for (const v of vertices) {
		const p = vertexAt(mesh, v);
		const a = dot(p, e0);
		const b = dot(p, e1);
		n++;
		s0 += a;
		s1 += b;
		s00 += a * a;
		s01 += a * b;
		s11 += b * b;
	}
	if (n === 0) return { wide: e0, thin: unit(e1, [0, 0, 1]) };
	const c00 = s00 / n - (s0 / n) * (s0 / n);
	const c01 = s01 / n - (s0 / n) * (s1 / n);
	const c11 = s11 / n - (s1 / n) * (s1 / n);
	// The larger eigenvector of the 2 by 2 spread.
	const angle = 0.5 * atan2(2 * c01, c00 - c11);
	const ca = cos(angle);
	const sa = sin(angle);
	const wide = unit(
		[0, 1, 2].map((c) => ca * (e0[c] as number) + sa * (e1[c] as number)),
		e0,
	);
	return { wide, thin: unit(cross(line, wide), e1) };
}

/**
 * A prototype's line, traced from base to tip: its triangles taken in steps along it, each step's
 * mean place a point on the line, smoothed with its neighbours, from the attach point to the
 * piece's own tip, so the last card reaches as far as the piece does. A placed piece's own surface holds
 * its share along the part in its second coordinates, which follows a blade that arches over and
 * droops; any other prototype is taken by distance from its attach point, which grows from base to
 * tip along a strand, a frond or a twig.
 */
function pieceLine(mesh: MeshArrays): PieceLine {
	const triangles = mesh.indices.length / 3;
	let pieceVertices = 0;
	for (let i = 2; i < mesh.colors.length; i += 4)
		if ((mesh.colors[i] as number) === SURFACE_PIECE) pieceVertices++;
	const bySurface = pieceVertices > 0 && pieceVertices === mesh.colors.length / 4;
	const centres: [number, number, number][] = [];
	const param = new Float64Array(triangles);
	let reach = 1e-6;
	let most = 1e-6;
	for (let t = 0; t < triangles; t++) {
		const c: [number, number, number] = [0, 0, 0];
		let share = 0;
		for (let k = 0; k < 3; k++) {
			const v = mesh.indices[t * 3 + k] as number;
			for (let a = 0; a < 3; a++)
				c[a] = (c[a] as number) + (mesh.positions[v * 3 + a] as number) / 3;
			share += (mesh.uvs1[v * 2] as number) / 3;
		}
		centres.push(c);
		const distance = length3(c[0], c[1], c[2]);
		reach = Math.max(reach, distance);
		param[t] = bySurface ? share : distance;
		most = Math.max(most, param[t] as number);
	}
	const stepOf = (value: number) =>
		Math.min(LINE_STEPS - 1, Math.floor((value / most) * LINE_STEPS));
	const sums = Array.from({ length: LINE_STEPS }, () => [0, 0, 0, 0]);
	const members: number[][] = Array.from({ length: LINE_STEPS }, () => []);
	for (let t = 0; t < triangles; t++) {
		const step = stepOf(param[t] as number);
		const sum = sums[step] as number[];
		const c = centres[t] as [number, number, number];
		for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (c[k] as number);
		sum[3] = (sum[3] as number) + 1;
		members[step]?.push(t);
	}
	const raw: [number, number, number][] = [[0, 0, 0]];
	const stepPoint: number[] = new Array(LINE_STEPS).fill(-1);
	sums.forEach((sum, step) => {
		const n = sum[3] as number;
		if (n === 0) return;
		raw.push([(sum[0] as number) / n, (sum[1] as number) / n, (sum[2] as number) / n]);
		stepPoint[step] = raw.length - 1;
	});
	// The tip: the vertex farthest along, by its share along the part or by its distance from the
	// attach point.
	let tip = -1;
	let farthest = Number.NEGATIVE_INFINITY;
	for (let v = 0; v < mesh.positions.length / 3; v++) {
		const p = vertexAt(mesh, v);
		const value = bySurface ? (mesh.uvs1[v * 2] as number) : length3(p[0], p[1], p[2]);
		if (value > farthest) {
			farthest = value;
			tip = v;
		}
	}
	if (tip >= 0) raw.push(vertexAt(mesh, tip));
	// A step's mean leans toward whichever side its parts crowd, so the line is smoothed with its
	// neighbours; its ends stay where they are.
	const points = raw.map((point, i) => {
		if (i === 0 || i === raw.length - 1) return point;
		const a = raw[i - 1] as number[];
		const b = raw[i + 1] as number[];
		return [0, 1, 2].map(
			(c) => ((a[c] as number) + 2 * (point[c] as number) + (b[c] as number)) / 4,
		) as [number, number, number];
	});
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as number[];
		const b = points[i] as number[];
		lengths.push(
			(lengths[i - 1] as number) +
				length3(
					(b[0] as number) - (a[0] as number),
					(b[1] as number) - (a[1] as number),
					(b[2] as number) - (a[2] as number),
				),
		);
	}
	// Each triangle's place: its step's place on the line, and how far past that step it lies.
	const placeOf = new Float64Array(triangles);
	let width = 0;
	members.forEach((list, step) => {
		const at = stepPoint[step] as number;
		if (at < 0) return;
		const before = points[at - 1] as number[];
		const after = (points[at + 1] ?? points[at]) as number[];
		const line = unit(
			[0, 1, 2].map((c) => (after[c] as number) - (before[c] as number)),
			[0, 1, 0],
		);
		const vertices = new Set<number>();
		for (const t of list)
			for (let k = 0; k < 3; k++) vertices.add(mesh.indices[t * 3 + k] as number);
		const { wide } = crossAxes(mesh, vertices, line);
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of vertices) {
			const d = dot(vertexAt(mesh, v), wide);
			lo = Math.min(lo, d);
			hi = Math.max(hi, d);
		}
		width = Math.max(width, hi - lo);
		const point = points[at] as number[];
		for (const t of list) {
			const c = centres[t] as number[];
			const past = dot(
				[0, 1, 2].map((k) => (c[k] as number) - (point[k] as number)),
				line,
			);
			placeOf[t] = Math.max(0, (lengths[at] as number) + past);
		}
	});
	return { points, lengths, placeOf, width, reach };
}

/** The point on a line at a distance along it from its base. */
function pointAlong(line: PieceLine, at: number): [number, number, number] {
	const { points, lengths } = line;
	for (let i = 1; i < points.length; i++)
		if ((lengths[i] as number) >= at || i === points.length - 1) {
			const a = points[i - 1] as readonly number[];
			const b = points[i] as readonly number[];
			const span = Math.max(1e-9, (lengths[i] as number) - (lengths[i - 1] as number));
			const t = Math.min(1, Math.max(0, (at - (lengths[i - 1] as number)) / span));
			return [0, 1, 2].map((c) => (a[c] as number) + ((b[c] as number) - (a[c] as number)) * t) as [
				number,
				number,
				number,
			];
		}
	return [...(points[0] ?? [0, 0, 0])] as [number, number, number];
}

/**
 * The planes of a prototype's card. One many times longer than it is wide, or a placed piece half
 * as long again as it is wide, is cut along its line into several cards, each with its own face and
 * edge planes square to the stretch of line it holds and its own cells, so its texels run along the
 * piece instead of across one square cell, and an arching blade or a hanging strand is pictured
 * along its arch. Any other prototype keeps three planes through the middle of its bounds.
 *
 * @param prototype The prototype.
 * @param mesh Its mesh at the bake's tier.
 * @param most The most stretches it is cut into.
 * @returns The planes, base first on a cut card.
 */
function cardPlanes(prototype: UncardedPrototype, mesh: MeshArrays, most: number): PlannedPlane[] {
	const triangles = mesh.indices.length / 3;
	// A prototype only a cutting draws is drawn at the nearest level alone, so its card stays whole.
	if (triangles === 0 || prototype.cutting) return planesOf(mesh);
	const line = pieceLine(mesh);
	const length = line.lengths[line.lengths.length - 1] as number;
	const width = Math.max(line.width, 1e-6);
	const long = prototype.class === 'piece' ? PIECE_LONG : SHOOT_LONG;
	if (line.reach < CUT_LEAST || length < long * width) return planesOf(mesh);
	const cuts = Math.min(most, Math.max(2, Math.round(length / width)));
	if (cuts < 2) return planesOf(mesh);
	const step = length / cuts;
	const groups: number[][] = Array.from({ length: cuts }, () => []);
	for (let t = 0; t < triangles; t++)
		groups[Math.min(cuts - 1, Math.floor((line.placeOf[t] as number) / step))]?.push(t);
	const planes: PlannedPlane[] = [];
	let lastWide: number[] | undefined;
	groups.forEach((group, k) => {
		if (group.length === 0) return;
		const start = pointAlong(line, k * step);
		const end = pointAlong(line, (k + 1) * step);
		const along = unit(
			[0, 1, 2].map((c) => (end[c] as number) - (start[c] as number)),
			[0, 1, 0],
		);
		const vertices = new Set<number>();
		for (const t of group)
			for (let i = 0; i < 3; i++) vertices.add(mesh.indices[t * 3 + i] as number);
		let { wide, thin } = crossAxes(mesh, vertices, along);
		// Neighbouring cards keep one handedness, so the piece's face turns no way between them.
		if (lastWide && dot(wide, lastWide) < 0) {
			wide = [-wide[0], -wide[1], -wide[2]];
			thin = [-thin[0], -thin[1], -thin[2]];
		}
		lastWide = wide;
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		const axes = [wide, along, thin];
		for (const v of vertices) {
			const p = vertexAt(mesh, v);
			axes.forEach((axis, a) => {
				const d = dot(p, axis);
				lo[a] = Math.min(lo[a] as number, d);
				hi[a] = Math.max(hi[a] as number, d);
			});
		}
		const mid = [0, 1, 2].map((a) => ((lo[a] as number) + (hi[a] as number)) / 2);
		const half = [0, 1, 2].map((a) =>
			Math.max(1e-4, (((hi[a] as number) - (lo[a] as number)) / 2) * MARGIN),
		);
		// Each plane stands in the middle of its stretch, but the last stretch's planes stand through
		// the piece's tip along their normals, so a tip that turns away from its stretch's line, as a
		// blade's tip lying along the ground does, is pictured where it lies.
		const tip = k === groups.length - 1 ? end : undefined;
		const placed = (w: number, t: number) =>
			[0, 1, 2].map(
				(c) =>
					w * (wide[c] as number) +
					(mid[1] as number) * (along[c] as number) +
					t * (thin[c] as number),
			);
		const faceCentre = placed(mid[0] as number, tip ? dot(tip, thin) : (mid[2] as number));
		const edgeCentre = placed(tip ? dot(tip, wide) : (mid[0] as number), mid[2] as number);
		// Each leaf pictured once, on the plane it faces most: a leaf turned edge-on to the face
		// plane shows on the edge plane, as it shows edge-on from the face's side on the plant. The
		// stretch's wood is pictured on both, as a stem shows from every side.
		const faceTriangles: number[] = [];
		const edgeTriangles: number[] = [];
		for (const t of group) {
			const ia = mesh.indices[t * 3] as number;
			const ib = mesh.indices[t * 3 + 1] as number;
			const ic = mesh.indices[t * 3 + 2] as number;
			const a = vertexAt(mesh, ia);
			const b = vertexAt(mesh, ib);
			const c = vertexAt(mesh, ic);
			const n = cross(
				[b[0] - a[0], b[1] - a[1], b[2] - a[2]],
				[c[0] - a[0], c[1] - a[1], c[2] - a[2]],
			);
			const leaf = leafSurface(mesh.colors[ia * 4 + 2] as number);
			const toFace = Math.abs(dot(n, thin));
			const toEdge = Math.abs(dot(n, wide));
			if (!leaf || toFace >= toEdge) faceTriangles.push(ia, ib, ic);
			if (!leaf || toEdge > toFace) edgeTriangles.push(ia, ib, ic);
		}
		const span = [k / cuts, (k + 1) / cuts] as const;
		const up = along.map((value) => value * (half[1] as number));
		// The face: across the piece's width and along its line; the edge: across its depth.
		const faceRight = wide.map((value) => value * (half[0] as number));
		const edgeRight = thin.map((value) => -value * (half[2] as number));
		planes.push(
			{
				centre: faceCentre,
				right: faceRight,
				up,
				normal: unit(cross(faceRight, up), thin),
				role: 0,
				along: span,
				triangles: Uint32Array.from(faceTriangles),
			},
			{
				centre: edgeCentre,
				right: edgeRight,
				up,
				normal: unit(cross(edgeRight, up), wide),
				role: 1,
				along: span,
				triangles: Uint32Array.from(edgeTriangles),
			},
		);
	});
	return planes;
}

/**
 * Where each prototype's cells lie, one for each of its planes: full cells first, then half cells
 * four to a full one for the prototypes that take them.
 */
function layout(
	prototypes: readonly UncardedPrototype[],
	counts: readonly number[],
	halves: readonly boolean[],
	cell: number,
): { size: number; rects: [number, number, number, number][][] } {
	const planes = (bare: boolean) =>
		prototypes.reduce(
			(sum, _, k) => sum + ((halves[k] as boolean) === bare ? (counts[k] as number) : 0),
			0,
		);
	const full = planes(false);
	const halfPlanes = planes(true);
	const units = full + Math.ceil(halfPlanes / 4);
	const across = Math.max(1, Math.ceil(Math.sqrt(units)));
	let unit = 0;
	let quarter = 0;
	const rects = prototypes.map(() => [] as [number, number, number, number][]);
	const place = (bare: boolean) =>
		prototypes.forEach((_, p) => {
			if ((halves[p] as boolean) !== bare) return;
			for (let k = 0; k < (counts[p] as number); k++) {
				const x = (unit % across) * cell;
				const y = Math.floor(unit / across) * cell;
				if (!bare) {
					rects[p]?.push([x, y, cell, cell]);
					unit++;
					continue;
				}
				const h = cell / 2;
				rects[p]?.push([x + (quarter % 2) * h, y + Math.floor(quarter / 2) * h, h, h]);
				quarter++;
				if (quarter === 4) {
					quarter = 0;
					unit++;
				}
			}
		});
	place(false);
	place(true);
	return { size: across * cell, rects };
}

/** The colour sources of a species' surfaces. */
export interface Palette {
	readonly upper: Rgb;
	readonly lower: Rgb;
	readonly stem: Rgb;
	/** A tuft's sheath colour at the column's foot, where the record gives one. */
	readonly sheath?: Rgb;
	readonly profile:
		| { readonly upper: readonly number[]; readonly lower: readonly number[] }
		| undefined;
	readonly base: number;
	readonly tip: number;
	readonly mask: Uint8Array | undefined;
	readonly extras: readonly Rgb[];
	/**
	 * How a fully browned piece's leaf colour turns on each face, where the record gives autumn
	 * colours: the autumn reflectance over the face's own, as the plant material turns a placed
	 * piece by its browning at the nearest level.
	 */
	readonly browned?: { readonly upper: Rgb; readonly lower: Rgb };
}

/**
 * A luminance profile scaled so that, weighted by the leaf area in each band, it averages 1: a leaf
 * drawn with it then keeps the texture's mean colour.
 */
function normalised(profile: readonly number[], areas: readonly number[]): number[] {
	let sum = 0;
	let area = 0;
	profile.forEach((value, band) => {
		sum += value * (areas[band] ?? 0);
		area += areas[band] ?? 0;
	});
	const mean = area > 0 ? sum / area : 0;
	return profile.map((value) => (mean > 0 ? value / mean : 1));
}

/** The leaf's covered texels in each of a profile's bands from base to tip. */
function bandAreas(mask: Uint8Array, base: number, tip: number, bands: number): number[] {
	const areas = new Array<number>(bands).fill(0);
	for (let row = 0; row < MASK_SIZE; row++) {
		const share = ((row + 0.5) / MASK_SIZE - base) / Math.max(1e-6, tip - base);
		const band = Math.min(bands - 1, Math.max(0, Math.floor(share * bands)));
		let covered = 0;
		for (let x = 0; x < MASK_SIZE; x++) covered += mask[row * MASK_SIZE + x] as number;
		areas[band] = (areas[band] as number) + covered;
	}
	return areas;
}

/**
 * The colours a bake reads: the leaf texture's means and profiles. The plant shader divides a card
 * texel by its texture's mean and multiplies it by the record's reflectance, as it draws a leaf,
 * so a leaf texel holds the texture's colour and not the reflectance. A species with no leaf
 * texture samples a white texel, so its leaf texels hold white and the shader gives the leaf its
 * colour from the record's optics alone.
 */
export function paletteOf(record: Species, manifest: TextureManifest): Palette {
	const leaf = manifest.leaf;
	// A card's twigs take the young bark as the drawn wood does: its texture's mean times the
	// record's tint of thin wood.
	const young = manifest.bark?.young.mean;
	const tint = record.bark?.youngTint ?? [1, 1, 1];
	const stem: Rgb = young
		? [young[0] * tint[0], young[1] * tint[1], young[2] * tint[2]]
		: barkColourOf(record, manifest);
	const extras = (record.extras ?? []).map((extra) => extra.colour);
	const sheathColour = record.growth.model === 'tuft' ? record.growth.sheathColour : undefined;
	const sheath = sheathColour ? { sheath: sheathColour.foot } : {};
	const leafOptics = foliageOptics(record);
	const autumn = record.seasons.autumn?.reflectance;
	const turn = (face: Rgb, to: Rgb): Rgb => [
		to[0] / Math.max(face[0], 1e-4),
		to[1] / Math.max(face[1], 1e-4),
		to[2] / Math.max(face[2], 1e-4),
	];
	const browning =
		leafOptics && autumn
			? {
					browned: {
						upper: turn(leafOptics.reflectance, autumn),
						lower: turn(leafOptics.reflectanceBack, autumn),
					},
				}
			: {};
	if (leaf) {
		const outline = textureOutline(leaf);
		const mask = outlineMask(outline.points, MASK_SIZE);
		const base = outline.base[1];
		const tip = outline.tip[1];
		const areas = (profile: readonly number[]) => bandAreas(mask, base, tip, profile.length);
		return {
			upper: leaf.mean.upper,
			lower: leaf.mean.lower,
			stem,
			...sheath,
			profile: {
				upper: normalised(leaf.profile.upper, areas(leaf.profile.upper)),
				lower: normalised(leaf.profile.lower, areas(leaf.profile.lower)),
			},
			base,
			tip,
			mask,
			extras,
			...browning,
		};
	}
	return {
		upper: [1, 1, 1],
		lower: [1, 1, 1],
		stem,
		...sheath,
		profile: undefined,
		base: 0,
		tip: 1,
		mask: undefined,
		extras,
		...browning,
	};
}

/**
 * The mesh a prototype's cards picture: a placed piece's whole mesh where it carries one, since a
 * cut piece's tier may hold only the neck it is cut at, else the prototype's own mesh at the bake's
 * tier.
 */
function bakeMeshOf(prototype: UncardedPrototype): MeshArrays {
	return prototype.bake ?? (prototype.tiers[BAKE_TIER] as MeshArrays);
}

/**
 * Bakes the card atlas of a species' prototypes, and each prototype's cells in it.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param detail The mesh tier, which sets the cells' size.
 * @param prototypes The prototypes.
 * @returns The atlas, and one cell set per prototype.
 */
export function bakeCards(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	prototypes: readonly UncardedPrototype[],
): { readonly atlas: CardAtlas; readonly cells: readonly CardCell[] } {
	const cuts = record.lod.cardCuts;
	const planned = prototypes.map((prototype) =>
		cardPlanes(prototype, bakeMeshOf(prototype), cuts?.most ?? CUTS_MOST),
	);
	// A prototype without leaves holds thin stems and buds, so its planes take half cells; so do a cut
	// prototype's stretches, unless the record asks for whole ones.
	const halves = prototypes.map(
		(prototype, p) =>
			prototype.leaves === 0 ||
			((planned[p] as PlannedPlane[]).length !== 3 && cuts?.cells !== 'full'),
	);
	const { size, rects } = layout(
		prototypes,
		planned.map((planes) => planes.length),
		halves,
		record.lod.cardCell?.[detail] ?? CARD_CELL[detail],
	);
	const layerBytes = size * size * 4;
	const color = new Uint8Array(layerBytes * 2);
	const surface = new Uint8Array(layerBytes * 2);
	const palette = paletteOf(record, manifest);
	const cells: CardCell[] = prototypes.map((prototype, p) => {
		const mesh = bakeMeshOf(prototype);
		const planes = planned[p] as PlannedPlane[];
		return {
			planes: planes.map((plane, k) => {
				const rect = inside(rects[p]?.[k] as [number, number, number, number]);
				bakeCell(mesh, plane, rect, size, palette, color, surface, plane.triangles);
				return {
					centre: plane.centre as unknown as CardCell['planes'][number]['centre'],
					right: plane.right as unknown as CardCell['planes'][number]['right'],
					up: plane.up as unknown as CardCell['planes'][number]['up'],
					front: rect,
					back: rect,
					role: plane.role,
					along: plane.along,
				};
			}),
		};
	});
	return { atlas: { size, color, surface }, cells };
}

/** A cell's drawn area: the cell less its border. */
function inside(cell: readonly number[]): [number, number, number, number] {
	return [
		(cell[0] as number) + BORDER,
		(cell[1] as number) + BORDER,
		(cell[2] as number) - 2 * BORDER,
		(cell[3] as number) - 2 * BORDER,
	];
}

/**
 * The steepest fall, a mip level, of the coverage a card's texel must reach to draw that the
 * surface map's third byte holds: the byte reads 0 for a cut that stays at one half, 255 for this.
 */
export const CARD_CUT_FALL_MOST = 0.3;
/** The most mip levels over the full size that a cell's fall is fitted over: those a whole view reads. */
const FALL_LEVELS = 5;
/** Offsets of the pixel grid a side that a level's cut is read over. */
const CUT_OFFSETS = 4;
/** The lowest coverage a card's texel must reach at any mip level, so faint averages never draw. */
export const CARD_CUT_LEAST = 0.08;

/** Texels a side that a leaf cell keeps at the coarsest mip level a card reads. */
const LEVEL_TEXELS = 4;

/**
 * The coarsest mip level a species' cards read: the deepest at which its smallest leaf cell, with
 * its border, still holds four texels a side. Past it a cell's average takes in its empty border and the cells beside
 * it, so a card seen at a slant, whose footprint runs long, would lose its cover. The plant shader
 * holds each card's sample and cut there. Prototypes that hold no leaves, or that only a cutting
 * draws, do not count; with no leaf cell at all it is 0, which holds nothing.
 *
 * @param prototypes The kit's prototypes with their cells.
 * @returns The level.
 */
export function cardLevelMost(
	prototypes: readonly {
		readonly leaves: number;
		readonly cutting?: boolean;
		readonly card: CardCell;
	}[],
): number {
	let side = Number.POSITIVE_INFINITY;
	for (const prototype of prototypes) {
		if (prototype.leaves === 0 || prototype.cutting) continue;
		for (const plane of prototype.card.planes)
			side = Math.min(
				side,
				(plane.front[2] as number) + 2 * BORDER,
				(plane.front[3] as number) + 2 * BORDER,
			);
	}
	if (!Number.isFinite(side)) return 0;
	let level = 0;
	while (side >> (level + 1) >= LEVEL_TEXELS) level++;
	return level;
}

/** Falls a cell's search tries, evenly from none to `CARD_CUT_FALL_MOST`. */
const FALL_STEPS = 60;

/**
 * How fast a cell's cut must fall, a mip level, to keep the cover it draws at full size. The GPU
 * makes each level by averaging four texels of the one below, so a coarse level's alpha is the
 * share a part covers, and a cut at one half drops every patch less than half covered: a far card
 * loses its sparse and thin parts first, and a sparse cell loses more than a dense one. The cell is
 * read at each half level it still spans as the shader reads it: blended between the texels of the
 * whole levels round it and between those levels, from several offsets of the pixel grid. The fall
 * chosen is the one whose cuts, one half less the fall times the level, draw shares nearest the
 * full-size share over those levels.
 *
 * @param color The colour layers, whose alpha is each texel's coverage.
 * @param size The atlas's texels a side.
 * @param layer The layer.
 * @param drawn The cell's drawn area; the border round it is empty.
 * @returns The fall, from 0 to `CARD_CUT_FALL_MOST`.
 */
function cutFall(
	color: Uint8Array,
	size: number,
	layer: number,
	drawn: readonly [number, number, number, number],
): number {
	const [x0, y0, w, h] = drawn;
	// The cell with its empty border, as a square of whole texels the levels halve.
	let side = 1;
	while (side < Math.max(w, h) + 2 * BORDER) side *= 2;
	let alpha = new Float32Array(side * side);
	let covered = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const a = (color[(layer * size * size + (y0 + y) * size + x0 + x) * 4 + 3] as number) / 255;
			alpha[(y + BORDER) * side + x + BORDER] = a;
			covered += a >= 0.5 ? 1 : 0;
		}
	const share = covered / Math.max(1, w * h);
	if (share === 0) return 0;
	// Levels at which the cell still spans two of the level's texels: past them a level holds the
	// border more than the cell.
	let levels = 0;
	while (levels < FALL_LEVELS && Math.min(w, h) >= 4 << levels) levels++;
	// The cell's mip levels, each the mean of 2 by 2 texels of the one below.
	const pyramid: { alpha: Float32Array; side: number }[] = [{ alpha, side }];
	for (let level = 1; level <= levels && side > 1; level++) {
		const next = side >> 1;
		const coarse = new Float32Array(next * next);
		for (let y = 0; y < next; y++)
			for (let x = 0; x < next; x++)
				coarse[y * next + x] =
					((alpha[y * 2 * side + x * 2] as number) +
						(alpha[y * 2 * side + x * 2 + 1] as number) +
						(alpha[(y * 2 + 1) * side + x * 2] as number) +
						(alpha[(y * 2 + 1) * side + x * 2 + 1] as number)) /
					4;
		alpha = coarse;
		side = next;
		pyramid.push({ alpha, side });
	}
	/** One whole level read at a point, in full-size texels, blended between its texels. */
	const read = (level: number, tx: number, ty: number) => {
		const { alpha: a, side: s } = pyramid[level] as { alpha: Float32Array; side: number };
		const step = 1 << level;
		const x = tx / step - 0.5;
		const y = ty / step - 0.5;
		const xa = Math.floor(x);
		const ya = Math.floor(y);
		const fx = x - xa;
		const fy = y - ya;
		const at = (xx: number, yy: number) =>
			a[Math.min(s - 1, Math.max(0, yy)) * s + Math.min(s - 1, Math.max(0, xx))] as number;
		return (
			(at(xa, ya) * (1 - fx) + at(xa + 1, ya) * fx) * (1 - fy) +
			(at(xa, ya + 1) * (1 - fx) + at(xa + 1, ya + 1) * fx) * fy
		);
	};
	// The readings at each half level from the first, highest first, as the shader takes a level
	// between two whole ones: each whole level read at the point, blended by where the level lies
	// between them, at points a pixel of that level apart.
	const readings: { level: number; sorted: Float64Array }[] = [];
	const top = pyramid.length - 1;
	for (let half = 1; half <= 2 * top; half++) {
		const level = half / 2;
		const below = Math.floor(level);
		const upper = Math.min(top, below + 1);
		const blend = level - below;
		const step = pow(2, level);
		const values: number[] = [];
		for (let oy = 0; oy < CUT_OFFSETS; oy++)
			for (let ox = 0; ox < CUT_OFFSETS; ox++)
				for (let ty = BORDER + ((oy + 0.5) / CUT_OFFSETS) * step; ty < BORDER + h; ty += step)
					for (let tx = BORDER + ((ox + 0.5) / CUT_OFFSETS) * step; tx < BORDER + w; tx += step)
						values.push(
							read(below, tx, ty) * (1 - blend) + (blend > 0 ? read(upper, tx, ty) * blend : 0),
						);
		if (values.length > 0)
			readings.push({ level, sorted: Float64Array.from(values).sort().reverse() });
	}
	// The share of a level's readings at or above a cut, by halving the sorted readings.
	const above = (sorted: Float64Array, cut: number) => {
		let lo = 0;
		let hi = sorted.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((sorted[mid] as number) >= cut) lo = mid + 1;
			else hi = mid;
		}
		return lo / sorted.length;
	};
	let best = 0;
	let bestError = Infinity;
	for (let k = 0; k <= FALL_STEPS; k++) {
		const fall = (k / FALL_STEPS) * CARD_CUT_FALL_MOST;
		let error = 0;
		for (const { level, sorted } of readings) {
			const cut = Math.max(CARD_CUT_LEAST, 0.5 - fall * level);
			error += Math.abs(above(sorted, cut) - share);
		}
		if (error < bestError - 1e-9) {
			bestError = error;
			best = fall;
		}
	}
	return best;
}

/** A card plane in prototype space: its centre, its right and up half-extents, and its normal. */
export interface CardPlane {
	readonly centre: readonly number[];
	readonly right: readonly number[];
	readonly up: readonly number[];
	readonly normal: readonly number[];
}

/**
 * Draws one plane of a prototype into its cell of a card atlas, complete: the shoot seen from the
 * front into layer 0 and from behind into layer 1, each texel from `SAMPLES` by `SAMPLES` samples,
 * then the colour and the surface spread into the empty texels, then the alpha set whole or clear so
 * the cell keeps the cover its texels hold, then the fall of the cell's cut written through it. The
 * spread also fills the border of empty texels round the drawn area, which the atlas's layout leaves
 * to each cell; its alpha stays clear, so a far card's mip levels average the cell's own colour,
 * normal, shade and fall, never zeros.
 *
 * @param mesh The prototype's mesh at the bake's tier.
 * @param plane The plane.
 * @param rect The cell's drawn area in texels: x, y, width, height.
 * @param size The atlas's texels a side.
 * @param palette The species' colours, from `paletteOf`.
 * @param color The atlas's colour layers, which this writes.
 * @param surface The atlas's surface layers, which this writes.
 * @param triangles The triangles the plane pictures, three indices each; every triangle of the mesh
 * where absent.
 */
export function bakeCell(
	mesh: MeshArrays,
	plane: CardPlane,
	rect: readonly [number, number, number, number],
	size: number,
	palette: Palette,
	color: Uint8Array,
	surface: Uint8Array,
	triangles: ArrayLike<number> = mesh.indices,
): void {
	const drawn: [number, number, number, number] = [rect[0], rect[1], rect[2], rect[3]];
	const left = Math.max(0, drawn[0] - BORDER);
	const bottom = Math.max(0, drawn[1] - BORDER);
	const bordered: [number, number, number, number] = [
		left,
		bottom,
		Math.min(size, drawn[0] + drawn[2] + BORDER) - left,
		Math.min(size, drawn[1] + drawn[3] + BORDER) - bottom,
	];
	const cover = new Float32Array(drawn[2] * drawn[3]);
	const centred = new Uint8Array(drawn[2] * drawn[3]);
	for (let layer = 0; layer < 2; layer++) {
		cover.fill(0);
		centred.fill(0);
		drawPlane(mesh, triangles, plane, drawn, size, layer, palette, color, surface, cover, centred);
		spread(surface, color, size, layer, bordered, false);
		spread(color, color, size, layer, bordered, true);
		keepRunEnds(cover, centred, drawn[2], drawn[3]);
		dither(color, cover, size, layer, drawn);
		const fall = Math.round((cutFall(color, size, layer, drawn) / CARD_CUT_FALL_MOST) * 255);
		for (let y = bordered[1]; y < bordered[1] + bordered[3]; y++)
			for (let x = bordered[0]; x < bordered[0] + bordered[2]; x++)
				surface[(layer * size * size + y * size + x) * 4 + 2] = fall;
	}
}

/**
 * Draws one face of one plane of a prototype into its cell, at `SAMPLES` by `SAMPLES` samples a
 * texel. A texel's cover is the share of its samples that the shoot covers; its colour, normal and
 * shade are their means; its kind is the kind that covers most of it. The colour layer's
 * alpha marks every texel the shoot touches, for the spread, and the cover goes to `cover`, one
 * value a texel of the cell, for the dither that sets the alpha after it.
 */
function drawPlane(
	mesh: MeshArrays,
	triangles: ArrayLike<number>,
	plane: CardPlane,
	rect: [number, number, number, number],
	size: number,
	layer: number,
	palette: Palette,
	color: Uint8Array,
	surface: Uint8Array,
	cover: Float32Array,
	centred: Uint8Array,
): void {
	const [rx, ry, rw, rh] = rect;
	const w = rw * SAMPLES;
	const h = rh * SAMPLES;
	const target = rasterTarget(w, h);
	const count = mesh.positions.length / 3;
	const points = new Float64Array(count * 3);
	const rightLength = length3(...(plane.right as [number, number, number]));
	const upLength = length3(...(plane.up as [number, number, number]));
	const [rx0, rx1, rx2] = plane.right as [number, number, number];
	const [ux0, ux1, ux2] = plane.up as [number, number, number];
	const normal = plane.normal as [number, number, number];
	// The view from behind keeps the front's place on the card: only the depth test turns round.
	const toward = layer === 0 ? 1 : -1;
	// Each axis scaled by its own squared length, so a dot product gives the share of the half-extent.
	const [sx, sy, sz] = plane.right.map((value) => value / (rightLength * rightLength)) as [
		number,
		number,
		number,
	];
	const [ux, uy, uz] = plane.up.map((value) => value / (upLength * upLength)) as [
		number,
		number,
		number,
	];
	const [cx, cy, cz] = plane.centre as [number, number, number];
	for (let i = 0; i < count; i++) {
		const dx = (mesh.positions[i * 3] as number) - cx;
		const dy = (mesh.positions[i * 3 + 1] as number) - cy;
		const dz = (mesh.positions[i * 3 + 2] as number) - cz;
		points[i * 3] = ((dx * sx + dy * sy + dz * sz + 1) / 2) * w;
		points[i * 3 + 1] = ((dx * ux + dy * uy + dz * uz + 1) / 2) * h;
		points[i * 3 + 2] = -toward * (dx * normal[0] + dy * normal[1] + dz * normal[2]);
	}
	// Each sample's linear colour, its normal in the plane's frame, its shade, and its kind: -1 where
	// nothing covers it, 1 for a leaf, else 0.
	const samples = w * h;
	const rgbAt = new Float32Array(samples * 3);
	const normalAt = new Float32Array(samples * 3);
	const shadeAt = new Float32Array(samples);
	const kindAt = new Int8Array(samples).fill(-1);
	const indices = triangles;
	let a = 0;
	let b = 0;
	let c = 0;
	let w0 = 0;
	let w1 = 0;
	let w2 = 0;
	// A vertex value at the fragment, from the corners of the fragment's triangle.
	const lerp = (array: ArrayLike<number>, stride: number, k: number) =>
		(array[a * stride + k] as number) * w0 +
		(array[b * stride + k] as number) * w1 +
		(array[c * stride + k] as number) * w2;
	rasterise(target, points, indices, (f) => {
		const t = f.triangle * 3;
		a = indices[t] as number;
		b = indices[t + 1] as number;
		c = indices[t + 2] as number;
		w0 = f.w0;
		w1 = f.w1;
		w2 = f.w2;
		const kind = mesh.colors[a * 4 + 2] as number;
		let nx = lerp(mesh.normals, 3, 0);
		let ny = lerp(mesh.normals, 3, 1);
		let nz = lerp(mesh.normals, 3, 2);
		const facing = (nx * normal[0] + ny * normal[1] + nz * normal[2]) * toward;
		const leaf = leafSurface(kind);
		let rgb: Rgb;
		if (leaf) {
			const u = lerp(mesh.uvs, 2, 0);
			const v = lerp(mesh.uvs, 2, 1);
			if (palette.mask) {
				const mx = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(u * MASK_SIZE)));
				const my = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(v * MASK_SIZE)));
				if (!palette.mask[my * MASK_SIZE + mx]) return false;
			}
			// The upper face looks along the leaf's normal: seen from that side, the upper colour.
			const upper = facing >= 0;
			const mean = upper ? palette.upper : palette.lower;
			const bands = palette.profile
				? upper
					? palette.profile.upper
					: palette.profile.lower
				: undefined;
			let gain = 1;
			if (bands && bands.length > 0) {
				const share = (v - palette.base) / Math.max(1e-6, palette.tip - palette.base);
				gain = bands[
					Math.min(bands.length - 1, Math.max(0, Math.floor(share * bands.length)))
				] as number;
			}
			rgb = [mean[0] * gain, mean[1] * gain, mean[2] * gain];
			// A placed piece browns by its own second coordinates' y, as the nearest level draws it.
			if (palette.browned && kind === SURFACE_PIECE) {
				const brown = Math.min(1, Math.max(0, lerp(mesh.uvs1, 2, 1)));
				const turned = upper ? palette.browned.upper : palette.browned.lower;
				rgb = [
					rgb[0] * (1 + (turned[0] - 1) * brown),
					rgb[1] * (1 + (turned[1] - 1) * brown),
					rgb[2] * (1 + (turned[2] - 1) * brown),
				];
			}
		} else if (kind === SURFACE_EXTRA) {
			const index = Math.min(
				palette.extras.length - 1,
				Math.max(0, Math.floor(lerp(mesh.uvs, 2, 0) * 8)),
			);
			rgb = palette.extras[index] ?? palette.stem;
		} else if (kind === SURFACE_PIECE_SHEATH) rgb = palette.sheath ?? palette.stem;
		else rgb = palette.stem;
		if (facing < 0) {
			nx = -nx;
			ny = -ny;
			nz = -nz;
		}
		// The normal in the plane's own frame: along its right (u grows), along its up (v grows), and
		// toward this face's viewer, so the shader rebuilds it from the card's own derivatives.
		const tx = (nx * rx0 + ny * rx1 + nz * rx2) / rightLength;
		const ty = (nx * ux0 + ny * ux1 + nz * ux2) / upLength;
		const tz = (nx * normal[0] + ny * normal[1] + nz * normal[2]) * toward;
		const length = length3(tx, ty, tz) || 1;
		const at = f.y * w + f.x;
		rgbAt[at * 3] = rgb[0];
		rgbAt[at * 3 + 1] = rgb[1];
		rgbAt[at * 3 + 2] = rgb[2];
		normalAt[at * 3] = tx / length;
		normalAt[at * 3 + 1] = ty / length;
		normalAt[at * 3 + 2] = tz / length;
		shadeAt[at] = Math.min(255, Math.max(0, lerp(mesh.colors, 4, 3)));
		kindAt[at] = leaf ? 1 : 0;
		return true;
	});
	const whole = SAMPLES * SAMPLES;
	const sum = new Float64Array(7);
	for (let y = 0; y < rh; y++)
		for (let x = 0; x < rw; x++) {
			let covered = 0;
			let leaves = 0;
			let middle = 0;
			sum.fill(0);
			for (let sy = 0; sy < SAMPLES; sy++)
				for (let sx = 0; sx < SAMPLES; sx++) {
					const at = (y * SAMPLES + sy) * w + x * SAMPLES + sx;
					const kind = kindAt[at] as number;
					if (kind < 0) continue;
					covered++;
					if (Math.abs(2 * sx + 1 - SAMPLES) <= 1 && Math.abs(2 * sy + 1 - SAMPLES) <= 1) middle++;
					leaves += kind;
					for (let k = 0; k < 3; k++) {
						sum[k] = (sum[k] as number) + (rgbAt[at * 3 + k] as number);
						sum[3 + k] = (sum[3 + k] as number) + (normalAt[at * 3 + k] as number);
					}
					sum[6] = (sum[6] as number) + (shadeAt[at] as number);
				}
			if (covered === 0) continue;
			const at = (layer * size * size + (ry + y) * size + rx + x) * 4;
			color[at] = srgbByte((sum[0] as number) / covered);
			color[at + 1] = srgbByte((sum[1] as number) / covered);
			color[at + 2] = srgbByte((sum[2] as number) / covered);
			color[at + 3] = 255;
			const length = length3(sum[3] as number, sum[4] as number, sum[5] as number);
			const [ox, oy] =
				length > 1e-6
					? octahedral(
							(sum[3] as number) / length,
							(sum[4] as number) / length,
							(sum[5] as number) / length,
						)
					: octahedral(0, 0, 1);
			const shade = Math.round((sum[6] as number) / covered / 2);
			surface[at] = ox;
			surface[at + 1] = oy;
			surface[at + 2] = 0;
			// The kind that covers most of the texel names it, a leaf on a tie.
			surface[at + 3] = (2 * leaves >= covered ? 128 : 0) + Math.min(127, shade);
			cover[y * rw + x] = covered / whole;
			centred[y * rw + x] = middle > 0 ? 1 : 0;
		}
}

/**
 * The most cover, in whole texels, that a run's end holds in its three by three neighbourhood with
 * itself: a thin run's end holds a texel or two, a broad part's edge three or more.
 */
const END_MOST = 2;

/** How far to one side a run's end's neighbours' cover must lie, as the mean offset in texels. */
const END_SIDE = 0.5;

/** The most texels back along its run that a run's end takes its added cover from. */
const END_REACH = 8;

/**
 * Makes whole each texel that ends a thin run of a cell's picture, such as a leaflet's tip or a
 * needle's end, and takes the cover that adds from the run behind it, so the run's whole texels
 * shift to reach its end and the cell keeps its cover. A texel ends a run where the run passes
 * through its middle, it holds under half cover, little cover stands round it, and what does stands
 * to one side. The added cover is taken from the run's thin texels, each time from the neighbour
 * that holds most, back to a texel of half cover or a few texels along; a run that cannot pay for
 * its end in full keeps its cover as it was.
 *
 * @param cover Each texel's cover in the cell, row by row, which this changes.
 * @param centred Whether the part covers each texel's middle.
 * @param w The cell's width in texels.
 * @param h The cell's height in texels.
 */
function keepRunEnds(cover: Float32Array, centred: Uint8Array, w: number, h: number): void {
	const ends: number[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const own = cover[y * w + x] as number;
			if (own <= 0 || own >= 0.5 || !centred[y * w + x]) continue;
			let around = 0;
			let ox = 0;
			let oy = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if ((dx === 0 && dy === 0) || x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h)
						continue;
					const value = cover[(y + dy) * w + x + dx] as number;
					around += value;
					ox += dx * value;
					oy += dy * value;
				}
			if (around <= 0 || own + around > END_MOST) continue;
			if (length3(ox / around, oy / around, 0) >= END_SIDE) ends.push(y * w + x);
		}
	const taken = new Uint8Array(w * h);
	const paid: number[] = [];
	for (const end of ends) {
		const own = cover[end] as number;
		let owed = 1 - own;
		paid.length = 0;
		let at = end;
		for (let step = 0; step < END_REACH && owed > 1e-6; step++) {
			const x = at % w;
			const y = (at - x) / w;
			let next = -1;
			let most = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
					const there = (y + dy) * w + x + dx;
					const value = cover[there] as number;
					if (taken[there] || value <= 0 || value >= 0.5 || value <= most) continue;
					most = value;
					next = there;
				}
			if (next < 0) break;
			const share = Math.min(owed, most);
			cover[next] = most - share;
			owed -= share;
			taken[next] = 1;
			paid.push(next, share);
			at = next;
		}
		// A run too short to pay for its end, such as a needle's second end, keeps its cover as it was.
		if (owed > 1e-6) {
			for (let k = 0; k < paid.length; k += 2) {
				const texel = paid[k] as number;
				cover[texel] = (cover[texel] as number) + (paid[k + 1] as number);
				taken[texel] = 0;
			}
			continue;
		}
		cover[end] = 1;
		taken[end] = 1;
	}
}

/**
 * Sets each texel of one cell whole or clear so that the cell keeps the cover its texels hold:
 * Floyd and Steinberg's error diffusion, row by row with the direction turning at each row, carries
 * each texel's rounding on to the texels not yet set. A texel that the shoot covers half or more
 * always turns whole, so a part a texel or more wide keeps its outline whole to its edge, and the
 * rounding along that edge is taken up by the texels under half beside it. A texel under half turns
 * whole where what it holds and what it receives reach one half, and an empty texel passes on all it
 * receives. A part thinner than a texel then keeps its share of the cell as a run of whole texels
 * along it, where a texel that took it at its centre alone would keep it by chance.
 *
 * @param color The colour map, whose alpha this writes.
 * @param cover Each texel's cover in the cell, from 0 to 1, row by row.
 * @param size The atlas's texels a side.
 * @param layer The layer.
 * @param rect The cell's drawn area.
 */
function dither(
	color: Uint8Array,
	cover: Float32Array,
	size: number,
	layer: number,
	rect: [number, number, number, number],
): void {
	const [rx, ry, rw, rh] = rect;
	// One texel of padding each side takes the rounding that would leave the cell.
	let row = new Float32Array(rw + 2);
	let next = new Float32Array(rw + 2);
	for (let y = 0; y < rh; y++) {
		const step = y % 2 === 0 ? 1 : -1;
		for (let k = 0; k < rw; k++) {
			const x = step === 1 ? k : rw - 1 - k;
			const texel = layer * size * size + (ry + y) * size + rx + x;
			const share = cover[y * rw + x] as number;
			const value = share + (row[x + 1] as number);
			const kept = share >= 0.5 || (share > 0 && value >= 0.5);
			color[texel * 4 + 3] = kept ? 255 : 0;
			const error = value - (kept ? 1 : 0);
			row[x + 1 + step] = (row[x + 1 + step] as number) + (error * 7) / 16;
			next[x + 1 - step] = (next[x + 1 - step] as number) + (error * 3) / 16;
			next[x + 1] = (next[x + 1] as number) + (error * 5) / 16;
			next[x + 1 + step] = (next[x + 1 + step] as number) + error / 16;
		}
		[row, next] = [next, row];
		next.fill(0);
	}
}

/**
 * Spreads the values of covered texels into the empty texels of one cell. Covered texels are
 * summed into ever coarser blocks of 2 by 2, and each empty texel takes the mean of the finest
 * block round it that holds a covered texel: near an edge the edge's own colour, far from it the
 * mean of a wider stretch. The colour layer's alpha marks the covered texels of both maps, and
 * stays as it was.
 *
 * @param pixels The map to spread.
 * @param coverage The colour map, whose alpha marks coverage.
 * @param size The atlas's texels a side.
 * @param layer The layer.
 * @param rect The cell.
 * @param colour Whether `pixels` is the colour map, whose alpha is coverage and stays.
 */
function spread(
	pixels: Uint8Array,
	coverage: Uint8Array,
	size: number,
	layer: number,
	rect: [number, number, number, number],
	colour: boolean,
): void {
	const [rx, ry, rw, rh] = rect;
	const base = layer * size * size;
	// Level 0 holds each texel's four values and its count (1 when covered); each level above sums
	// 2 by 2 blocks of the one below.
	const levels: { sums: Float64Array; w: number; h: number }[] = [];
	let sums = new Float64Array(rw * rh * 5);
	let w = rw;
	let h = rh;
	for (let y = 0; y < rh; y++)
		for (let x = 0; x < rw; x++) {
			const at = (base + (ry + y) * size + rx + x) * 4;
			if ((coverage[at + 3] as number) === 0) continue;
			const o = (y * rw + x) * 5;
			for (let k = 0; k < 4; k++) sums[o + k] = pixels[at + k] as number;
			sums[o + 4] = 1;
		}
	levels.push({ sums, w, h });
	while (w > 1 || h > 1) {
		const nw = Math.max(1, Math.ceil(w / 2));
		const nh = Math.max(1, Math.ceil(h / 2));
		const next = new Float64Array(nw * nh * 5);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const from = (y * w + x) * 5;
				const to = ((y >> 1) * nw + (x >> 1)) * 5;
				for (let k = 0; k < 5; k++)
					next[to + k] = (next[to + k] as number) + (sums[from + k] as number);
			}
		sums = next;
		w = nw;
		h = nh;
		levels.push({ sums, w, h });
	}
	const top = levels[levels.length - 1] as { sums: Float64Array };
	if ((top.sums[4] as number) === 0) return;
	for (let y = 0; y < rh; y++)
		for (let x = 0; x < rw; x++) {
			const first = levels[0] as { sums: Float64Array };
			if ((first.sums[(y * rw + x) * 5 + 4] as number) > 0) continue;
			for (let level = 1; level < levels.length; level++) {
				const { sums: block, w: bw } = levels[level] as { sums: Float64Array; w: number };
				const o = ((y >> level) * bw + (x >> level)) * 5;
				const count = block[o + 4] as number;
				if (count === 0) continue;
				const at = (base + (ry + y) * size + rx + x) * 4;
				pixels[at] = Math.round((block[o] as number) / count);
				pixels[at + 1] = Math.round((block[o + 1] as number) / count);
				pixels[at + 2] = Math.round((block[o + 2] as number) / count);
				if (!colour) pixels[at + 3] = Math.round((block[o + 3] as number) / count);
				break;
			}
		}
}
