// The job-worker task of the plant core: stages C to G for the page, one request at a time. The
// engine imports this module at the add-on's address and calls `run` for each request. It holds no
// engine import, so a worker loads the generator alone, and it loads each species' growth and leaf
// code on first use, so a worker downloads only the code of the species it grows.
import {
	type PlantAsset,
	type PlantPart,
	plantAssetBuffers,
	plantPartBuffers,
	type SpeciesKitData,
} from './asset';
import {
	bakeFarNow,
	buildKitNow,
	type GrowOptions,
	growNearWoodNow,
	growPlantNow,
	type KitOptions,
	type KitSource,
	loadPlantCode,
} from './generate';
import { loadFarBaker } from './lod/impostor';
import type { FarBake } from './stages';

/**
 * One request to the task, which crosses to the worker as plain data.
 *
 * @category api/vegetation
 */
export type PlantTaskInput =
	| { readonly stage: 'kit'; readonly source: KitSource; readonly options: KitOptions }
	| { readonly stage: 'grow'; readonly kit: SpeciesKitData; readonly options: GrowOptions }
	| { readonly stage: 'near-wood'; readonly kit: SpeciesKitData; readonly options: GrowOptions }
	| { readonly stage: 'far'; readonly kit: SpeciesKitData; readonly asset: PlantAsset };

/** The task's answer: the stage's output and every buffer that moves with it. */
export interface PlantTaskOutput {
	/** The kit, the grown variant, the nearest wood or the far bake. */
	readonly output: SpeciesKitData | PlantAsset | readonly PlantPart[] | FarBake;
	/** The output's buffers, which move to the page rather than copy. */
	readonly transfer: ArrayBuffer[];
}

/**
 * The buffers of a kit, each once: what its transfer to or from the job worker hands over.
 *
 * @param kit The species' kit.
 * @returns The buffers.
 */
export function kitBuffers(kit: SpeciesKitData): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>();
	const add = (view: ArrayBufferView) => buffers.add(view.buffer as ArrayBuffer);
	for (const prototype of kit.prototypes)
		for (const tier of prototype.tiers)
			for (const view of [
				tier.positions,
				tier.normals,
				tier.uvs,
				tier.uvs1,
				tier.colors,
				tier.indices,
			])
				add(view);
	for (const leaf of kit.leaves)
		for (const view of [
			leaf.positions,
			leaf.normals,
			leaf.uvs,
			leaf.uvs1,
			leaf.colors,
			leaf.indices,
		])
			add(view);
	add(kit.cards.color);
	add(kit.cards.surface);
	add(kit.header);
	return [...buffers];
}

/**
 * Runs one stage of the plant core for the engine's job worker.
 *
 * @param input The request.
 * @returns The stage's output and the buffers to transfer.
 */
export async function run(input: unknown): Promise<PlantTaskOutput> {
	const request = input as PlantTaskInput;
	const record = request.stage === 'kit' ? request.source.record : request.kit.record;
	await loadPlantCode(record);
	switch (request.stage) {
		case 'kit': {
			const kit = buildKitNow(request.source, request.options);
			return { output: kit, transfer: kitBuffers(kit) };
		}
		case 'grow': {
			const asset = growPlantNow(request.kit, request.options);
			return { output: asset, transfer: plantAssetBuffers(asset) };
		}
		case 'near-wood': {
			const parts = growNearWoodNow(request.kit, request.options);
			return { output: parts, transfer: parts.flatMap((part) => plantPartBuffers(part)) };
		}
		case 'far': {
			await loadFarBaker();
			const far = bakeFarNow(request.kit, request.asset);
			return {
				output: far,
				transfer: [far.color.buffer as ArrayBuffer, far.surface.buffer as ArrayBuffer],
			};
		}
	}
}
