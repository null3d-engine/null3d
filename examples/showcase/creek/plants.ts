// The creek's plants, grown by the vegetation add-on's plant core rather than loaded from files. The
// valley's plants stand where the add-on's ecological rules place them (see `valley.ts`), each
// species grown in the engine's job workers at the variants that Creek draws, with every level of
// detail kept for the engine to switch by distance. The canopy hands over to far cards past the
// distance where a tree spans a few pixels, and the same cards dress the mountain ring beyond the
// valley. Fallen lengths of dead wood lie where the rules leave them. Each species draws as the
// plant core's stand-in, at its size and in its colours, until the species lands in the add-on.
import { type MeshArrays, quat, type SketchContext } from '@null3d/engine';
import { type PlantMaterial, setWindLayer } from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { type PlantSpot, plantSpecies } from '../../lib/plants';
import { random } from '../../lib/procedural';
import { fromStream } from './land';
import { type CreekSpecies, placeValley, SEED, SPECIES, VARIANTS } from './valley';

/** The far cards on the mountain ring: how many, the heights they cover and how far out they stand. */
const CARDS = 3600;
const CARD_LOW = 2;
const CARD_HIGH = 50;
const RING_INNER = 86;
const RING_OUTER = 260;
/**
 * How far from the stream, in stream half-widths, a copy keeps its own variant. Past it one shape
 * serves every copy of its species, which is the owner's rule: reuse a tree where the camera reads
 * it as a silhouette, and keep the variety near the water where it passes close.
 */
const VARIED_NEAR_STREAM = 12;
/** The range of a card's height, in meters: the trees that the ring's scale cannot show. */
const CARD_SHORT = 9;
const CARD_TALL = 17;
/** The fallen lengths of dead wood: their longest and shortest length, and their girth, in meters. */
const LOG_LONG = 4.5;
const LOG_SHORT = 1.8;
const LOG_GIRTH = 0.22;

/** What the plants need of the scene. */
export interface PlantOptions {
	/** True where a stone covers the ground, which nothing grows through. */
	readonly rocks?: (x: number, z: number) => boolean;
	/** The mountain ring's height at a point, which the far cards stand on. Leave it out for none. */
	readonly mountainHeight?: (x: number, z: number) => number;
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
			// A copy far from the stream reuses the first variant: at that distance the camera reads
			// a crown as a silhouette, so one shape serves every copy of a species there. Near the
			// stream each copy keeps its own, where the camera passes close to them.
			variant:
				fromStream(x, z) > VARIED_NEAR_STREAM
					? 0
					: Math.min(VARIANTS - 1, Math.floor(points.data[at + 4] as number)),
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

/**
 * Spreads far copies of the canopy over the ring's wooded slopes, below the tree line and above the
 * valley. They are so far out that each draws as its far card. One variant stands for each species
 * there, where no card shows a single twig.
 */
function ringSpots(
	canopy: readonly CreekSpecies[],
	mountainHeight: (x: number, z: number) => number,
): Map<string, PlantSpot[]> {
	const next = random(SEED + 1);
	const spots = new Map<string, PlantSpot[]>();
	let placed = 0;
	while (placed < CARDS) {
		const angle = next() * Math.PI * 2;
		const reach = RING_INNER + (RING_OUTER - RING_INNER) * next();
		const x = Math.cos(angle) * reach;
		const z = Math.sin(angle) * reach;
		const y = mountainHeight(x, z);
		if (y < CARD_LOW || y > CARD_HIGH) continue;
		const species = canopy[Math.floor(next() * canopy.length)];
		if (!species) continue;
		const tall = CARD_SHORT + (CARD_TALL - CARD_SHORT) * next();
		const turn = next() * Math.PI * 2;
		const list = spots.get(species.id) ?? [];
		list.push({ x, y, z, turn, scale: tall / species.height, variant: 0 });
		spots.set(species.id, list);
		placed++;
	}
	return spots;
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
 * Grows and draws the creek's plants: every species that the valley's rules placed, at every
 * variant, in the scene's one wind field, with the canopy's far cards in the valley and on the
 * mountain ring, and the dead wood on the floor.
 */
export async function createPlants(
	ctx: SketchContext,
	wind: WindField,
	options: PlantOptions = {},
): Promise<Plants> {
	const points = placeValley(options);
	const grouped = groupBySpecies(points);
	const ring = options.mountainHeight
		? ringSpots(
				SPECIES.filter((species) => species.canopy),
				options.mountainHeight,
			)
		: new Map<string, PlantSpot[]>();
	layDeadWood(ctx, points);
	const planted = await Promise.all(
		SPECIES.map((species) => {
			const spots = [...(grouped.get(species.id) ?? []), ...(ring.get(species.id) ?? [])];
			if (spots.length === 0) return undefined;
			return plantSpecies(ctx, {
				id: species.id,
				standIn: {
					height: species.height,
					// The stand-in's crown fills the room that the rules keep for the species.
					aspect: (2 * species.crown) / species.height,
					leaf: species.leaf,
					bark: species.bark,
				},
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
