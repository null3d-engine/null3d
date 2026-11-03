// The task module that grows plants in a job worker. The engine imports it at the add-on's address
// and calls `run` once for each request. It holds no engine import, so a worker loads the generator
// alone.
import type { PlantAsset } from './asset';
import { generatePlant, partBuffers } from './generate';
import type { Species } from './species';

/** One request for a plant, which crosses to the worker as plain data. */
export interface GenerateInput {
	/** The species record. */
	readonly species: Species;
	/** The scene's seed. */
	readonly seed: number;
	/** The variant's index. */
	readonly variant?: number;
	/** The detail levels to build. */
	readonly levels?: number;
}

/** The worker's answer: the plant and every buffer that moves with it. */
export interface GenerateOutput {
	/** The grown plant. */
	readonly output: PlantAsset;
	/** The arrays' buffers, which move to the page rather than copy. */
	readonly transfer: ArrayBuffer[];
}

/**
 * Grows one plant for the engine's job worker.
 *
 * @param input The request: a species record, a seed and a variant.
 * @returns The plant and the buffers to transfer.
 */
export function run(input: unknown): GenerateOutput {
	const request = input as GenerateInput;
	const asset = generatePlant(request.species, {
		seed: request.seed,
		variant: request.variant,
		levels: request.levels,
	});
	const transfer: ArrayBuffer[] = [];
	for (const level of asset.levels)
		for (const part of level.parts) transfer.push(...partBuffers(part.arrays));
	transfer.push(asset.wind.pivots.buffer as ArrayBuffer);
	return { output: asset, transfer };
}
