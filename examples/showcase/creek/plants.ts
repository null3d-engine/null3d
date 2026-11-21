// The garden's trees and ground cover: the Blender models of the pines and of today's ferns and
// hostas, standing where `valley.ts` places them, each kind one instance batch per part, so every
// copy picks its own level of detail. They sway in the scene's one wind field through the shared
// wind material, which reads each vertex's bend weight from the models' second texture
// coordinates and draws the file's own textures.
import type { Material, SketchContext } from '@null3d/engine';
import type { Wind } from '@null3d/wind';
import { type Part, partsOf, standPart, swayingPart } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';
import { createSway } from '../../lib/sway';
import {
	PLANT_KINDS,
	type PlantKind,
	type Spot,
	TREE_KINDS,
	type TreeKind,
	type Valley,
} from './valley';

/**
 * How far each part's freest tips move in a wind of one meter a second, in meters, how stiff it is
 * near its root, and how far its leaves flutter. A pine bends as a stiff cantilever, and its wood
 * and its needle cards share the bend so the cards stay on their twigs; the cards flutter a little
 * on top. The ground cover bends from its foot.
 */
const SWAY = {
	wood: { sway: 0.008, stiffness: 2.2, rustle: 0, roughness: 1 },
	needles: { sway: 0.008, stiffness: 2.2, rustle: 0.012, roughness: 0.7 },
	plant: { sway: 0.018, stiffness: 1.4, rustle: 0.01, roughness: 0.7 },
} as const;

/** The models that the planting draws. */
export interface PlantModels {
	readonly trees: Record<TreeKind, { readonly wood: Part; readonly leaves: Part }>;
	readonly plants: Record<PlantKind, Part>;
}

/** Loads the pines' file and the ground cover's file at once. */
export async function loadPlants({ assets }: SketchContext): Promise<PlantModels> {
	const [pines, plants] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/creek-pines/pines.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/plants.glb')),
	]);
	const pine = partsOf(pines);
	const plant = partsOf(plants);
	return {
		trees: Object.fromEntries(
			TREE_KINDS.map((kind) => [
				kind,
				{ wood: pine(`${kind}-wood`), leaves: pine(`${kind}-leaves`) },
			]),
		) as PlantModels['trees'],
		plants: Object.fromEntries(
			PLANT_KINDS.map((kind) => [kind, plant(kind)]),
		) as PlantModels['plants'],
	};
}

/** The drawn plants, and what a frame changes on them. */
export interface Plants {
	/** Gives the wind material the field's newest state, which a frame calls after the field steps. */
	update(): void;
}

/**
 * Draws the garden's trees and ground cover from the loaded models. Each part takes the wind
 * material with its file's textures: the bark's color, normal and occlusion maps, and the cards'
 * cutout.
 */
export function createPlants(
	ctx: SketchContext,
	wind: Wind,
	valley: Valley,
	models: PlantModels,
): Plants {
	const sway = createSway(ctx, { wind });
	/** One batch of a part over the spots that stand it. */
	const stand = (part: Part, spots: readonly Spot[], material: Material) => {
		if (spots.length > 0) standPart(ctx, part, spots, material);
	};
	for (const kind of TREE_KINDS) {
		const { wood, leaves } = models.trees[kind];
		const spots = valley.trees.filter((spot) => spot.kind === kind);
		stand(wood, spots, swayingPart(sway, wood, SWAY.wood, false));
		stand(leaves, spots, swayingPart(sway, leaves, SWAY.needles, true));
	}
	for (const kind of PLANT_KINDS) {
		const part = models.plants[kind];
		// Each plant's foot sinks a little, so no copy stands proud of a slope.
		const spots = valley.plants
			.filter((spot) => spot.kind === kind)
			.map((spot) => ({ ...spot, y: spot.y - 0.03 }));
		stand(part, spots, swayingPart(sway, part, SWAY.plant, true));
	}
	return { update: () => sway.update() };
}
