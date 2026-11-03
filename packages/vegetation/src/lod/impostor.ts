// The far bake: the first card level, its wood and its cards, baked on the CPU into the octahedral
// impostor atlases, from the card atlas's pixels and the bark layers' mean colours. The first card
// level holds the same silhouette as the nearest one at a hundredth of its triangles. It throws until
// the far bake is built.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { notBuilt } from '../core/not-built';
import type { FarBake } from '../stages';

/**
 * A variant's far cards on a page: its impostor bake, which the impostors add-on's cards draw.
 *
 * @category api/vegetation
 */
export interface FarPlant {
	/** The variant it was baked from. */
	readonly variant: number;
	/** The baked atlases. */
	readonly bake: FarBake;
}

/**
 * Bakes a variant's impostor atlases, in a job worker or in Bun.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The atlases.
 */
export function bakeFar(kit: SpeciesKitData, asset: PlantAsset): FarBake {
	void kit;
	void asset;
	throw notBuilt('the far bake');
}
