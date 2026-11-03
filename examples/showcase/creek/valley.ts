// Creek's valley, placed by the vegetation add-on's ecological rules: rushes and sedges at the
// waterline, willows and alders on the banks, then oaks, beeches and birches over the flat and up
// the slopes, with conifers at the valley's rim, ferns in the shade and shrubs at the wood's edge.
// The points come from the ground's own maps and one integer hash, so every device and both GPU
// paths place the same valley. A plant that the camera's route would fly into is left out, so the
// river pass never crosses a crown.
import {
	type EcoRule,
	groundMaps,
	SCATTER_STRIDE,
	type ScatterPoints,
	scatterVegetation,
} from '@null3d/vegetation';
import {
	BUILTIN_SPECIES,
	builtinRules,
	CREEK_SPECIES,
	type Species,
	speciesCrownRadius,
} from '@null3d/vegetation/legacy';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { groundHeight, LAND, WATER } from './land';
import { SHOTS } from './route';

/** The seed that places the valley, so a build gives the same plants on every device. */
export const SEED = 7;
/** The variants that Creek grows of each species. The copies' own tints carry the rest. */
export const VARIANTS = 4;

/**
 * The families that the add-on's Creek records do not cover: a conifer for the valley's rim, ferns
 * for the shade and shrubs for the wood's edge.
 */
const EXTRA = ['conifer', 'fern', 'shrub'] as const;

/** The species that dress the valley, in the add-on's records. */
export const SPECIES: readonly Species[] = [
	...CREEK_SPECIES,
	...BUILTIN_SPECIES.filter((record) => (EXTRA as readonly string[]).includes(record.id)),
];

/**
 * The rules that place them, with each species drawn in the number of variants that Creek grows.
 * The add-on's own rules suit a valley whose water stands at zero, as this one's does.
 */
export const RULES: readonly EcoRule[] = builtinRules(SPECIES).map((rule) => ({
	...rule,
	variants: VARIANTS,
}));

/** What the placement reads of the scene: where the stones stand, which no plant grows on. */
export interface ValleyOptions {
	/** True where a stone covers the ground. */
	readonly rocks?: (x: number, z: number) => boolean;
}

/** How close the camera may come to a plant, in meters: its own clearance from a crown. */
const CLEARANCE = 0.6;
/** The points along the route that the clearance is measured from. */
const ROUTE_SAMPLES = 2000;

/** A plant's room, as a cylinder about its trunk: its crown's reach and its crown's top. */
export interface PlantSolid {
	/** The species' id. */
	readonly species: string;
	readonly x: number;
	readonly z: number;
	/** The reach of the plant about its trunk, in meters, with the camera's clearance. */
	readonly radius: number;
	/** The height that its crown reaches, with the camera's clearance, in meters. */
	readonly top: number;
}

/** The room that one placed plant keeps, from its record and its copy's size. */
function solidOf(
	record: Species,
	at: readonly [number, number, number],
	scale: number,
): PlantSolid {
	return {
		species: record.id,
		x: at[0],
		z: at[2],
		radius: speciesCrownRadius(record, scale) + CLEARANCE,
		top: at[1] + record.height * scale + CLEARANCE,
	};
}

/**
 * The room that every placed plant keeps, which the camera's route must miss. A page measures its
 * route against these, so a plant never grows where a pose could fly into it.
 *
 * @param points The plants that `placeValley` placed.
 * @returns One cylinder for each plant.
 */
export function plantSolids(points: ScatterPoints): PlantSolid[] {
	const records = new Map(SPECIES.map((record) => [record.id, record]));
	const solids: PlantSolid[] = [];
	for (let index = 0; index < points.count; index++) {
		const at = index * SCATTER_STRIDE;
		const rule = points.rules[points.data[at + 3] as number];
		const record = rule && records.get(rule.species);
		if (!record) continue;
		solids.push(
			solidOf(
				record,
				[points.data[at] as number, points.data[at + 1] as number, points.data[at + 2] as number],
				points.data[at + 5] as number,
			),
		);
	}
	return solids;
}

/**
 * The camera's route as a list of places, which a plant is measured against. The route bends
 * between its shots, so the list samples it finely enough that no bend slips between two points.
 */
function routeSamples(): [number, number, number][] {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const places: [number, number, number][] = [];
	for (let step = 0; step <= ROUTE_SAMPLES; step++) {
		routePosition(route, (step / ROUTE_SAMPLES) * route.total, pose);
		places.push([pose[0] as number, pose[1] as number, pose[2] as number]);
	}
	return places;
}

/** True when a route pose passes through a plant's room. */
function hits(solid: PlantSolid, pose: readonly [number, number, number]): boolean {
	return pose[1] <= solid.top && Math.hypot(pose[0] - solid.x, pose[2] - solid.z) < solid.radius;
}

/** Keeps the plants that a camera route cannot pass through. */
function clearOfRoute(
	points: ScatterPoints,
	records: ReadonlyMap<string, Species>,
	route: readonly (readonly [number, number, number])[],
): ScatterPoints {
	const kept = new Float32Array(points.data.length);
	let count = 0;
	for (let index = 0; index < points.count; index++) {
		const at = index * SCATTER_STRIDE;
		const rule = points.rules[points.data[at + 3] as number];
		const record = rule && records.get(rule.species);
		// A prop such as the dead wood has no species, and lies low enough for the route to clear.
		if (record) {
			const solid = solidOf(
				record,
				[points.data[at] as number, points.data[at + 1] as number, points.data[at + 2] as number],
				points.data[at + 5] as number,
			);
			if (route.some((pose) => hits(solid, pose))) continue;
		}
		kept.set(points.data.subarray(at, at + SCATTER_STRIDE), count * SCATTER_STRIDE);
		count++;
	}
	return {
		data: kept,
		stride: SCATTER_STRIDE,
		count,
		rules: points.rules,
		size: points.size,
	};
}

/**
 * Places the valley's plants: the ground read once into maps, the rules scored over it, and the
 * plants that the camera's route would fly into left out.
 *
 * @param options Where the stones stand.
 * @returns The placed plants, as the scatter's flat rows.
 */
export function placeValley(options: ValleyOptions = {}): ScatterPoints {
	const ground = groundMaps({
		size: LAND,
		water: WATER,
		height: groundHeight,
		...(options.rocks && { rocks: (x: number, z: number) => (options.rocks?.(x, z) ? 1 : 0) }),
	});
	const placed = scatterVegetation({ seed: SEED, ground, rules: RULES });
	const records = new Map(SPECIES.map((record) => [record.id, record]));
	return clearOfRoute(placed, records, routeSamples());
}
