// The ecological rules that the vegetation add-on's scatter page places over Creek's land: the
// stream's own species, from the waterline to the canopy, with the young trees, the understory, the
// ground layer and the dead wood. The page holds every device to the checksum of their placement, so
// the rules keep their order and their numbers.
import type { EcoRule } from '@null3d/vegetation';

/** A tolerance curve, in the shortest form. */
const curve = (
	input: EcoRule['tolerances'][number]['input'],
	min: number,
	best: number,
	worst: number,
	max: number,
) => ({ input, min, best, worst, max });

/**
 * Every rule of the valley: the waterline, the canopy, the young trees that gather under
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
