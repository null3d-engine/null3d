// Placing plants: meshes with their levels, copy rows, shoot batches in the near pool, impostor cards
// and their hand-over. A stand-in kit's copies draw as render/stand-in.ts places them. A real kit's
// copies draw at fixed places with their shoots composed once, as render/static-shoots.ts places
// them, until the near pool is built.
import type { SketchContext } from '@null3d/engine';
import type { PlantAsset } from '../asset';
import { pow } from '../core/math';
import { notBuilt } from '../core/not-built';
import type { FarPlant } from '../lod/impostor';
import type { PlantMaterials } from './material';
import type { NearPool } from './near-pool';
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

/**
 * The page's view, which turns every species' switch pixels into metres. A page gives one view to
 * every `placePlants` call, so its switch bias moves the level switches of all its species at once.
 *
 * @category api/vegetation
 */
export interface PlantView {
	/** The page's render height in pixels. */
	readonly height: number;
	/** The camera's vertical field of view in degrees. */
	readonly fov: number;
	/**
	 * Stops by which every level switch moves nearer: each switch distance is multiplied by two to the
	 * power of minus the bias. 1 switches at half the distance, -1 at twice it, 0 as the species
	 * gives. 0 by default.
	 */
	readonly switchBias?: number;
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
	/** The page's view: its render height, its field of view and its switch bias. */
	readonly view: PlantView;
	/** Whether the plants cast shadows. */
	readonly castShadows?: boolean;
}

/**
 * The factor that a page's distance-switch bias gives every switch distance: two to the power of
 * minus the bias, so a bias of 1 switches each level at half the distance and -1 at twice it.
 *
 * @param bias The bias in stops; 0 leaves every distance as it is.
 * @returns The factor.
 * @category api/vegetation
 */
export function switchScale(bias = 0): number {
	if (!Number.isFinite(bias))
		throw new Error(`@null3d/vegetation: a switch bias of ${bias} is not a number of stops.`);
	return bias === 0 ? 1 : pow(2, -bias);
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
	if (kit.placeholders === true) return standInPlace(ctx, kit, assets, copies, options);
	if (options.near) throw notBuilt('placing plants in a near pool');
	return placeStaticPlants(ctx, kit, assets, copies, options);
}
