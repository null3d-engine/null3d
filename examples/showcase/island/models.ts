// The island's plants: a Mediterranean cypress, stone pine, an olive, a holm oak and an oleander.
// A script builds them in Blender (tools/samples/blender/island.py), and the asset tool optimizes
// them, so they load as a developer ships models: quantized meshes and KTX2 textures. They live in
// the sample-assets repository. Each plant has a wood part and a leaves part, each with two lower
// levels of detail, and a card part: crossed quads that carry the whole plant baked from the side
// and from above, for the far copies. The wood and the leaves carry their sway in their second
// texture coordinates, which the wind material reads.
//
// The cypress joined the trees file after the other plants. A trees file that predates it leaves the
// scene on its own code-built spires, so the demo runs before the file is republished.
import type { SketchContext } from '@null3d/engine';
import { type Part, partsOf } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

/** The plants that the model files always carry, and that the scene cannot stand without. */
export const SPECIES = ['stone-pine', 'olive', 'holm-oak', 'oleander'] as const;
export type Species = (typeof SPECIES)[number];

/** Every plant that the scene stands, the cypress included. */
export type PlantKind = Species | 'cypress';

/** One plant's parts: its swaying wood and leaves, and its far card. */
export interface Plant {
	readonly wood: Part;
	readonly leaves: Part;
	readonly card: Part;
}

/** The plants of both files, and the cypress when the trees file carries one. */
export interface Plants {
	readonly species: Record<Species, Plant>;
	/** The cypress, or undefined while the loaded trees file has none. */
	readonly cypress: Plant | undefined;
}

/** One plant's parts, or undefined when the file does not carry every one of them. */
function optionalPlant(part: (name: string) => Part, name: string): Plant | undefined {
	const found = [`${name}-wood`, `${name}-leaves`, `${name}-card`].map((id) => {
		try {
			return part(id);
		} catch {
			return undefined;
		}
	});
	const [wood, leaves, card] = found;
	return wood && leaves && card ? { wood, leaves, card } : undefined;
}

/** Loads both model files at once. */
export async function loadPlants({ assets }: SketchContext): Promise<Plants> {
	const [trees, shrubs] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/island/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/island/shrubs.glb')),
	]);
	const tree = partsOf(trees);
	const shrub = partsOf(shrubs);
	const species = Object.fromEntries(
		SPECIES.map((name) => {
			const part = name === 'oleander' ? shrub : tree;
			return [
				name,
				{ wood: part(`${name}-wood`), leaves: part(`${name}-leaves`), card: part(`${name}-card`) },
			];
		}),
	) as Record<Species, Plant>;
	return { species, cypress: optionalPlant(tree, 'cypress') };
}
