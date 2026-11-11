// Creek's valley, placed by the vegetation add-on's ecological rules: rushes and sedges at the
// waterline, willows and alders on the banks, oaks, beeches and birches over the flat and up the
// slopes, spruces at the valley's rim, bracken in the shade, wildflower clumps in the open patches
// and hawthorns at the wood's edge. The points come from the ground's own maps and one integer
// hash, so every device and both GPU paths place the same valley. The scene then keeps only the
// four trees nearest the water: the slopes and the hillsides above stand as ground cover, with no
// tree dotted over them. A plant that the camera's route would fly into is left out, so the river
// pass never crosses a crown.
import {
	type EcoRule,
	groundMaps,
	SCATTER_STRIDE,
	type ScatterPoints,
	scatterVegetation,
} from '@null3d/vegetation';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { fromStream, groundHeight, LAND, WATER } from './land';
import { SHOTS } from './route';

/** The seed that places the valley, so a build gives the same plants on every device. */
export const SEED = 7;
/** The variants that Creek grows of each species. The copies' own sizes and turns carry the rest. */
export const VARIANTS = 4;

/** One species that dresses the valley: its id in the add-on's catalogue and its stand-in's look. */
export interface CreekSpecies {
	/** The species' id, which the rules place by. */
	readonly id: string;
	/** Height of a grown plant at scale 1, in meters. */
	readonly height: number;
	/** The reach of its crown about its trunk at scale 1, in meters, which the rules space it by. */
	readonly crown: number;
	/** Linear colour of its leaves and of its bark. */
	readonly leaf: readonly [number, number, number];
	readonly bark: readonly [number, number, number];
	/** True for a tree of the canopy, which hands over to far cards. */
	readonly canopy: boolean;
}

/**
 * The species that the valley's rules place. Each draws as the plant core's stand-in, at its size
 * and in its colours, until its species lands in the add-on.
 */
export const SPECIES: readonly CreekSpecies[] = [
	{
		id: 'pedunculate-oak',
		height: 13,
		crown: 5.7,
		leaf: [0.09, 0.19, 0.045],
		bark: [0.18, 0.15, 0.12],
		canopy: true,
	},
	{
		id: 'european-beech',
		height: 14,
		crown: 6,
		leaf: [0.14, 0.28, 0.07],
		bark: [0.32, 0.3, 0.27],
		canopy: true,
	},
	{
		id: 'silver-birch',
		height: 12,
		crown: 5.5,
		leaf: [0.2, 0.34, 0.1],
		bark: [0.62, 0.6, 0.55],
		canopy: true,
	},
	{
		id: 'weeping-willow',
		height: 10,
		crown: 4.42,
		leaf: [0.18, 0.3, 0.1],
		bark: [0.25, 0.21, 0.15],
		canopy: true,
	},
	{
		id: 'common-alder',
		height: 9.5,
		crown: 4.1,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.22, 0.2, 0.17],
		canopy: true,
	},
	{
		id: 'norway-spruce',
		height: 15,
		crown: 7.1,
		leaf: [0.08, 0.2, 0.09],
		bark: [0.26, 0.18, 0.13],
		canopy: true,
	},
	{
		id: 'hosta',
		height: 0.6,
		crown: 0.44,
		leaf: [0.12, 0.3, 0.09],
		bark: [0.2, 0.18, 0.12],
		canopy: false,
	},
	{
		id: 'sedge',
		height: 0.85,
		crown: 0.64,
		leaf: [0.2, 0.32, 0.1],
		bark: [0.22, 0.2, 0.12],
		canopy: false,
	},
	{
		id: 'rush',
		height: 1.15,
		crown: 0.88,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.2, 0.19, 0.13],
		canopy: false,
	},
	{
		id: 'wildflower',
		height: 0.4,
		crown: 0.272,
		leaf: [0.14, 0.3, 0.08],
		bark: [0.2, 0.18, 0.12],
		canopy: false,
	},
	{
		id: 'hawthorn-shrub',
		height: 2.4,
		crown: 1.16,
		leaf: [0.15, 0.3, 0.1],
		bark: [0.22, 0.18, 0.13],
		canopy: false,
	},
	{
		id: 'bracken',
		height: 0.9,
		crown: 0.72,
		leaf: [0.11, 0.26, 0.06],
		bark: [0.2, 0.16, 0.1],
		canopy: false,
	},
];

/** A tolerance curve, in the shortest form. */
const curve = (
	input: EcoRule['tolerances'][number]['input'],
	min: number,
	best: number,
	worst: number,
	max: number,
) => ({ input, min, best, worst, max });

/**
 * Every rule that places the valley: the waterline, the canopy, the young trees that gather under
 * it, the understory, the ground layer, the shrubs and the dead wood. Each adult rule keeps its
 * species' crown as its radius. The order and the numbers set every point, so a rule keeps its
 * place in the list.
 */
const ALL_RULES: readonly EcoRule[] = [
	{
		species: 'rush',
		scale: [0.8, 1.3],
		radius: 0.8800000000000001,
		layer: 'ground',
		spacing: 1.2,
		tolerances: [
			// The waterline's own species stand on wet ground beside the stream, never in it: the
			// owner ruled that no vegetation grows below the water's surface.
			curve('heightAboveWater', 0, 0.05, 0.1, 0.55),
			curve('distanceToWater', 0, 0, 2.5, 4.5),
			curve('wetness', 0.15, 0.4, 1, 1.01),
		],
		clump: [0.2, 1],
	},
	{
		species: 'sedge',
		scale: [0.8, 1.4],
		radius: 0.6400000000000001,
		layer: 'ground',
		spacing: 1.4,
		tolerances: [
			curve('heightAboveWater', 0, 0.05, 0.5, 1.1),
			curve('distanceToWater', 0, 0.5, 3.5, 6),
			curve('wetness', 0.1, 0.3, 1, 1.01),
		],
		clump: [0.2, 1],
	},
	{
		species: 'weeping-willow',
		scale: [0.8, 1.4],
		radius: 4.42,
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			curve('heightAboveWater', 0.05, 0.3, 1.5, 3),
			curve('distanceToWater', 0.5, 1.5, 6, 10),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('slope', 0, 0, 0.5, 0.85),
		],
		clump: [0.25, 1],
	},
	{
		species: 'common-alder',
		scale: [0.8, 1.3],
		radius: 4.1000000000000005,
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			curve('heightAboveWater', 0.15, 0.5, 2.2, 5),
			curve('distanceToWater', 1.5, 4, 10, 18),
			curve('wetness', 0.04, 0.15, 1, 1.01),
		],
		clump: [0.25, 1],
	},
	{
		species: 'pedunculate-oak',
		scale: [0.8, 1.35],
		radius: 5.7,
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			curve('heightAboveWater', 0.6, 1.8, 11, 20),
			curve('slope', 0, 0.15, 0.55, 0.95),
			curve('northness', -1, -1, 0.15, 1.01),
		],
		clump: [0.25, 1],
	},
	{
		species: 'european-beech',
		scale: [0.8, 1.3],
		radius: 6.000000000000001,
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			curve('heightAboveWater', 0.6, 1.8, 10, 18),
			curve('northness', -0.3, 0.25, 1, 1.01),
			curve('wetness', 0.02, 0.1, 1, 1.01),
		],
		clump: [0.25, 1],
	},
	{
		species: 'silver-birch',
		scale: [0.75, 1.25],
		radius: 5.500000000000001,
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			curve('heightAboveWater', 0.4, 1.2, 8, 14),
			curve('distanceToWater', 4, 9, 40, 70),
			curve('openness', 0.05, 0.35, 1, 1.01),
		],
		clump: [0.25, 1],
	},
	{
		species: 'norway-spruce',
		scale: [0.7, 1.25],
		radius: 7.1,
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			curve('heightAboveWater', 3, 7, 22, 40),
			curve('slope', 0.18, 0.3, 1.4, 2.2),
			curve('northness', -0.6, 0, 1, 1.01),
		],
		clump: [0.2, 1],
	},
	{
		species: 'pedunculate-oak',
		scale: [0.8, 1.35],
		radius: 1.2,
		layer: 'young',
		spacing: 4,
		tolerances: [curve('heightAboveWater', 0.4, 1.8, 11, 20), curve('slope', 0, 0.2, 0.7, 1.2)],
		cluster: { species: ['pedunculate-oak', 'european-beech'], radius: 7, min: 1, max: 3 },
		overlaps: ['young'],
	},
	{
		species: 'silver-birch',
		scale: [0.75, 1.25],
		radius: 1.1,
		layer: 'young',
		spacing: 4,
		tolerances: [
			curve('heightAboveWater', 0.3, 1.2, 8, 14),
			curve('openness', 0.02, 0.25, 1, 1.01),
		],
		cluster: {
			species: ['silver-birch', 'weeping-willow', 'common-alder'],
			radius: 6,
			min: 1,
			max: 3,
		},
		overlaps: ['young'],
	},
	{
		species: 'common-alder',
		scale: [0.8, 1.3],
		radius: 1,
		layer: 'young',
		spacing: 4,
		tolerances: [curve('heightAboveWater', 0.15, 0.5, 2.2, 5)],
		cluster: { species: ['common-alder', 'weeping-willow'], radius: 6, min: 1, max: 2 },
		overlaps: ['young'],
	},
	{
		species: 'bracken',
		scale: [0.7, 1.4],
		radius: 0.7200000000000001,
		layer: 'understory',
		spacing: 1.8,
		tolerances: [
			curve('canopy', 0.08, 0.3, 1, 1.01),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('heightAboveWater', 0.15, 0.5, 6, 12),
		],
		clump: [0.25, 1],
		overlaps: ['understory'],
	},
	{
		species: 'hosta',
		scale: [0.75, 1.35],
		radius: 0.44000000000000006,
		layer: 'ground',
		spacing: 2.4,
		tolerances: [
			curve('canopy', 0.06, 0.25, 1, 1.01),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('distanceToWater', 0.4, 1.5, 14, 26),
		],
		clump: [0.3, 1],
		overlaps: ['ground'],
	},
	// The open patches: wildflower clumps where the canopy is thin and the ground is dry.
	{
		species: 'wildflower',
		scale: [0.8, 1.4],
		radius: 0.272,
		layer: 'ground',
		spacing: 3.2,
		tolerances: [
			curve('openness', 0.4, 0.6, 1, 1.01),
			curve('heightAboveWater', 0.2, 0.5, 8, 15),
			curve('slope', 0, 0, 0.6, 1.1),
		],
		clump: [0.5, 0.66],
		overlaps: ['ground'],
	},
	{
		species: 'hawthorn-shrub',
		scale: [0.7, 1.4],
		radius: 1.16,
		layer: 'shrub',
		spacing: 2.6,
		tolerances: [
			curve('edge', 0.1, 0.4, 1, 1.01),
			curve('heightAboveWater', 0.2, 0.5, 8, 15),
			curve('slope', 0, 0, 0.6, 1.1),
		],
		clump: [0.2, 1],
		overlaps: ['shrub'],
	},
	// Dead wood is a prop, with no species: its rule names the prop it places.
	{
		species: 'deadwood',
		layer: 'deadwood',
		spacing: 11,
		radius: 2.5,
		overlaps: ['deadwood'],
		tolerances: [curve('canopy', 0.2, 0.5, 1, 1.01), curve('slope', 0, 0, 0.4, 0.8)],
		clump: [0.3, 1],
	},
];

/** The species that only the valley's edges carry: the spruces at its rim, bracken and hawthorns. */
const EDGE_SPECIES: readonly string[] = ['norway-spruce', 'bracken', 'hawthorn-shrub'];

/**
 * The rules of the stream's own species, without the valley's edges, at six variants a copy. The
 * scatter test page holds every device to their checksum.
 */
export const CREEK_RULES: readonly EcoRule[] = ALL_RULES.filter(
	(rule) => !EDGE_SPECIES.includes(rule.species),
);

/** The rules that place the valley, with each species drawn in the number of variants that Creek grows. */
export const RULES: readonly EcoRule[] = ALL_RULES.map((rule) => ({ ...rule, variants: VARIANTS }));

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

/** The room that one placed plant keeps, from its species and its copy's size. */
function solidOf(
	species: CreekSpecies,
	at: readonly [number, number, number],
	scale: number,
): PlantSolid {
	return {
		species: species.id,
		x: at[0],
		z: at[2],
		radius: species.crown * scale + CLEARANCE,
		top: at[1] + species.height * scale + CLEARANCE,
	};
}

/** The valley's species by id. */
const BY_ID: ReadonlyMap<string, CreekSpecies> = new Map(
	SPECIES.map((species) => [species.id, species]),
);

/**
 * The room that every placed plant keeps, which the camera's route must miss. A page measures its
 * route against these, so a plant never grows where a pose could fly into it.
 *
 * @param points The plants that `placeValley` placed.
 * @returns One cylinder for each plant.
 */
export function plantSolids(points: ScatterPoints): PlantSolid[] {
	const solids: PlantSolid[] = [];
	for (let index = 0; index < points.count; index++) {
		const at = index * SCATTER_STRIDE;
		const rule = points.rules[points.data[at + 3] as number];
		const species = rule && BY_ID.get(rule.species);
		if (!species) continue;
		solids.push(
			solidOf(
				species,
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
	route: readonly (readonly [number, number, number])[],
): ScatterPoints {
	const kept = new Float32Array(points.data.length);
	let count = 0;
	for (let index = 0; index < points.count; index++) {
		const at = index * SCATTER_STRIDE;
		const rule = points.rules[points.data[at + 3] as number];
		const species = rule && BY_ID.get(rule.species);
		// A prop such as the dead wood has no species, and lies low enough for the route to clear.
		if (species) {
			const solid = solidOf(
				species,
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

/** How many trees stand beside the water. */
const CANAL_TREES = 4;

/** The ground layers that dress the valley below the trees, and the dead wood that lies on it. */
const CANAL_LAYERS: readonly string[] = ['ground', 'shrub', 'understory', 'deadwood'];

/**
 * Keeps the canal's four trees and the layers that dress the ground beneath them. The four canopy
 * trees nearest the stream stay; every other canopy tree and every young tree goes, so no tree dots
 * the slopes or the hillsides above.
 */
function thinValley(points: ScatterPoints): ScatterPoints {
	const kept = new Float32Array(points.data.length);
	let count = 0;
	const canopy: { index: number; stream: number }[] = [];
	for (let index = 0; index < points.count; index++) {
		const at = index * points.stride;
		const layer = points.rules[points.data[at + 3] as number]?.layer;
		if (layer === 'canopy') {
			canopy.push({
				index,
				stream: fromStream(points.data[at] as number, points.data[at + 2] as number),
			});
			continue;
		}
		if (!layer || !CANAL_LAYERS.includes(layer)) continue;
		kept.set(points.data.subarray(at, at + points.stride), count * points.stride);
		count++;
	}
	canopy.sort((a, b) => a.stream - b.stream);
	for (const { index } of canopy.slice(0, CANAL_TREES)) {
		const at = index * points.stride;
		kept.set(points.data.subarray(at, at + points.stride), count * points.stride);
		count++;
	}
	return { data: kept, stride: points.stride, count, rules: points.rules, size: points.size };
}

/**
 * Places the valley's plants: the ground read once into maps, the rules scored over it, the plants
 * that the camera's route would fly into left out, and the planting thinned to the canal's four
 * trees and the ground cover.
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
	return thinValley(clearOfRoute(placed, routeSamples()));
}
