// A species on a page: its textures loaded from the preset's set in the engine's transcoder worker
// the first time a page prepares it, its kit built in a job worker, and its card atlas and records
// uploaded. Nothing loads at import time. It throws until the page side is built.
import type { SketchContext, Texture } from '@null3d/engine';
import type { SpeciesKitData } from '../asset';
import { notBuilt } from '../core/not-built';
import type { SpeciesModule } from '../core/record';
import type { Detail } from '../core/types';

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
}

/**
 * Loads a species' textures, builds its kit in a job worker, and uploads its card atlas and its
 * records.
 *
 * @param ctx The sketch's context.
 * @param module The species module, from `loadSpecies`.
 * @param options The mesh tier; the preset's by default.
 * @returns The kit.
 * @category api/vegetation
 */
export function prepareSpecies(
	ctx: SketchContext,
	module: SpeciesModule,
	options?: { readonly detail?: Detail },
): Promise<SpeciesKit> {
	void ctx;
	void module;
	void options;
	return Promise.reject(notBuilt('preparing a species on a page'));
}
