// A species on a page: its textures loaded from the preset's set, the half set on Low, in the
// engine's transcoder worker the first time a page prepares it; its kit built in a job worker; and
// its card atlas, its records and its near table uploaded. Nothing loads at import time, and a page
// fetches the files of the species it prepares and of no other. A page that asks for
// `placeholders: true` gets the stand-in kit of render/stand-in.ts, which loads no texture file.
import type { QualityPreset, SketchContext, Texture } from '@null3d/engine';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { type CoarsenessOptions, checkCoarseness } from '../coarseness';
import type { PlantByteCache } from '../core/cache';
import type { SpeciesModule } from '../core/record';
import type { SpeciesTextureFiles, TextureSet } from '../core/textures';
import type { Detail } from '../core/types';
import { buildKit } from '../tasks';
import { VARIANT_RECORDS } from '../wind/records';
import { RECORDS_WIDTH, recordsRows, writeSteadyWind, writeWindRecords } from './records';
import { standInPrepare } from './stand-in';

/**
 * A species' textures on the GPU, made by `prepareSpecies` from the preset's set.
 *
 * @category api/vegetation
 */
export interface SpeciesTextures {
	/** The set it loaded: full, or half on Low. */
	readonly set: 'full' | 'half';
	/** The leaf colour array. */
	readonly leafColor: Texture;
	/** The leaf normal array. */
	readonly leafNormal: Texture;
	/** The bark colour array. */
	readonly barkColor: Texture;
	/** The bark normal array. */
	readonly barkNormal: Texture;
	/** Young bark colour. */
	readonly youngColor: Texture;
	/** Young bark normal. */
	readonly youngNormal: Texture;
	/** Made on the CPU: layer 0 holds the front faces' cells, layer 1 the back faces'. */
	readonly cardColor: Texture;
	/** The card surface: normal, depth and thickness, in the same layers. */
	readonly cardSurface: Texture;
	/** Header rows, then every variant's wind records. */
	readonly records: Texture;
	/** The near pool's slot table for this species. */
	readonly near: Texture;
	/** Their bytes on the GPU. */
	readonly bytes: number;
}

/**
 * The kit on a page: its data and its GPU textures.
 *
 * @category api/vegetation
 */
export interface SpeciesKit extends SpeciesKitData {
	/** Its textures on the GPU. */
	readonly textures: SpeciesTextures;
	/** The store of bytes that keeps its variants and far bakes across visits, if the page gave one. */
	readonly cache?: PlantByteCache;
}

/**
 * How `prepareSpecies` prepares a species. Its coarseness options are the default of every variant
 * that `growPlant` grows from the kit.
 *
 * @category api/vegetation
 */
export interface PrepareOptions extends CoarsenessOptions {
	/** The mesh tier; the preset's by default. */
	readonly detail?: Detail;
	/**
	 * Grow the stand-in of every stage with `true`, loading no texture file; or with `'missing'`,
	 * load the species' textures and grow a stand-in only for each stage that is not built yet.
	 */
	readonly placeholders?: boolean | 'missing';
	/**
	 * One of the species' other forms by name, such as `young` or `woodland`, which every variant of
	 * the kit grows in. The species' record as it stands when not given.
	 */
	readonly form?: string;
	/**
	 * A store of bytes that keeps the kit, its variants and its far bakes across visits, such as the
	 * engine's cache of derived data. Without one, they are kept in memory for the visit alone.
	 */
	readonly cache?: PlantByteCache;
	/**
	 * Build a cutting kit: the classes its cut pieces draw and no card levels, so a piece that is
	 * only ever drawn close up does not pay for the crown's cards or for the classes it never uses.
	 */
	readonly cutting?: boolean;
}

/** Slots in a species' near table: the copies that may draw real shoots at once. */
export const NEAR_SLOTS = 16;

/** Texels a near slot takes: the position's high halves and the turn, then the remainders and the scale. */
export const NEAR_SLOT_TEXELS = 2;

/** The set of texture files that a preset loads: the half set on Low, the full set elsewhere. */
export function textureSetFor(preset: QualityPreset): 'full' | 'half' {
	return preset === 'low' ? 'half' : 'full';
}

/** One white texel, as an array of one layer or as a 2D texture: what a slot with no file samples. */
function white(ctx: SketchContext, array: boolean): Texture {
	return ctx.textures.fromData({
		width: 1,
		height: 1,
		...(array && { depth: 1 }),
		data: new Uint8Array([255, 255, 255, 255]),
		colorSpace: 'linear',
	});
}

/** The six texture slots of a set, how each loads, and whether it is an array. */
const SLOTS = [
	{ name: 'leafColor', colorSpace: 'srgb', wrap: 'clamp', array: true, anisotropy: 4 },
	{ name: 'leafNormal', colorSpace: 'linear', wrap: 'clamp', array: true, anisotropy: 4 },
	{ name: 'barkColor', colorSpace: 'srgb', wrap: 'repeat', array: true, anisotropy: 8 },
	{ name: 'barkNormal', colorSpace: 'linear', wrap: 'repeat', array: true, anisotropy: 8 },
	{ name: 'youngColor', colorSpace: 'srgb', wrap: 'repeat', array: false, anisotropy: 8 },
	{ name: 'youngNormal', colorSpace: 'linear', wrap: 'repeat', array: false, anisotropy: 8 },
] as const;

/** The six textures of a set that a page loads. */
type LoadedSet = Pick<SpeciesTextures, (typeof SLOTS)[number]['name']>;

/**
 * Loads one set of a species' texture files in the engine's transcoder worker. A slot whose file
 * the set does not name samples white.
 *
 * @param ctx The sketch's context.
 * @param files The species' texture files.
 * @param set Which set.
 * @returns The six textures.
 */
export async function loadTextureSet(
	ctx: SketchContext,
	files: SpeciesTextureFiles,
	set: 'full' | 'half',
): Promise<LoadedSet> {
	const urls: TextureSet = files[set];
	const loaded = await Promise.all(
		SLOTS.map((slot) => {
			const url = urls[slot.name];
			return url
				? ctx.assets.loadTexture(url, {
						colorSpace: slot.colorSpace,
						wrap: slot.wrap,
						anisotropy: slot.anisotropy,
					})
				: Promise.resolve(white(ctx, slot.array));
		}),
	);
	return Object.fromEntries(SLOTS.map((slot, i) => [slot.name, loaded[i]])) as unknown as LoadedSet;
}

/** The CPU copy of each records texture, which wind records and the field's settings write into. */
const RECORDS = new WeakMap<Texture, Float32Array>();

/**
 * Makes a species' records texture: its header rows, room for every variant's wind records, and
 * the wind field's steady settings once a material names a field.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit data.
 * @returns The texture.
 */
export function recordsTexture(ctx: SketchContext, kit: SpeciesKitData): Texture {
	const rows = recordsRows(Math.max(1, kit.record.variants), VARIANT_RECORDS);
	const data = new Float32Array(rows * RECORDS_WIDTH * 4);
	data.set(kit.header.subarray(0, Math.min(kit.header.length, data.length)));
	const texture = ctx.textures.fromData({
		width: RECORDS_WIDTH,
		height: rows,
		format: 'rgba16float',
		data,
	});
	RECORDS.set(texture, data);
	return texture;
}

/** The CPU copy of a records texture that `recordsTexture` made. */
function recordsData(records: Texture): Float32Array {
	const data = RECORDS.get(records);
	if (!data) throw new Error('the records texture was not made by recordsTexture');
	return data;
}

/**
 * Puts the wind records of grown variants into their species' records texture, at their global
 * ids, so the materials sway them. Call it once a variant has grown, before it draws.
 *
 * @param kit The species' kit.
 * @param assets The grown variants.
 */
export function writePlantWind(kit: SpeciesKit, assets: readonly PlantAsset[]): void {
	const data = recordsData(kit.textures.records);
	for (const asset of assets)
		if (!writeWindRecords(data, asset.wind))
			throw new Error(
				`the wind records of ${asset.species} variant ${asset.variant} pass the records texture`,
			);
	kit.textures.records.update(data);
}

/**
 * Puts the wind field's steady settings into a records texture, which the materials read beyond
 * the field's box.
 *
 * @param records The species' records texture.
 * @param air The field's settings.
 */
export function writeFieldSettings(
	records: Texture,
	air: Parameters<typeof writeSteadyWind>[1],
): void {
	const data = recordsData(records);
	writeSteadyWind(data, air);
	records.update(data);
}

/** The card atlas's two layers as textures, or white where the species has no cards. */
function cardTextures(
	ctx: SketchContext,
	kit: SpeciesKitData,
): Pick<SpeciesTextures, 'cardColor' | 'cardSurface'> {
	const size = kit.cards.size;
	if (size <= 0) return { cardColor: white(ctx, true), cardSurface: white(ctx, true) };
	const layer = (bytes: Uint8Array, colorSpace: 'srgb' | 'linear') =>
		ctx.textures.fromData({
			width: size,
			height: size,
			depth: 2,
			data: bytes.subarray(0, size * size * 8),
			colorSpace,
			wrap: 'clamp',
			mipmaps: true,
		});
	return {
		cardColor: layer(kit.cards.color, 'srgb'),
		cardSurface: layer(kit.cards.surface, 'linear'),
	};
}

/**
 * The textures of a kit on a page: a loaded set, the card atlas, the records and an empty near
 * table.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit data.
 * @param set Which set the textures came from.
 * @param loaded The loaded set.
 * @returns The textures.
 */
export function kitTextures(
	ctx: SketchContext,
	kit: SpeciesKitData,
	set: 'full' | 'half',
	loaded: LoadedSet,
): SpeciesTextures {
	const cards = cardTextures(ctx, kit);
	const records = recordsTexture(ctx, kit);
	const near = ctx.textures.fromData({
		width: NEAR_SLOTS * NEAR_SLOT_TEXELS,
		height: 1,
		format: 'rgba16float',
		filter: 'nearest',
		data: new Float32Array(NEAR_SLOTS * NEAR_SLOT_TEXELS * 4),
	});
	const all = { ...loaded, ...cards, records, near };
	const bytes = Object.values(all).reduce((sum, texture) => sum + texture.bytes, 0);
	return { set, ...all, bytes };
}

/**
 * Loads a species' textures, builds its kit in a job worker, and uploads its card atlas and its
 * records. The textures load from the preset's set, the half set on Low, the first time a page
 * prepares the species, and the kit builds alongside them.
 *
 * @param ctx The sketch's context.
 * @param module The species module, from `loadSpecies`.
 * @param options The mesh tier, the variants' coarseness, the stand-ins, the form and the store of
 *   bytes across visits.
 * @returns The kit.
 * @category api/vegetation
 */
export async function prepareSpecies(
	ctx: SketchContext,
	module: SpeciesModule,
	options?: PrepareOptions,
): Promise<SpeciesKit> {
	if (options) checkCoarseness(options);
	if (options?.placeholders === true) return standInPrepare(ctx, module, options);
	const set = textureSetFor(ctx.quality.preset);
	const [loaded, kit] = await Promise.all([
		loadTextureSet(ctx, module.textures, set),
		buildKit(module, {
			detail: options?.detail ?? ctx.quality.preset,
			...(options?.placeholders === 'missing' && { placeholders: 'missing' as const }),
			...(options?.form !== undefined && { form: options.form }),
			...(options?.cache && { cache: options.cache }),
			...(options?.cutting && { cutting: true }),
		}),
	]);
	const textures = kitTextures(ctx, kit, set, loaded);
	return {
		...kit,
		textures,
		...(options?.cache && { cache: options.cache }),
		...(options?.coarseness !== undefined && { coarseness: options.coarseness }),
		...(options?.triangles !== undefined && { triangles: options.triangles }),
	};
}
