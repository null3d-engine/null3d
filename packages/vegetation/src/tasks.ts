// The plant core's stages in a job worker, beside the frames: the kit, a variant, its nearest wood
// and its far cards. Each call sends plain data to the add-on's task (generate-task.ts) and resolves
// with the same bytes that the same call on the page's own thread would give. Each result is kept
// by its key for the page's visit, and in the store of bytes that a page kit carries across visits,
// so a second call with the same inputs grows nothing.
import { runTask, type Task } from '@null3d/engine';
import type { PlantAsset, PlantPart, SpeciesKitData } from './asset';
import { cachedResult, memoryCache, type PlantByteCache } from './core/cache';
import { formRecord } from './core/forms';
import { type GrowOptions, type KitOptions, type KitSource, kitKey, variantKey } from './generate';
import type { PlantTaskInput } from './generate-task';
import type { FarPlant } from './lod/impostor';
import type { FarBake } from './stages';

/** The add-on's task, made once, so the engine keys its worker state by one object. */
const TASK: Task = { name: 'vegetation', script: new URL('./generate-task.ts', import.meta.url) };

/** Bytes of results that the page keeps for its visit; past them, the oldest go first. */
const VISIT_BYTES = 64_000_000;

/** The page's results for its visit, by key. */
const visit = memoryCache(VISIT_BYTES);

/** The variant key that each grown variant came from, so its far bake has a key too. */
const grownFrom = new WeakMap<PlantAsset, string>();

/**
 * How a kit is built on a page: the tier, the stand-ins, and the store of bytes that keeps the
 * plant core's results across visits.
 *
 * @category api/vegetation
 */
export interface PageKitOptions extends KitOptions {
	/** A store of bytes across visits; without one, results are kept for the visit alone. */
	readonly cache?: PlantByteCache;
}

/** The store of bytes that a page kit carries, if any. */
function storeOf(kit: SpeciesKitData): PlantByteCache | undefined {
	return (kit as { readonly cache?: PlantByteCache }).cache;
}

/** A cache key's tail that keeps a kit with stand-ins apart from one without. */
const standIns = (kit: { readonly placeholders?: boolean | 'missing' }) =>
	kit.placeholders === 'missing' ? ':missing-stand-ins' : kit.placeholders ? ':stand-ins' : '';

/** Runs one stage in a job worker. */
function runStage<T>(input: PlantTaskInput): Promise<T> {
	return runTask<T>(TASK, input);
}

/**
 * Builds a species' kit in a job worker: its leaf meshes, shoot prototypes, card atlas and records
 * header, from the record of the form the options name, or from the record as it stands.
 *
 * @param source The species' record and texture manifest, such as its module.
 * @param options The tier, whether every stage grows its stand-in, the form, and the store of
 *   bytes that keeps the kit across visits.
 * @returns The kit.
 * @category api/vegetation
 */
export function buildKit(source: KitSource, options: PageKitOptions = {}): Promise<SpeciesKitData> {
	const { cache, ...kitOptions } = options;
	const manifest = source.textures.manifest;
	// The key holds the record the kit grows from, so each form keeps a kit of its own.
	const record = formRecord(source.record, kitOptions.form);
	const key = `kit:${kitKey(record, manifest, kitOptions.detail ?? 'high', kitOptions.cutting ?? false)}${standIns(kitOptions)}`;
	return cachedResult(key, visit, cache, () =>
		runStage({
			stage: 'kit',
			source: { record: source.record, textures: { manifest } },
			options: kitOptions,
		}),
	);
}

/**
 * Grows one variant in a job worker: the same work as `growPlantNow`, beside the frames.
 *
 * @param kit The species' kit.
 * @param options The seed, the variant and the season.
 * @returns The grown variant.
 * @category api/vegetation
 */
export async function growPlant(kit: SpeciesKitData, options: GrowOptions): Promise<PlantAsset> {
	const key = `grow:${variantKey(kit, options)}:${options.near === true}${standIns(kit)}`;
	const asset = await cachedResult(key, visit, storeOf(kit), () =>
		runStage<PlantAsset>({ stage: 'grow', kit: kitData(kit), options }),
	);
	grownFrom.set(asset, key);
	return asset;
}

/**
 * Meshes a variant's nearest wood in a job worker, for a variant grown without `near`.
 *
 * @param kit The species' kit.
 * @param options The options the variant grew with.
 * @returns The nearest level's wood parts, none when the plant has no wood. A large plant's wood
 *   comes in several parts of at most 65,536 vertices each.
 * @category api/vegetation
 */
export function growNearWood(
	kit: SpeciesKitData,
	options: GrowOptions,
): Promise<readonly PlantPart[]> {
	const key = `near-wood:${variantKey(kit, options)}${standIns(kit)}`;
	return cachedResult(key, visit, storeOf(kit), () =>
		runStage<readonly PlantPart[]>({ stage: 'near-wood', kit: kitData(kit), options }),
	);
}

/**
 * Bakes a variant's far cards in a job worker: the impostor atlases from its first card level.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The variant's far cards.
 * @category api/vegetation
 */
export async function bakeFarPlant(kit: SpeciesKitData, asset: PlantAsset): Promise<FarPlant> {
	const make = () => runStage<FarBake>({ stage: 'far', kit: kitData(kit), asset });
	// A variant that growPlant did not give has no key, so its bake is made each time.
	const grown = grownFrom.get(asset);
	const bake = grown ? await cachedResult(`far:${grown}`, visit, storeOf(kit), make) : await make();
	return { variant: asset.variant, bake };
}

/** A kit's plain data, without a page's GPU textures and store, which cannot cross to a worker. */
function kitData(kit: SpeciesKitData): SpeciesKitData {
	if (!('textures' in kit) && !('cache' in kit)) return kit;
	const {
		textures: _textures,
		cache: _cache,
		...data
	} = kit as SpeciesKitData & { textures?: unknown; cache?: unknown };
	return data;
}
