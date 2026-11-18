// The island's plants: a Mediterranean stone pine, an olive, a holm oak and an oleander. A script
// builds them in Blender (tools/samples/blender/island.py), and the asset tool optimizes them, so
// they load as a developer ships models: quantized meshes and KTX2 textures. They live in the
// sample-assets repository. Each plant has a wood part and a leaves part, each with two lower levels
// of detail, and a card part: crossed quads that carry the whole plant baked from the side and from
// above, for the far copies. The wood and the leaves carry their sway in their second texture
// coordinates, which the wind material reads.
import type { SketchContext } from '@null3d/engine';
import { type Part, partsOf } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

export const SPECIES = ['stone-pine', 'olive', 'holm-oak', 'oleander'] as const;
export type Species = (typeof SPECIES)[number];

/** One plant's parts: its swaying wood and leaves, and its far card. */
export interface Plant {
	readonly wood: Part;
	readonly leaves: Part;
	readonly card: Part;
}

/** Loads both model files at once. */
export async function loadPlants({ assets }: SketchContext): Promise<Record<Species, Plant>> {
	const [trees, shrubs] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/island/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/island/shrubs.glb')),
	]);
	const tree = partsOf(trees);
	const shrub = partsOf(shrubs);
	return Object.fromEntries(
		SPECIES.map((species) => {
			const part = species === 'oleander' ? shrub : tree;
			return [
				species,
				{
					wood: part(`${species}-wood`),
					leaves: part(`${species}-leaves`),
					card: part(`${species}-card`),
				},
			];
		}),
	) as Record<Species, Plant>;
}
