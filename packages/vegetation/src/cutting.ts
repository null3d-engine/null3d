// Cuttings: one piece of a plant drawn as a plant of its own, for close review beside the reference
// set's studio stills. The options are the core's; the extraction of a piece from a grown variant
// belongs to the self-organizing growth's work and is not built yet.
import type { PlantAsset, SpeciesKitData } from './asset';
import { notBuilt } from './core/not-built';

/**
 * The piece a cutting takes.
 *
 * @category api/vegetation
 */
export type CuttingPart = 'branch' | 'subbranch' | 'cluster' | 'leaf';

/**
 * One piece of a plant as a plant of its own: a branch about 1 m long, a sub-branch about 0.35 m, a
 * leaf cluster, or one leaf.
 *
 * - 'leaf': one leaf mesh of the species (front and back faces), at the nearest level.
 * - 'cluster': a shoot prototype, chosen by `pick` among the classes in vigor order. A 'merged'
 *   species cuts a group of leaflets on a rachis (palm), or blades at the collar (grass).
 * - 'subbranch', 'branch': the subtree of a macro axis of the hinted order whose extent is nearest
 *   `length`, cut there, with its shoot rows merged into one foliage part.
 *
 * Candidates rank by length match, then by light, so pick 0 is a full sunlit piece. The asset has
 * the nearest level only, its own wind records, and no impostor.
 *
 * @category api/vegetation
 */
export interface CuttingOptions {
	/** The piece to cut. */
	readonly part: CuttingPart;
	/** Metres from the cut to the farthest tip; 1.0, 0.35 and 0.15 by default. */
	readonly length?: number;
	/** The candidate to take, 0 for the best. */
	readonly pick?: number;
	/** 'upright' stands the piece on its cut, as the studio stills do; 'as-grown' keeps its pose. */
	readonly orient?: 'upright' | 'as-grown';
	/** For 'leaf': the face toward +Z. */
	readonly face?: 'upper' | 'lower';
}

/**
 * The default length of each piece, in metres.
 *
 * @category api/vegetation
 */
export const CUTTING_LENGTH: Readonly<Record<CuttingPart, number>> = {
	branch: 1,
	subbranch: 0.35,
	cluster: 0.15,
	leaf: 0.15,
};

/**
 * Cuts one piece from a grown variant, as an asset of its own.
 *
 * @param kit The species' kit.
 * @param asset The whole grown variant.
 * @param cutting The piece to cut.
 * @returns The piece's asset.
 * @category api/vegetation
 */
export function cutPlant(
	kit: SpeciesKitData,
	asset: PlantAsset,
	cutting: CuttingOptions,
): PlantAsset {
	// The self-organizing growth's work builds the extraction.
	void kit;
	void asset;
	void cutting;
	throw notBuilt('cutting a piece from a plant');
}
