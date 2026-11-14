// The creek's plants, grown by the vegetation add-on's plant core rather than loaded from files. The
// valley's plants stand where the add-on's ecological rules place them (see `valley.ts`), each
// species grown in the engine's job workers at the variants that Creek draws, with every level of
// detail kept for the engine to switch by distance. The canal's four trees hand over to far cards
// past the distance where a tree spans a few pixels; the hillsides carry ground cover and no trees.
// Fallen lengths of dead wood lie where the rules leave them. Each species draws as the plant
// core's stand-in, at its size and in its colours, until the species lands in the add-on.
import { type MeshArrays, quat, type SketchContext } from '@null3d/engine';
import { type PlantMaterial, setWindLayer } from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { type PlantSpot, plantSpecies } from '../../lib/plants';
import { random } from '../../lib/procedural';
import { creekStandIn } from '../../lib/stand-ins';
import { placeValley, SEED, SPECIES, VARIANTS } from './valley';

/** The fallen lengths of dead wood: their longest and shortest length, and their girth, in meters. */
const LOG_LONG = 4.5;
const LOG_SHORT = 1.8;
const LOG_GIRTH = 0.22;

/** What the plants need of the scene. */
export interface PlantOptions {
	/** True where a stone covers the ground, which nothing grows through. */
	readonly rocks?: (x: number, z: number) => boolean;
}

/** The drawn plants, and what a frame changes on them. */
export interface Plants {
	/** Gives the plant materials the field's newest state, which a frame calls before it draws. */
	setWindLayer(field: WindField): void;
}

/** Groups the placed plants by species, each with its variant, size and turn. */
function groupBySpecies(points: ReturnType<typeof placeValley>): Map<string, PlantSpot[]> {
	const grouped = new Map<string, PlantSpot[]>();
	for (let index = 0; index < points.count; index++) {
		const at = index * points.stride;
		const rule = points.rules[points.data[at + 3] as number];
		if (!rule || rule.species === 'deadwood') continue;
		let spots = grouped.get(rule.species);
		if (!spots) {
			spots = [];
			grouped.set(rule.species, spots);
		}
		const x = points.data[at] as number;
		const z = points.data[at + 2] as number;
		spots.push({
			x,
			y: points.data[at + 1] as number,
			z,
			scale: points.data[at + 5] as number,
			turn: (points.data[at + 6] as number) * Math.PI * 2,
			// Every copy keeps its own variant: the trees stand beside the water, where the camera
			// passes close enough to read one from another.
			variant: Math.min(VARIANTS - 1, Math.floor(points.data[at + 4] as number)),
		});
	}
	return grouped;
}

/** A fallen length of dead wood: a tapered log, its ends rounded, lying along x. */
function logMesh(): MeshArrays {
	const sides = 7;
	const rings = 5;
	const length = LOG_LONG + LOG_SHORT;
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
			positions.push((t - 0.5) * length, ny * radius, nz * radius);
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

/** Lays the valley's dead wood: fallen lengths on the floor of the wood. */
function layDeadWood(ctx: SketchContext, points: ReturnType<typeof placeValley>): void {
	const { scene, geometry } = ctx;
	const logs: { x: number; y: number; z: number; scale: number; rotation: number }[] = [];
	const next = random(SEED);
	for (let index = 0; index < points.count; index++) {
		const at = index * points.stride;
		const rule = points.rules[points.data[at + 3] as number];
		if (rule?.species !== 'deadwood') continue;
		logs.push({
			x: points.data[at] as number,
			y: points.data[at + 1] as number,
			z: points.data[at + 2] as number,
			scale: 0.6 + 0.6 * next(),
			rotation: next(),
		});
	}
	if (logs.length === 0) return;
	const batch = scene.createInstances(geometry.fromArrays(logMesh()), logs.length, {
		material: ctx.materials.standard({ color: '#4a3a2a', roughness: 0.95 }),
		castShadows: true,
		receiveShadows: true,
	});
	const lying = quat.fromEuler(quat.create(), 0, 0, Math.PI / 2);
	logs.forEach((log, row) => {
		batch.positions.set([log.x, log.y + LOG_GIRTH * 0.8 * log.scale, log.z], row * 3);
		batch.rotations.set(
			quat.multiply(
				quat.create(),
				quat.fromEuler(quat.create(), 0, log.rotation * Math.PI * 2, 0),
				lying,
			),
			row * 4,
		);
		batch.scales.fill(log.scale, row * 3, row * 3 + 3);
	});
	batch.markDirty();
}

/**
 * Grows and draws the creek's plants: every species that the thinned valley placed, at every
 * variant, in the scene's one wind field, with the canal's far cards and the dead wood on the floor.
 */
export async function createPlants(
	ctx: SketchContext,
	wind: WindField,
	options: PlantOptions = {},
): Promise<Plants> {
	const points = placeValley(options);
	const grouped = groupBySpecies(points);
	layDeadWood(ctx, points);
	const planted = await Promise.all(
		SPECIES.map((species) => {
			const spots = grouped.get(species.id) ?? [];
			if (spots.length === 0) return undefined;
			return plantSpecies(ctx, {
				id: species.id,
				// The stand-in's crown fills the room that the rules keep for the species.
				standIn: creekStandIn(species),
				seed: SEED,
				spots,
				variants: VARIANTS,
				wind,
				far: species.canopy,
				castShadows: true,
			});
		}),
	);
	const materials: PlantMaterial[] = planted.flatMap((species) => species?.materials ?? []);
	return {
		setWindLayer(field) {
			setWindLayer(materials, field);
		},
	};
}
