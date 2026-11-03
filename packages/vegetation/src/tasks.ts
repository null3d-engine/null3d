// The plant core's stages in a job worker, beside the frames: the kit, a variant, its nearest wood
// and its far cards. Each call sends plain data to the add-on's task (generate-task.ts) and resolves
// with the same bytes that the same call on the page's own thread would give.
import { runTask, type Task } from '@null3d/engine';
import type { PlantAsset, PlantPart, SpeciesKitData } from './asset';
import type { GrowOptions, KitOptions, KitSource } from './generate';
import type { PlantTaskInput } from './generate-task';
import type { FarPlant } from './lod/impostor';
import type { FarBake } from './stages';

/** The add-on's task, made once, so the engine keys its worker state by one object. */
const TASK: Task = { name: 'vegetation', script: new URL('./generate-task.ts', import.meta.url) };

/** Runs one stage in a job worker. */
function runStage<T>(input: PlantTaskInput): Promise<T> {
	return runTask<T>(TASK, input);
}

/**
 * Builds a species' kit in a job worker: its leaf meshes, shoot prototypes, card atlas and records
 * header.
 *
 * @param source The species' record and texture manifest, such as its module.
 * @param options The tier, and whether stages that are not built yet grow stand-ins.
 * @returns The kit.
 * @category api/vegetation
 */
export function buildKit(source: KitSource, options: KitOptions = {}): Promise<SpeciesKitData> {
	return runStage({
		stage: 'kit',
		source: { record: source.record, textures: { manifest: source.textures.manifest } },
		options,
	});
}

/**
 * Grows one variant in a job worker: the same work as `growPlantNow`, beside the frames.
 *
 * @param kit The species' kit.
 * @param options The seed, the variant and the season.
 * @returns The grown variant.
 * @category api/vegetation
 */
export function growPlant(kit: SpeciesKitData, options: GrowOptions): Promise<PlantAsset> {
	return runStage({ stage: 'grow', kit: kitData(kit), options });
}

/**
 * Meshes a variant's nearest wood in a job worker, for a variant grown without `near`.
 *
 * @param kit The species' kit.
 * @param options The options the variant grew with.
 * @returns The nearest level's wood part, or undefined when the plant has none.
 * @category api/vegetation
 */
export function growNearWood(
	kit: SpeciesKitData,
	options: GrowOptions,
): Promise<PlantPart | undefined> {
	return runStage({ stage: 'near-wood', kit: kitData(kit), options });
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
	const bake = await runStage<FarBake>({ stage: 'far', kit: kitData(kit), asset });
	return { variant: asset.variant, bake };
}

/** A kit's plain data, without a page's GPU textures, which cannot cross to a worker. */
function kitData(kit: SpeciesKitData): SpeciesKitData {
	if (!('textures' in kit)) return kit;
	const { textures: _textures, ...data } = kit as SpeciesKitData & { textures: unknown };
	return data;
}
