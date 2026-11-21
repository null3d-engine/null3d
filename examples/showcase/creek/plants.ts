// The garden's trees and ground cover: the Blender models of the pines and of today's ferns and
// hostas, standing where `valley.ts` places them, each kind one instance batch per part. Each copy
// of a pine picks its own level of detail; the ferns and hostas carry only their one level, so
// `valley.ts` holds their count to a triangle budget. Each copy of the ground cover takes a tint
// of its own. They sway in the scene's one wind field through the shared
// wind material, which reads each vertex's bend weight from the models' second texture
// coordinates and draws the file's own textures.
import type { Material, SketchContext } from '@null3d/engine';
import type { Wind } from '@null3d/wind';
import { type Part, partsOf, placed, standPart, swayingPart } from '../../lib/blender-models';
import { random } from '../../lib/procedural';
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

/**
 * The tints over the ground cover's own green, one to a copy, toward the concept's low growth:
 * olive, gold and dull red, in linear shares. In linear light the green map's green is about three
 * times its red, so a tint raises the red well past one and cuts the green to about a quarter of
 * it, which turns the leaves gold; it raises the blue to about half the red, so the leaves read at
 * the concept's strength under the scene's tone curve, and the drawn blue stays under the drawn
 * green.
 * The texture keeps each leaf's shading.
 */
const GROUND_TINTS: readonly (readonly [number, number, number])[] = [
	[5.1, 1.28, 1.9],
	[6.1, 1.38, 1.75],
	[5.7, 1.02, 1.85],
];

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
	const next = random(91);
	for (const kind of PLANT_KINDS) {
		const part = models.plants[kind];
		const spots = valley.plants.filter((spot) => spot.kind === kind);
		if (spots.length === 0) continue;
		// Each copy takes one of the tints, a little lighter or darker, over the part's own map.
		const batch = ctx.scene.createInstances(part.mesh, spots.length, {
			material: swayingPart(sway, part, SWAY.plant, true),
			castShadows: true,
			receiveShadows: true,
			colors: true,
		});
		spots.forEach((spot, row) => {
			// Each plant's foot sinks a little, so no copy stands proud of a slope.
			const { position, rotation, scale } = placed(
				part,
				[spot.x, spot.y - 0.03, spot.z],
				spot.yaw,
				spot.size,
			);
			batch.positions.set(position, row * 3);
			batch.rotations.set(rotation, row * 4);
			batch.scales.set(scale, row * 3);
			const tint = GROUND_TINTS[Math.floor(next() * GROUND_TINTS.length)] as readonly number[];
			const shade = 0.85 + 0.3 * next();
			batch.colors?.set([...tint.map((share) => share * shade), 1], row * 4);
		});
		batch.markDirty();
	}
	return { update: () => sway.update() };
}
