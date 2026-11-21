// The garden's trees and ground cover: the Blender models of the pines, the maples, the garden's
// ground plants and the ferns and hostas, standing where `valley.ts` places them, each kind one
// instance batch per part, and each copy picking its own level of detail. Each maple's leaves take
// its color, red, orange or yellow, over their pale map, and a bare maple stands as its wood alone;
// each fern and hosta takes a tint of its own. They sway in the scene's one wind field through the
// shared wind material, which reads each vertex's bend weight from the models' second texture
// coordinates and draws the file's own textures.
import type { Material, SketchContext } from '@null3d/engine';
import type { Wind } from '@null3d/wind';
import { type Part, partsOf, placed, standPart, swayingPart } from '../../lib/blender-models';
import { random } from '../../lib/procedural';
import { sampleUrl } from '../../lib/samples';
import { createSway } from '../../lib/sway';
import {
	type MapleColor,
	PLANT_KINDS,
	type PlantKind,
	type Spot,
	type TreeKind,
	type Valley,
} from './valley';

/**
 * How far each part's freest tips move in a wind of one meter a second, in meters, how stiff it is
 * near its root, and how far its leaves flutter. A pine bends as a stiff cantilever, and its wood
 * and its needle cards share the bend so the cards stay on their twigs; the cards flutter a little
 * on top. A maple's leaves bend with its wood and flutter more. The ground cover bends from its foot.
 */
const SWAY = {
	wood: { sway: 0.008, stiffness: 2.2, rustle: 0, roughness: 1 },
	needles: { sway: 0.008, stiffness: 2.2, rustle: 0.012, roughness: 0.7 },
	leaves: { sway: 0.01, stiffness: 1.8, rustle: 0.02, roughness: 0.7 },
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

/**
 * The maples' leaf colors over their pale map, in linear shares, which read hue about 16, 24 and
 * 32 on the screen, the concept's red, orange and yellow maples, close together as its are.
 */
const MAPLE_TINTS: Record<Exclude<MapleColor, 'bare'>, readonly [number, number, number]> = {
	red: [0.9, 0.12, 0.03],
	orange: [0.9, 0.23, 0.035],
	yellow: [0.9, 0.35, 0.04],
};

/** The garden's ground plants that carry tufts over their body; the moss cushion is a body alone. */
const TUFTED: readonly PlantKind[] = ['rim-conifer', 'clipped-shrub', 'azalea', 'autumn-clump'];
/** The ground plants with a map of their own and no tint, from the garden's file. */
const GARDEN_PLANTS: readonly PlantKind[] = [...TUFTED, 'moss-cushion'];

/** The models that the planting draws: each tree's wood and leaves, each ground plant's parts. */
export interface PlantModels {
	readonly trees: Record<TreeKind, { readonly wood: Part; readonly leaves: Part }>;
	readonly plants: Record<PlantKind, readonly Part[]>;
}

/** Loads the pines', the maples', the garden plants' and the ferns' and hostas' files at once. */
export async function loadPlants({ assets }: SketchContext): Promise<PlantModels> {
	const [pines, maples, garden, plantsFile] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/creek-pines/pines.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-maples/maples.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek-garden-plants/garden.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/plants.glb')),
	]);
	const pine = partsOf(pines);
	const maple = partsOf(maples);
	const ground = partsOf(garden);
	const plant = partsOf(plantsFile);
	const pineKinds = ['pine-tall', 'pine-narrow', 'pine-low'] as const;
	const plants = {} as Record<PlantKind, readonly Part[]>;
	for (const kind of PLANT_KINDS)
		plants[kind] = !GARDEN_PLANTS.includes(kind)
			? [plant(kind)]
			: TUFTED.includes(kind)
				? [ground(`${kind}-body`), ground(`${kind}-tufts`)]
				: [ground(`${kind}-body`)];
	return {
		trees: {
			...Object.fromEntries(
				pineKinds.map((kind) => [
					kind,
					{ wood: pine(`${kind}-wood`), leaves: pine(`${kind}-leaves`) },
				]),
			),
			maple: { wood: maple('maple-wood'), leaves: maple('maple-leaves') },
		} as PlantModels['trees'],
		plants,
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
		if (spots.length === 0) return;
		const batch = standPart(ctx, part, spots, material);
		// A tree that stands narrower than its form keeps its height and loses width across its broad
		// side, along the model's own x.
		spots.forEach((spot, row) => {
			if (spot.width !== undefined)
				batch.scales[row * 3] = (batch.scales[row * 3] as number) * spot.width;
		});
		batch.markDirty();
	};
	/** One batch of a part over the spots that stand it, each copy with a color of its own. */
	const tinted = (
		part: Part,
		spots: readonly Spot[],
		material: Material,
		colorOf: (spot: Spot) => readonly number[],
	) => {
		if (spots.length === 0) return;
		const batch = ctx.scene.createInstances(part.mesh, spots.length, {
			material,
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
			batch.colors?.set([...colorOf(spot), 1], row * 4);
		});
		batch.markDirty();
	};
	const next = random(91);
	for (const [kind, { wood, leaves }] of Object.entries(models.trees) as [
		TreeKind,
		PlantModels['trees'][TreeKind],
	][]) {
		const spots = valley.trees.filter((spot) => spot.kind === kind);
		stand(wood, spots, swayingPart(sway, wood, SWAY.wood, false));
		if (kind !== 'maple') {
			stand(leaves, spots, swayingPart(sway, leaves, SWAY.needles, true));
			continue;
		}
		// A maple's leaves take its color, a little lighter or darker; a bare maple keeps its wood alone.
		const leafy = spots.filter((spot) => spot.color !== 'bare');
		tinted(leaves, leafy, swayingPart(sway, leaves, SWAY.leaves, true), (spot) => {
			const shade = 0.9 + 0.2 * next();
			return MAPLE_TINTS[(spot.color ?? 'red') as Exclude<MapleColor, 'bare'>].map(
				(share) => share * shade,
			);
		});
	}
	for (const kind of PLANT_KINDS) {
		const spots = valley.plants.filter((spot) => spot.kind === kind);
		const parts = models.plants[kind];
		if (GARDEN_PLANTS.includes(kind)) {
			// The garden's plants carry their own colors: a body, and tufts cut from their cards.
			parts.forEach((part, k) => {
				stand(
					part,
					spots.map((spot) => ({ ...spot, y: spot.y - 0.03 })),
					swayingPart(sway, part, SWAY.plant, k > 0),
				);
			});
			continue;
		}
		// Each fern and hosta takes one of the tints, a little lighter or darker, over its own map.
		const [part] = parts as [Part];
		tinted(part, spots, swayingPart(sway, part, SWAY.plant, true), () => {
			const tint = GROUND_TINTS[Math.floor(next() * GROUND_TINTS.length)] as readonly number[];
			const shade = 0.85 + 0.3 * next();
			return tint.map((share) => share * shade);
		});
	}
	return { update: () => sway.update() };
}
