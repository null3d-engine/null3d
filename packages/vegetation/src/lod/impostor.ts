// The far bake: the first card level, its wood, its cards and its extras, drawn on the CPU into the
// octahedral impostor atlases that the impostors add-on's cards read. The first card level holds the
// same outline as the nearest one at a hundredth of its triangles, so it is the source.
//
// The CPU cannot read the shipped KTX2 textures, so the colours come from what the kit holds: the
// cards sample the card atlas's front layer, which the kit baked on the CPU from the leaves' means
// and profiles; the wood takes its bark zone's mean colour; an extra takes its record colour. Each
// vertex's sky visibility darkens it, as the plant shader's ambient light does, so the crown's
// inside reads darker from afar. The bake is arithmetic on the arrays, so every device gets the
// same pixels.
import type { ImpostorBakePart } from '@null3d/impostors/bake';
import type { MeshArrays, PlantAsset, PlantPart, SpeciesKitData } from '../asset';
import type { Rgb } from '../core/types';
import { lightCrown } from '../crown/visibility';
import { GREAT_LIMB_SHARE, woodParts } from '../grow/sparse';
import type { DressInput, FarBake, MeshInput } from '../stages';
import { levelBuild } from './budget';
import { quantiseParts, TEXTURE_UV_STEPS, WOOD_UV_STEPS } from './quantise';

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

/** The share of its colour that a vertex keeps where the crown hides all of its sky. */
const SHADED = 0.4;

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

/**
 * The first card level as the plant's best look draws it, rebuilt from a grown asset: its wood, its
 * cards, its merged foliage and its extras, with the crown lit again on a copy of the rows, so the
 * sky visibility each vertex carries is the drawn level's, and each part quantised as the asset's
 * own parts are. A triangle maximum thins the level the asset draws, but the far card is two
 * triangles whatever it shows, so it pictures the best look.
 */
function bestFirstLevel(kit: SpeciesKitData, asset: PlantAsset): LevelPart[] {
	const dress: DressInput = {
		record: kit.record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
	};
	const rows = { ...asset.shoots, sky: asset.shoots.sky.slice(), bent: asset.shoots.bent.slice() };
	const mesh: MeshInput = { ...dress, rows, crown: lightCrown(dress, rows), detail: kit.detail };
	const limbs = kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE;
	const build = levelBuild({ mesh, parts: woodParts(asset.skeleton, limbs), wood: false }, 1);
	const parts: LevelPart[] = [];
	const add = (name: PlantPart['name'], arrays: MeshArrays | undefined, rest = false): void => {
		if (!arrays || arrays.indices.length === 0) return;
		const steps = name === 'wood' ? WOOD_UV_STEPS : TEXTURE_UV_STEPS;
		for (const quantised of quantiseParts(arrays, kit.box, steps, rest))
			parts.push(unpack({ name, arrays: quantised }, kit));
	};
	add('wood', build.wood);
	add('foliage', build.foliage);
	add('cards', build.cards);
	// Fruit and cones are quantised in finer steps, as the asset's own extras are.
	add('extras', build.extras, true);
	return parts;
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
function shadedColours(bytes: Uint8Array, colour: (vertex: number) => Rgb): Float32Array {
	const count = bytes.length / 4;
	const out = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) {
		const sky = (bytes[v * 4 + 3] as number) / 255;
		const keep = SHADED + (1 - SHADED) * sky;
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
): { readonly color: Uint8Array; readonly surface: Uint8Array } {
	const s = SUPERSAMPLE;
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
	const texels = asset.impostor.texels;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const parts: ImpostorBakePart[] = [];
	const bark = barkMean(kit);
	const size = kit.cards.size;
	const cards: ImpostorBakePart[] = [];
	const level =
		asset.maxTriangles === undefined
			? asset.levels[1].parts.map((part) => unpack(part, kit))
			: bestFirstLevel(kit, asset);
	for (const part of level) {
		if (part.indices.length === 0) continue;
		const { positions, normals, uvs } = part;
		if (part.name === 'wood') {
			widen(positions, min, max);
			parts.push({
				positions,
				normals,
				colors: shadedColours(part.colors, () => bark),
				indices: part.indices,
			});
		} else if (part.name === 'cards' && size > 0) {
			widen(positions, min, max);
			cards.push({
				positions,
				normals,
				uvs,
				colors: shadedColours(part.colors, () => [1, 1, 1]),
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
				colors: shadedColours(bytes, (v) =>
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
		texels: texels * SUPERSAMPLE,
		parts,
		min: [min[0] as number, min[1] as number, min[2] as number],
		max: [max[0] as number, max[1] as number, max[2] as number],
	});
	const far = filtered({ color: bake.color.data, surface: bake.surface.data }, views * texels);
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
