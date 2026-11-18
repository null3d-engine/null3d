// The creek's organic models: three broadleaf trees, four plants for the banks and the cave mouth.
// A script builds them in Blender (tools/samples/blender/creek.py), and the asset tool optimizes
// them, so they load as a developer ships models: quantized meshes and KTX2 textures. They live in
// the sample-assets repository. Each tree has a wood part and a leaves part, each with two lower
// levels of detail, and each plant and the cave is one part. Leaves are cards whose texture cuts
// their outline. The trees and plants carry their sway in their second texture coordinates, which
// the wind material reads.
import type { SketchContext } from '@null3d/engine';
import { type Part, partsOf } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

export const TREE_KINDS = ['oak', 'beech', 'birch'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
export const PLANT_KINDS = ['fern', 'hosta', 'shrub', 'flowers'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

export interface Models {
	trees: Record<TreeKind, { wood: Part; leaves: Part }>;
	plants: Record<PlantKind, Part>;
	cave: Part;
}

/** Loads the three model files at once. */
export async function loadModels({ assets }: SketchContext): Promise<Models> {
	const [trees, plants, cave] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/creek/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/plants.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/cave.glb')),
	]);
	const tree = partsOf(trees);
	const plant = partsOf(plants);
	return {
		trees: Object.fromEntries(
			TREE_KINDS.map((kind) => [
				kind,
				{ wood: tree(`${kind}-wood`), leaves: tree(`${kind}-leaves`) },
			]),
		) as Models['trees'],
		plants: Object.fromEntries(PLANT_KINDS.map((kind) => [kind, plant(kind)])) as Models['plants'],
		cave: partsOf(cave)('cave'),
	};
}
