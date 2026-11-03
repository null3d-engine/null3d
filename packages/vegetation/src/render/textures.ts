// A species on a page: its textures loaded from the preset's set in the engine's transcoder worker
// the first time a page prepares it, its kit built in a job worker, and its card atlas and records
// uploaded. Nothing loads at import time. Until the textures and the records upload are built, a
// page that asks for `placeholders` gets the stand-in kit of render/stand-in.ts, and any other
// page an error.
import type { SketchContext, Texture } from '@null3d/engine';
import type { SpeciesKitData } from '../asset';
import type { PlantByteCache } from '../core/cache';
import { notBuilt } from '../core/not-built';
import type { SpeciesModule } from '../core/record';
import type { Detail } from '../core/types';
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
 * How `prepareSpecies` prepares a species.
 *
 * @category api/vegetation
 */
export interface PrepareOptions {
	/** The mesh tier; the preset's by default. */
	readonly detail?: Detail;
	/** Grow a stand-in for each stage that is not built yet. */
	readonly placeholders?: boolean;
	/**
	 * A store of bytes that keeps the kit, its variants and its far bakes across visits, such as the
	 * engine's cache of derived data. Without one, they are kept in memory for the visit alone.
	 */
	readonly cache?: PlantByteCache;
}

/**
 * Loads a species' textures, builds its kit in a job worker, and uploads its card atlas and its
 * records.
 *
 * @param ctx The sketch's context.
 * @param module The species module, from `loadSpecies`.
 * @param options The mesh tier, the stand-ins and the store of bytes across visits.
 * @returns The kit.
 * @category api/vegetation
 */
export function prepareSpecies(
	ctx: SketchContext,
	module: SpeciesModule,
	options?: PrepareOptions,
): Promise<SpeciesKit> {
	if (options?.placeholders) return standInPrepare(ctx, module, options);
	return Promise.reject(notBuilt('preparing a species on a page'));
}
