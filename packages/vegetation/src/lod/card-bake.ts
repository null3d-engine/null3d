// The card bake: each shoot prototype drawn orthographically onto three planes through the middle
// of its bounds (two vertical and crossed, one horizontal), seen from the front and from behind,
// into a card atlas on the CPU. The front views fill layer 0 and the views from behind fill layer 1
// at the same place, each drawn so that one point of a card samples one point of the shoot from
// either side.
//
// A leaf texel takes the face's linear mean colour from the texture manifest, times its luminance
// profile from base to tip, and keeps it where the leaf's outline covers its texture coordinates:
// the CPU never reads the KTX2 texels, and at the distance where cards draw, a leaf covers a few
// pixels, so its mip-mapped colour is that mean. Stems and buds take the young bark's mean, extras
// their record's colour. Colour is stored as the textures store it, sRGB, with coverage in alpha.
// The surface map holds the normal (octahedral, in the plane's own frame: along its right, along its
// up, and toward the face's viewer), the
// depth from the plane, and one byte of the surface kind (a leaf adds 128) with the shade inside the
// shoot in its low seven bits. Colour then spreads into the empty texels of each cell, so the mip
// levels the GPU averages never darken a card's edge.
import type { CardCell, PrototypeArrays } from '../asset';
import { length3, pow } from '../core/math';
import type { Species } from '../core/record';
import { barkColourOf, type TextureManifest } from '../core/textures';
import type { Rgb } from '../core/types';
import { DETAILS, type Detail } from '../core/types';
import { outlineMask, textureOutline } from '../leaf/outline';
import type { UncardedPrototype } from '../leaf/shoot';
import { SURFACE_EXTRA, SURFACE_LEAF } from '../leaf/writer';
import type { CardAtlas } from '../stages';
import { rasterise, rasterTarget } from './raster';

/**
 * Texels a side of one card cell by tier. The first card level starts where its longest shoot spans
 * no more pixels than the cell gives it, so a card is never drawn larger than its own picture; a
 * finer cell lets cards start nearer, at four times the atlas memory. A prototype without leaves (a
 * bare winter twin) takes a cell of half the side: its card holds thin stems and buds.
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
/** How far a card plane reaches past the prototype's bounds. */
const MARGIN = 1.04;

/**
 * The texels a card's picture gives its shoot across the shoot's longest side at a tier: the cell
 * less its empty border, over the margin a card plane reaches past the shoot.
 *
 * @param record The species record.
 * @param detail The kit's tier.
 * @returns The texels.
 * @category api/vegetation
 */
export function cardTexels(record: Species, detail: Detail): number {
	return ((record.lod.cardCell?.[detail] ?? CARD_CELL[detail]) - 2 * BORDER) / MARGIN;
}
/** Texels a side of the outline mask that tests a leaf texel's coverage. */
const MASK_SIZE = 512;
/** The tier whose meshes the bake draws. */
const BAKE_TIER = DETAILS.indexOf('high');
/** Bark when the manifest holds none. */

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

/** The three planes of a prototype: centre, right and up half-extents, normal. */
function planesOf(
	mesh: PrototypeArrays,
): { centre: number[]; right: number[]; up: number[]; normal: number[] }[] {
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
	return [
		{ centre, right: [hx, 0, 0], up: [0, hy, 0], normal: [0, 0, 1] },
		{ centre, right: [0, 0, -hz], up: [0, hy, 0], normal: [1, 0, 0] },
		{ centre, right: [hx, 0, 0], up: [0, 0, -hz], normal: [0, 1, 0] },
	];
}

/** Where each prototype's three cells lie: full cells first, then half cells four to a full one. */
function layout(
	prototypes: readonly UncardedPrototype[],
	cell: number,
): { size: number; rects: [number, number, number, number][][] } {
	const full = prototypes.filter((p) => p.leaves > 0).length * 3;
	const halves = prototypes.filter((p) => p.leaves === 0).length * 3;
	const units = full + Math.ceil(halves / 4);
	const across = Math.max(1, Math.ceil(Math.sqrt(units)));
	let unit = 0;
	let quarter = 0;
	const rects = prototypes.map(() => [] as [number, number, number, number][]);
	const place = (bare: boolean) =>
		prototypes.forEach((prototype, p) => {
			if ((prototype.leaves === 0) !== bare) return;
			for (let k = 0; k < 3; k++) {
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
	readonly profile:
		| { readonly upper: readonly number[]; readonly lower: readonly number[] }
		| undefined;
	readonly base: number;
	readonly tip: number;
	readonly mask: Uint8Array | undefined;
	readonly extras: readonly Rgb[];
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

/** The colours a bake reads: the manifest's means and profiles, else the record's optics. */
export function paletteOf(record: Species, manifest: TextureManifest): Palette {
	const leaf = manifest.leaf;
	const optics =
		record.foliage.kind === 'blade' || record.foliage.kind === 'thick'
			? record.foliage.leaf.optics
			: record.foliage.kind === 'needle' || record.foliage.kind === 'fascicle'
				? record.foliage.needle.optics
				: undefined;
	const stem = manifest.bark?.young.mean ?? barkColourOf(record, manifest);
	const extras = (record.extras ?? []).map((extra) => extra.colour);
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
			profile: {
				upper: normalised(leaf.profile.upper, areas(leaf.profile.upper)),
				lower: normalised(leaf.profile.lower, areas(leaf.profile.lower)),
			},
			base,
			tip,
			mask,
			extras,
		};
	}
	return {
		upper: optics?.reflectance ?? [0.08, 0.16, 0.04],
		lower: optics?.reflectanceBack ?? optics?.reflectance ?? [0.08, 0.16, 0.04],
		stem,
		profile: undefined,
		base: 0,
		tip: 1,
		mask: undefined,
		extras,
	};
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
	const { size, rects } = layout(prototypes, record.lod.cardCell?.[detail] ?? CARD_CELL[detail]);
	const layerBytes = size * size * 4;
	const color = new Uint8Array(layerBytes * 2);
	const surface = new Uint8Array(layerBytes * 2);
	const palette = paletteOf(record, manifest);
	const cells: CardCell[] = prototypes.map((prototype, p) => {
		const mesh = prototype.tiers[BAKE_TIER] as PrototypeArrays;
		const planes = planesOf(mesh);
		return {
			planes: planes.map((plane, k) => {
				const cell = rects[p]?.[k] as [number, number, number, number];
				// The drawn area: the cell less its border.
				const rect: [number, number, number, number] = [
					cell[0] + BORDER,
					cell[1] + BORDER,
					cell[2] - 2 * BORDER,
					cell[3] - 2 * BORDER,
				];
				for (let layer = 0; layer < 2; layer++)
					drawPlane(mesh, plane, rect, size, layer, palette, color, surface);
				return {
					centre: plane.centre as unknown as CardCell['planes'][number]['centre'],
					right: plane.right as unknown as CardCell['planes'][number]['right'],
					up: plane.up as unknown as CardCell['planes'][number]['up'],
					front: rect,
					back: rect,
				};
			}),
		};
	});
	for (const set of rects)
		for (const rect of set)
			for (let layer = 0; layer < 2; layer++) {
				spread(surface, color, size, layer, rect, false);
				spread(color, color, size, layer, rect, true);
			}
	return { atlas: { size, color, surface }, cells };
}

/** Draws one face of one plane of a prototype into its cell. */
function drawPlane(
	mesh: PrototypeArrays,
	plane: { centre: number[]; right: number[]; up: number[]; normal: number[] },
	rect: [number, number, number, number],
	size: number,
	layer: number,
	palette: Palette,
	color: Uint8Array,
	surface: Uint8Array,
): void {
	const [rx, ry, rw, rh] = rect;
	const inner = [rw, rh];
	const target = rasterTarget(inner[0] as number, inner[1] as number);
	const count = mesh.positions.length / 3;
	const points = new Float64Array(count * 3);
	const rightLength = length3(...(plane.right as [number, number, number]));
	const upLength = length3(...(plane.up as [number, number, number]));
	const [rx0, rx1, rx2] = plane.right as [number, number, number];
	const [ux0, ux1, ux2] = plane.up as [number, number, number];
	const normal = plane.normal as [number, number, number];
	const halfDepth = farthest(mesh, plane.centre, normal);
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
	const [w, h] = inner as [number, number];
	for (let i = 0; i < count; i++) {
		const dx = (mesh.positions[i * 3] as number) - cx;
		const dy = (mesh.positions[i * 3 + 1] as number) - cy;
		const dz = (mesh.positions[i * 3 + 2] as number) - cz;
		points[i * 3] = ((dx * sx + dy * sy + dz * sz + 1) / 2) * w;
		points[i * 3 + 1] = ((dx * ux + dy * uy + dz * uz + 1) / 2) * h;
		points[i * 3 + 2] = -toward * (dx * normal[0] + dy * normal[1] + dz * normal[2]);
	}
	const indices = mesh.indices;
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
		let rgb: Rgb;
		if (kind === SURFACE_LEAF) {
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
		} else if (kind === SURFACE_EXTRA) {
			const index = Math.min(
				palette.extras.length - 1,
				Math.max(0, Math.floor(lerp(mesh.uvs, 2, 0) * 8)),
			);
			rgb = palette.extras[index] ?? palette.stem;
		} else rgb = palette.stem;
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
		const [ox, oy] = octahedral(tx / length, ty / length, tz / length);
		const shade = Math.round(Math.min(255, Math.max(0, lerp(mesh.colors, 4, 3))) / 2);
		const depth = Math.round(
			128 + 127 * Math.max(-1, Math.min(1, (-f.depth * toward) / halfDepth)),
		);
		const at = (layer * size * size + (ry + f.y) * size + rx + f.x) * 4;
		color[at] = srgbByte(rgb[0]);
		color[at + 1] = srgbByte(rgb[1]);
		color[at + 2] = srgbByte(rgb[2]);
		color[at + 3] = 255;
		surface[at] = ox;
		surface[at + 1] = oy;
		surface[at + 2] = depth;
		surface[at + 3] = (kind === SURFACE_LEAF ? 128 : 0) + Math.min(127, shade);
		return true;
	});
}

/** The farthest a prototype's points stand from a plane through the centre, either way. */
function farthest(mesh: PrototypeArrays, centre: number[], normal: number[]): number {
	let far = 1e-4;
	for (let i = 0; i < mesh.positions.length; i += 3) {
		const d =
			((mesh.positions[i] as number) - (centre[0] as number)) * (normal[0] as number) +
			((mesh.positions[i + 1] as number) - (centre[1] as number)) * (normal[1] as number) +
			((mesh.positions[i + 2] as number) - (centre[2] as number)) * (normal[2] as number);
		far = Math.max(far, Math.abs(d));
	}
	return far;
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
