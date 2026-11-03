// Placing plants: meshes with their levels, copy rows, shoot batches in the near pool, impostor cards
// and their hand-over. Until placing is built, a stand-in kit's copies draw as render/stand-in.ts
// places them, and any other kit's throw.
import type { SketchContext } from '@null3d/engine';
import type { PlantAsset } from '../asset';
import { notBuilt } from '../core/not-built';
import type { FarPlant } from '../lod/impostor';
import type { PlantMaterials } from './material';
import type { NearPool } from './near-pool';
import { standInPlace } from './stand-in';
import type { SpeciesKit } from './textures';

/**
 * Where copies stand: plain arrays, one entry per copy.
 *
 * @category api/vegetation
 */
export interface PlantCopies {
	/** Copies. */
	readonly count: number;
	/** 3 per copy, world metres. */
	readonly position: Float32Array;
	/** Radians about +Y. */
	readonly turn: Float32Array;
	/** One per copy. */
	readonly scale: Float32Array;
	/** Index into the `assets` given to `placePlants`. */
	readonly variant: Uint8Array;
}

/**
 * How `placePlants` draws copies.
 *
 * @category api/vegetation
 */
export interface PlaceOptions {
	/** The species' materials. */
	readonly materials: PlantMaterials;
	/** The scene's near pool; without one, no copy draws real shoots. */
	readonly near?: NearPool;
	/** The far cards, one per variant; without them, the second card level draws to the horizon. */
	readonly far?: readonly FarPlant[];
	/** The page's render height and vertical field of view, which turn switch pixels into metres. */
	readonly view: { readonly height: number; readonly fov: number };
	/** Whether the plants cast shadows. */
	readonly castShadows?: boolean;
}

/**
 * The plants that `placePlants` drew.
 *
 * @category api/vegetation
 */
export interface PlacedPlants {
	/** Copies drawn. */
	readonly copies: number;
	/** Removes every mesh, batch and card of the placement. */
	destroy(): void;
}

/**
 * Draws copies of a species' variants: meshes with their levels, copy rows, shoot batches in the
 * near pool, impostor cards and their hand-over.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit.
 * @param assets The grown variants.
 * @param copies Where the copies stand.
 * @param options The materials, the near pool, the far cards and the view.
 * @returns The placement.
 * @category api/vegetation
 */
export function placePlants(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	options: PlaceOptions,
): PlacedPlants {
	if (kit.placeholders) return standInPlace(ctx, kit, assets, copies, options);
	throw notBuilt('placing plants');
}
