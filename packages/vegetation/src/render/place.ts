// Placing plants: meshes with their levels, copy rows, shoot batches in the near pool, impostor cards
// and their hand-over. A stand-in kit's copies draw as render/stand-in.ts places them. A real kit's
// copies draw at fixed places, as render/static-shoots.ts places them, with their pieces in the near
// pool when the page gives one (render/pooled-shoots.ts).
import type { SketchContext } from '@null3d/engine';
import type { PlantAsset } from '../asset';
import type { PlantView } from '../lod/drawn';
import type { FarPlant } from '../lod/impostor';
import type { PlantMaterials } from './material';
import { isPoolHost, type NearPool } from './near-pool';
import { standInPlace } from './stand-in';
import { placeStaticPlants } from './static-shoots';
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

export type { PlantView };

/**
 * How `placePlants` draws copies.
 *
 * @category api/vegetation
 */
export interface PlaceOptions {
	/** The species' materials. */
	readonly materials: PlantMaterials;
	/**
	 * The scene's near pool, its budget of real pieces: the nearest copies of every placement that
	 * joins it draw their pieces while the budget lasts. Without one, a placement's first copies, up
	 * to the species' near slots, draw their shoots to the switch.
	 */
	readonly near?: NearPool;
	/** The far cards, one per variant; without them, the second card level draws to the horizon. */
	readonly far?: readonly FarPlant[];
	/** The page's view: its render height, its field of view and its switch bias. */
	readonly view: PlantView;
	/** Whether the plants cast shadows. */
	readonly castShadows?: boolean;
}

export { switchScale } from '../lod/drawn';

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
	if (kit.placeholders === true) return standInPlace(ctx, kit, assets, copies, options);
	if (options.near && !isPoolHost(options.near))
		throw new Error('@null3d/vegetation: a real kit needs a near pool made without placeholders.');
	return placeStaticPlants(ctx, kit, assets, copies, options);
}
