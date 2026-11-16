// The far bake: the first card level, its wood, its cards and its extras, drawn on the CPU into the
// octahedral impostor atlases that the impostors add-on's cards read. The first card level holds the
// same outline as the nearest one at a hundredth of its triangles, so it is the source.
//
// The bake draws the plant that was asked for, its own first card level, and it draws that level
// finer than the atlas stores: its grid of texels and its supersampling follow the plant's triangles,
// down and never up, so a capped plant bakes faster and a full one keeps the record's grid.
//
// The CPU cannot read the shipped KTX2 textures, so the colours come from what the kit holds: the
// cards sample the card atlas's front layer, which the kit baked on the CPU from the leaves' means
// and profiles; the wood takes its bark zone's mean colour; an extra takes its record colour. Each
// vertex's sky visibility darkens it, as the plant shader's ambient light does, so the crown's
// inside reads darker from afar. The bake is arithmetic on the arrays, so every device gets the
// same pixels.
import type { ImpostorBakePart } from '@null3d/impostors/bake';
import type { PlantAsset, PlantPart, SpeciesKitData } from '../asset';
import type { Rgb } from '../core/types';
import type { FarBake } from '../stages';
import { TEXTURE_UV_STEPS, WOOD_UV_STEPS } from './quantise';

/**
 * A variant's far cards on a page: its impostor bake, which the impostors add-on's cards draw.
 *
 * @category api/vegetation
 */
export interface FarPlant {
	/** The variant it was baked from. */
	readonly variant: number;
	/** The baked atlases. */
	readonly bake: FarBake;
}

/** The impostors add-on's CPU baker, which draws parts into the octahedral atlases. */
type AtlasBaker = typeof import('@null3d/impostors/bake').bakeImpostorAtlas;

/** The baker this thread has loaded. */
let baker: AtlasBaker | undefined;

/**
 * Loads the far baker on this thread, once. It is a lazy chunk, as the growers are, so the plant
 * core's other stages load on a thread that cannot read the impostors add-on.
 *
 * @category api/vegetation
 */
export async function loadFarBaker(): Promise<void> {
	baker ??= (await import('@null3d/impostors/bake')).bakeImpostorAtlas;
}

/**
 * The share of its colour that a vertex keeps where the crown hides all of its sky: the crown's
 * dark underside, which the far card must keep because the impostor's card is lit again without the
 * near form's shadows.
 */
const SHADED = 0.15;

/**
 * The share of its baked colour that a far texel keeps: the card the impostors add-on draws is lit
 * again by the scene's lights, so the bake carries the crown's own shade on top of its albedo. The
 * near form's cards are lit once, and this is the share that leaves the far card at the same own
 * shade the card levels show.
 */
const FAR_LIT = 0.7;

/**
 * The open-sky shares between which a clump's dim runs, from its dark core to its sunlit rim, as the
 * plant shader's own bounds: the far card reads the same record value that draws the card levels.
 */
const CROWN_SHADE_LOW = 0.15;
const CROWN_SHADE_HIGH = 0.75;

/**
 * How much of its colour a vertex keeps under the record's crown dim: a leaf or a card deep in a
 * clump takes less of the sun and of the light through it than the clump's rim does, as the plant
 * shader darkens the card and shoot roles by the row's open-sky share. At 0 the record dims nothing.
 *
 * @param kit The species' kit.
 * @param sky The vertex's open-sky share, 0 to 1.
 * @returns The share of its colour the vertex keeps.
 */
function crownShade(kit: SpeciesKitData, sky: number): number {
	const dim = kit.record.lod.crownDim ?? 0;
	if (!(dim > 0)) return 1;
	return 1 - dim * (1 - smoothstep(CROWN_SHADE_LOW, CROWN_SHADE_HIGH, sky));
}

/** The bark colour where neither the manifest nor the record names one. */
const BARK: Rgb = [0.2, 0.16, 0.12];

/** One part of the first card level in the plant's metres, as the bake draws it. */
interface LevelPart {
	readonly name: string;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	/** Fractions of the texture for cards and leaves; the wood's are not read. */
	readonly uvs: Float32Array;
	/** 4 bytes per vertex: the wind record, then a byte the part defines, then the sky visibility. */
	readonly colors: Uint8Array;
	readonly indices: Uint16Array | Uint32Array;
}

/** A drawn part's arrays back in the plant's metres, its normals as unit floats, and its uvs as fractions. */
function unpack(part: PlantPart, kit: SpeciesKitData): LevelPart {
	const a = part.arrays;
	const uvSteps = part.name === 'wood' ? WOOD_UV_STEPS : TEXTURE_UV_STEPS;
	const count = a.positions.length / 3;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	for (let i = 0; i < count * 3; i++) {
		const k = i % 3;
		const low = kit.box.min[k] as number;
		const span = (kit.box.max[k] as number) - low;
		positions[i] = low + ((a.positions[i] as number) / 65535) * span;
		normals[i] = (a.normals[i] as number) / 127;
	}
	const uvs = new Float32Array(a.uvs.length);
	for (let i = 0; i < uvs.length; i++) uvs[i] = (a.uvs[i] as number) / uvSteps;
	return { name: part.name, positions, normals, uvs, colors: a.colors, indices: a.indices };
}

/** Widens a box to hold a part's positions. */
function widen(positions: Float32Array, min: number[], max: number[]): void {
	for (let i = 0; i < positions.length; i++) {
		const k = i % 3;
		const v = positions[i] as number;
		if (v < (min[k] as number)) min[k] = v;
		if (v > (max[k] as number)) max[k] = v;
	}
}

/** Linear colours per vertex: a part's colour, darkened by the vertex's sky visibility byte. */
function shadedColours(
	kit: SpeciesKitData,
	bytes: Uint8Array,
	colour: (vertex: number) => Rgb,
): Float32Array {
	const count = bytes.length / 4;
	const out = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) {
		const sky = (bytes[v * 4 + 3] as number) / 255;
		const keep = (SHADED + (1 - SHADED) * sky) * crownShade(kit, sky) * FAR_LIT;
		const c = colour(v);
		out[v * 3] = (c[0] as number) * keep;
		out[v * 3 + 1] = (c[1] as number) * keep;
		out[v * 3 + 2] = (c[2] as number) * keep;
	}
	return out;
}

/** The mean colour of the bark a variant's far wood shows: its first zone's layer, linear. */
function barkMean(kit: SpeciesKitData): Rgb {
	const zone = kit.record.bark?.zones[0];
	const layer = zone ? kit.manifest.bark?.layers[zone.layer] : undefined;
	const mean = layer?.mean ?? kit.manifest.bark?.young.mean ?? BARK;
	const tint = zone?.tint ?? [1, 1, 1];
	return [mean[0] * tint[0], mean[1] * tint[1], mean[2] * tint[2]];
}

/** A smooth step from 0 to 1 between two edges, flat outside them. */
function smoothstep(edge0: number, edge1: number, at: number): number {
	const t = Math.max(0, Math.min(1, (at - edge0) / (edge1 - edge0 || 1e-9)));
	return t * t * (3 - 2 * t);
}

/**
 * The bark tone that a vertex at a height wears: the record's zones judged at that height and
 * blended over each band's ends as the plant shader blends them, and the nearest zone's tone where
 * no band holds the height. A crown's wood stands well above the foot, so one zone's tone for the
 * whole tree would paint the limbs in the foot's shade.
 *
 * @param kit The species' kit.
 * @returns The linear tone at a height in metres.
 */
function barkTone(kit: SpeciesKitData): (height: number) => Rgb {
	const zones = (kit.record.bark?.zones ?? []).filter((zone) => zone.by === 'height');
	if (zones.length === 0) {
		const mean = barkMean(kit);
		return () => mean;
	}
	const tones = zones.map((zone): Rgb => {
		const layer = kit.manifest.bark?.layers[zone.layer];
		const mean = layer?.mean ?? kit.manifest.bark?.young.mean ?? BARK;
		const tint = zone.tint ?? [1, 1, 1];
		return [mean[0] * tint[0], mean[1] * tint[1], mean[2] * tint[2]];
	});
	const first = zones[0] as (typeof zones)[number];
	const last = zones[zones.length - 1] as (typeof zones)[number];
	const firstTone = tones[0] as Rgb;
	const lastTone = tones[tones.length - 1] as Rgb;
	return (height: number): Rgb => {
		if (height < first.from) return firstTone;
		if (height > last.to) return lastTone;
		const sum = [0, 0, 0];
		let total = 0;
		zones.forEach((zone, at) => {
			const half = Math.max((zone.blend ?? 0) * 0.5, 0.0001);
			const weight =
				smoothstep(zone.from - half, zone.from + half, height) *
				(1 - smoothstep(zone.to - half, zone.to + half, height));
			total += weight;
			const tone = tones[at] as Rgb;
			sum[0] = (sum[0] as number) + (tone[0] as number) * weight;
			sum[1] = (sum[1] as number) + (tone[1] as number) * weight;
			sum[2] = (sum[2] as number) + (tone[2] as number) * weight;
		});
		if (total <= 1e-6) return height < first.from ? firstTone : lastTone;
		return [
			(sum[0] as number) / total,
			(sum[1] as number) / total,
			(sum[2] as number) / total,
		] as Rgb;
	};
}

/**
 * The share of a far texel's area that leaves must cover for it to draw. Cards seen from far draw
 * with alpha to coverage, so a crown's texel where a third of the area is leaf reads as crown.
 */
const FAR_SHARE = 0.3;

/**
 * How many times finer than the far atlas the bake draws, along each side. Each fine texel samples
 * the cards' full detail: one that misses a card's leaves goes on to the cards behind it, as the
 * eye's ray does. A far texel then holds the share of its fine texels that hit a leaf.
 */
const SUPERSAMPLE = 4;

/**
 * The least the bake draws a far view at, and the least rays it casts a texel: the floor. A far view
 * still meets the plant at the switch, where its height is the record's pixels, so the cell keeps
 * half the record's texels: the crown's clumps stay apart there and the bake stays cheap.
 */
export const FAR_TEXELS_LEAST = 32;
export const FAR_SUPERSAMPLE_LEAST = 1;

/**
 * The grid a plant's far atlas is baked at: the record's texels a view and the bake's supersampling,
 * scaled down with the plant's own first card level against the level's budget, and never up. A
 * plant with no maximum keeps the record's grid; a capped plant's crown holds less detail than a
 * full one's, so a smaller cell and fewer rays a texel lose nothing it shows, and the bake's time
 * follows the plant's triangles rather than the record's grid.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The texels a far view, and how many times finer the bake draws.
 * @category api/vegetation
 */
function farGrid(
	kit: SpeciesKitData,
	asset: PlantAsset,
): { readonly texels: number; readonly supersample: number } {
	const texels = asset.impostor.texels;
	if (asset.maxTriangles === undefined) return { texels, supersample: SUPERSAMPLE };
	const budget = kit.record.lod.budget.lod1Triangles;
	const own = asset.stats.triangles[1];
	if (!(budget > 0) || !(own > 0)) return { texels, supersample: SUPERSAMPLE };
	const detail = Math.sqrt(Math.min(1, own / budget));
	// A cell stays a power of two, as the atlas's mip levels expect.
	const cells = Math.max(
		FAR_TEXELS_LEAST,
		2 ** Math.floor(Math.log2(Math.max(1, texels * detail))),
	);
	return {
		texels: Math.min(texels, cells),
		supersample: Math.max(FAR_SUPERSAMPLE_LEAST, Math.round(SUPERSAMPLE * detail)),
	};
}

/** The card atlas's front layer as a coverage map whose blue holds the coverage, as the bake reads it. */
const COVERAGE = new WeakMap<Uint8Array, Uint8Array>();

function coverageOf(color: Uint8Array, texels: number): Uint8Array {
	const kept = COVERAGE.get(color);
	if (kept) return kept;
	const out = new Uint8Array(texels * 4);
	for (let t = 0; t < texels; t++) out[t * 4 + 2] = color[t * 4 + 3] as number;
	COVERAGE.set(color, out);
	return out;
}

/**
 * The far atlases at their own size from the finer bake: each far texel's coverage is the share of
 * its fine texels that drew, raised so that `FAR_SHARE` meets the cards' cutoff of one half; its
 * colour and surface are the means of the fine texels that drew.
 */
function filtered(
	fine: { readonly color: Uint8Array; readonly surface: Uint8Array },
	side: number,
	s: number,
): { readonly color: Uint8Array; readonly surface: Uint8Array } {
	const wide = side * s;
	const color = new Uint8Array(side * side * 4);
	const surface = new Uint8Array(side * side * 4);
	const sum = new Float64Array(6);
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			sum.fill(0);
			let drawn = 0;
			for (let dy = 0; dy < s; dy++)
				for (let dx = 0; dx < s; dx++) {
					const at = ((y * s + dy) * wide + x * s + dx) * 4;
					if ((fine.color[at + 3] as number) < 128) continue;
					drawn++;
					for (let k = 0; k < 3; k++) {
						sum[k] = (sum[k] as number) + (fine.color[at + k] as number);
						sum[3 + k] = (sum[3 + k] as number) + (fine.surface[at + k] as number);
					}
				}
			const at = (y * side + x) * 4;
			if (drawn === 0) continue;
			const share = drawn / (s * s);
			const alpha = Math.round(255 * Math.min(1, share / (2 * FAR_SHARE)));
			for (let k = 0; k < 3; k++) {
				color[at + k] = Math.round((sum[k] as number) / drawn);
				surface[at + k] = Math.round((sum[3 + k] as number) / drawn);
			}
			color[at + 3] = alpha;
			surface[at + 3] = alpha;
		}
	return { color, surface };
}

/**
 * Bakes a variant's impostor atlases, in a job worker or in Bun, from its first card level.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The atlases.
 * @category api/vegetation
 */
export function bakeFar(kit: SpeciesKitData, asset: PlantAsset): FarBake {
	if (!baker)
		throw new Error(
			'@null3d/vegetation: the far baker is not loaded on this thread; await loadFarBaker() first',
		);
	const views = asset.impostor.views;
	const { texels, supersample } = farGrid(kit, asset);
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const parts: ImpostorBakePart[] = [];
	const bark = barkTone(kit);
	const size = kit.cards.size;
	const cards: ImpostorBakePart[] = [];
	// The plant that was asked for draws its own first card level into the atlas.
	const level = asset.levels[1].parts.map((part) => unpack(part, kit));
	for (const part of level) {
		if (part.indices.length === 0) continue;
		const { positions, normals, uvs } = part;
		if (part.name === 'wood') {
			widen(positions, min, max);
			parts.push({
				positions,
				normals,
				colors: shadedColours(kit, part.colors, (v) => bark(positions[v * 3 + 1] as number)),
				indices: part.indices,
			});
		} else if (part.name === 'cards' && size > 0) {
			widen(positions, min, max);
			cards.push({
				positions,
				normals,
				uvs,
				colors: shadedColours(kit, part.colors, () => [1, 1, 1]),
				indices: part.indices,
				doubleSided: true,
			});
		} else if (part.name === 'extras' || part.name === 'foliage') {
			widen(positions, min, max);
			const extras = kit.record.extras ?? [];
			const bytes = part.colors;
			const leaf = kit.manifest.leaf?.mean.upper ?? [0.1, 0.2, 0.06];
			parts.push({
				positions,
				normals,
				colors: shadedColours(kit, bytes, (v) =>
					part.name === 'extras'
						? (extras[bytes[v * 4 + 2] as number]?.colour ?? leaf)
						: (leaf as Rgb),
				),
				indices: part.indices,
				doubleSided: true,
			});
		}
	}
	if (cards.length > 0) {
		const color = kit.cards.color.subarray(0, size * size * 4);
		const map = { width: size, height: size };
		for (const card of cards)
			parts.push({
				...card,
				color: { ...map, data: color },
				coverage: { ...map, data: coverageOf(color, size * size) },
			});
	}
	if (parts.length === 0 || !((max[1] as number) > (min[1] as number))) {
		// A plant with nothing at its first card level bakes an empty atlas of one texel a view.
		const side = Math.max(1, views);
		return {
			views: side,
			texels: 1,
			color: new Uint8Array(side * side * 4),
			surface: new Uint8Array(side * side * 4),
			size: [1, 1],
			room: 1,
			depth: 1,
		};
	}
	const bake = baker({
		atlas: { columns: views, rows: views },
		texels: texels * supersample,
		parts,
		min: [min[0] as number, min[1] as number, min[2] as number],
		max: [max[0] as number, max[1] as number, max[2] as number],
	});
	const far = filtered(
		{ color: bake.color.data, surface: bake.surface.data },
		views * texels,
		supersample,
	);
	return {
		views,
		texels,
		color: far.color,
		surface: far.surface,
		size: bake.size,
		room: bake.room,
		depth: bake.depth,
	};
}
