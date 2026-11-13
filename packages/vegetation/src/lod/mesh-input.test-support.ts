// The meshing input of a grown variant, as the card levels and the wood mesher read it, for tests
// that ask a level's rules about a plant they grew.
import type { PlantAsset, SpeciesKitData } from '../asset';
import type { MeshInput } from '../stages';

/**
 * The meshing input of a grown variant, with an open crown: the light moves no vertex.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The input.
 */
export function assetMeshInput(kit: SpeciesKitData, asset: PlantAsset): MeshInput {
	const { min, max } = asset.skeleton.bounds;
	return {
		record: kit.record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		crown: {
			cells: [1, 1, 1] as const,
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail: kit.detail,
	};
}
