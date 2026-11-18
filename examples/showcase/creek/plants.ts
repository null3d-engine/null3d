// The creek's trees and plants: the Blender models of `models.ts`, standing where `valley.ts` places
// them, each kind one instance batch per part, so every copy picks its own level of detail. The
// trees and the bank plants sway in the scene's one wind field through the shared wind material,
// which reads each vertex's bend weight from the models' second texture coordinates and draws the
// file's own textures. Fallen lengths of dead wood, made in code, lie on the woods' floor.
import { type Material, type MeshArrays, quat, type SketchContext } from '@null3d/engine';
import type { Wind } from '@null3d/wind';
import { type Part, standPart, swayingPart } from '../../lib/blender-models';
import { createSway } from '../../lib/sway';
import { type Models, PLANT_KINDS, TREE_KINDS } from './models';
import type { Spot, Valley } from './valley';

/** The fallen lengths of dead wood: their length and girth at size 1, in meters. */
const LOG_LENGTH = 6.3;
const LOG_GIRTH = 0.22;

/**
 * How far each part's freest tips move in a wind of one meter a second, in meters, how stiff it is
 * near its root, and how far its leaves flutter. A tree bends as a cantilever, and its wood and its
 * cards share the bend so the cards stay on their twigs; the cards flutter on top. The bank plants
 * bend from their foot.
 */
const SWAY = {
	wood: { sway: 0.012, stiffness: 2, rustle: 0, roughness: 1 },
	leaves: { sway: 0.012, stiffness: 2, rustle: 0.025, roughness: 0.65 },
	plant: { sway: 0.018, stiffness: 1.4, rustle: 0.01, roughness: 0.7 },
} as const;

/** A fallen length of dead wood: a tapered log, its ends rounded, lying along x. */
function logMesh(): MeshArrays {
	const sides = 7;
	const rings = 5;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let ring = 0; ring <= rings; ring++) {
		const t = ring / rings;
		// The log tapers toward one end and swells through its middle, as a fallen trunk does.
		const radius = LOG_GIRTH * (0.7 + 0.3 * Math.sin(Math.PI * t)) * (1 - 0.35 * t);
		for (let side = 0; side < sides; side++) {
			const angle = (side / sides) * Math.PI * 2;
			const [ny, nz] = [Math.cos(angle), Math.sin(angle)];
			positions.push((t - 0.5) * LOG_LENGTH, ny * radius, nz * radius);
			normals.push(0, ny, nz);
			uvs.push(t, side / sides);
		}
	}
	for (let ring = 0; ring < rings; ring++)
		for (let side = 0; side < sides; side++) {
			const a = ring * sides + side;
			const b = ring * sides + ((side + 1) % sides);
			indices.push(a, a + sides, b, b, a + sides, b + sides);
		}
	return { positions, normals, uvs, indices };
}

/** Lays the dead wood: fallen lengths on the woods' floor, each along its own turn. */
function layDeadWood(ctx: SketchContext, logs: readonly Spot[]): void {
	if (logs.length === 0) return;
	const batch = ctx.scene.createInstances(ctx.geometry.fromArrays(logMesh()), logs.length, {
		material: ctx.materials.standard({ color: '#4a3a2a', roughness: 0.95 }),
		castShadows: true,
		receiveShadows: true,
	});
	const lying = quat.fromEuler(quat.create(), 0, 0, Math.PI / 2);
	const turn = quat.create();
	logs.forEach((log, row) => {
		batch.positions.set([log.x, log.y + LOG_GIRTH * 0.8 * log.size, log.z], row * 3);
		quat.fromEuler(turn, 0, log.yaw, 0);
		batch.rotations.set(quat.multiply(turn, turn, lying), row * 4);
		batch.scales.fill(log.size, row * 3, row * 3 + 3);
	});
	batch.markDirty();
}

/** The drawn plants, and what a frame changes on them. */
export interface Plants {
	/** Gives the wind material the field's newest state, which a frame calls after the field steps. */
	update(): void;
}

/**
 * Draws the valley's trees, bank plants and dead wood from the loaded models. Each part takes the
 * wind material with its file's textures: the bark's color, normal and occlusion maps, and the
 * cards' cutout.
 */
export function createPlants(
	ctx: SketchContext,
	wind: Wind,
	valley: Valley,
	models: Models,
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
		stand(leaves, spots, swayingPart(sway, leaves, SWAY.leaves, true));
	}
	for (const kind of PLANT_KINDS) {
		const part = models.plants[kind];
		// Each plant's foot sinks a little, so no copy stands proud of a slope.
		const spots = valley.plants
			.filter((spot) => spot.kind === kind)
			.map((spot) => ({ ...spot, y: spot.y - 0.03 }));
		stand(part, spots, swayingPart(sway, part, SWAY.plant, true));
	}
	layDeadWood(ctx, valley.deadwood);
	return { update: () => sway.update() };
}
