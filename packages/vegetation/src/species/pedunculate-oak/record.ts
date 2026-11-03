// The pedunculate oak, open-grown: a broad low dome about one and a half times as wide as tall, on
// a short massive bole that forks low into several huge limbs. Limbs leave at wide angles, run out
// almost level and kink between joints. Twigs are short and stiff, with buds crowded at their
// ends, and each year's shoot ends in one rosette of about six lobed leaves round its bud cluster.
//
// The growth numbers and the envelope come from the reference turntable; the shoot classes from
// the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the texture
// source's contour and the single-leaf stills; the bark from the bark stills. The record is plain
// data: no code runs in it.
import type { Species } from '../../core/record';

/** Internodes along a growth unit: one long first internode, then the leaves crowd at its tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/** The pedunculate oak's record. */
export const record: Species = {
	id: 'pedunculate-oak',
	name: 'Pedunculate oak',
	latin: 'Quercus robur',
	form: 'broad low dome on a short, low-forking bole',
	size: { height: { mean: 20, spread: 2 }, dbh: 1.1, aspect: 1.45 },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 3,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.25, 60],
				[1, 50],
			],
			angleSpread: 15,
			extinction: [0.02, 0.03],
		},
		apical: {
			control: [
				[0, 0.5],
				[0.15, 0.42],
				[1, 0.42],
			],
			dominance: [1.5, 0.6, 0.98],
			wander: 10,
		},
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96 },
		tropism: {
			photo: 0.12,
			gravi: [
				[0, 0.3],
				[0.25, 0.08],
				[1, 0.03],
			],
		},
		shedding: { threshold: 0.1, cleanBole: 0.1, stubs: 0.2 },
		bending: { strength: 0.12, upturn: 0.4 },
		pipe: { exponent: 2.3, tipRadius: 0.004 },
	},
	envelope: {
		kind: 'radial',
		heights: [
			0.115, 0.181, 0.247, 0.313, 0.379, 0.446, 0.512, 0.578, 0.644, 0.711, 0.777, 0.843, 0.909,
			0.975, 1,
		],
		radii: [
			[
				0.512, 0.496, 0.495, 0.513, 0.544, 0.571, 0.586, 0.589, 0.594, 0.607, 0.63, 0.662, 0.672,
				0.635, 0.582, 0.54,
			],
			[
				0.602, 0.583, 0.582, 0.604, 0.64, 0.672, 0.689, 0.692, 0.699, 0.715, 0.741, 0.779, 0.791,
				0.747, 0.684, 0.635,
			],
			[
				0.588, 0.555, 0.531, 0.528, 0.551, 0.591, 0.629, 0.641, 0.641, 0.66, 0.71, 0.768, 0.785,
				0.742, 0.677, 0.626,
			],
			[
				0.582, 0.57, 0.561, 0.562, 0.59, 0.649, 0.696, 0.694, 0.662, 0.643, 0.656, 0.683, 0.683,
				0.655, 0.624, 0.598,
			],
			[
				0.573, 0.586, 0.617, 0.651, 0.677, 0.698, 0.716, 0.718, 0.705, 0.694, 0.696, 0.708, 0.714,
				0.694, 0.643, 0.591,
			],
			[
				0.607, 0.593, 0.59, 0.61, 0.652, 0.692, 0.705, 0.7, 0.706, 0.722, 0.73, 0.724, 0.713, 0.697,
				0.67, 0.634,
			],
			[
				0.602, 0.594, 0.601, 0.619, 0.624, 0.6, 0.582, 0.603, 0.643, 0.663, 0.667, 0.699, 0.743,
				0.727, 0.666, 0.624,
			],
			[
				0.577, 0.572, 0.573, 0.574, 0.55, 0.517, 0.516, 0.535, 0.549, 0.563, 0.59, 0.639, 0.694,
				0.69, 0.63, 0.59,
			],
			[
				0.524, 0.518, 0.498, 0.474, 0.462, 0.46, 0.463, 0.474, 0.496, 0.529, 0.567, 0.606, 0.655,
				0.676, 0.619, 0.547,
			],
			[
				0.401, 0.387, 0.398, 0.414, 0.413, 0.405, 0.401, 0.406, 0.426, 0.451, 0.482, 0.518, 0.558,
				0.59, 0.547, 0.457,
			],
			[
				0.402, 0.361, 0.355, 0.376, 0.404, 0.407, 0.384, 0.364, 0.358, 0.374, 0.412, 0.444, 0.455,
				0.468, 0.481, 0.457,
			],
			[
				0.367, 0.306, 0.278, 0.278, 0.272, 0.252, 0.243, 0.248, 0.259, 0.279, 0.311, 0.354, 0.393,
				0.411, 0.426, 0.42,
			],
			[
				0.228, 0.196, 0.159, 0.128, 0.116, 0.128, 0.16, 0.195, 0.219, 0.24, 0.279, 0.33, 0.353,
				0.328, 0.284, 0.253,
			],
			[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.011, 0.046, 0.058, 0.023, 0],
			0,
		],
		source: { method: 'turntable-hull', from: 'oak-turntable.mp4', views: 32 },
	},
	shoots: {
		prototypes: 6,
		classes: [
			{
				// This year's shoot of still 23: a straight twig ending in one rosette of about six
				// leaves round its bud cluster.
				name: 'short',
				vigor: [0, 0.06],
				share: 0.3,
				years: 1,
				length: { mean: 0.12, spread: 0.02 },
				nodes: { mean: 6, spread: 0.5 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.8],
					[1, 0.9],
				],
				leafAngle: [
					[0, 130],
					[0.5, 75],
					[1, 25],
				],
				droop: 3,
			},
			{
				// The twig of stills 10 and 22: last year's shoot, whose end cluster put out this
				// year's rosettes.
				name: 'long',
				vigor: [0.06, 0.3],
				share: 0.35,
				years: 2,
				length: { mean: 0.3, spread: 0.05 },
				nodes: { mean: 6, spread: 1 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 125],
					[0.5, 75],
					[1, 25],
				],
				droop: 5,
			},
			{
				// The branch of still 21: three years of twigs, stiff and angular, with a cluster of
				// rosettes at each end.
				name: 'spray',
				vigor: [0.3, 1],
				share: 0.35,
				years: 3,
				length: { mean: 0.5, spread: 0.1 },
				nodes: { mean: 4, spread: 1 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 125],
					[0.5, 75],
					[1, 25],
				],
				droop: 6,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 1,
		stem: { radius: [0.0035, 0.0025], zigzag: 6 },
		bud: { length: 0.008, width: 0.005, tipCluster: 7 },
		placement: {
			perMetre: [
				[0, 5],
				[1, 7],
			],
			shadePrune: 0.03,
			skyward: 0.75,
			scale: { mean: 1, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.1, spread: 0.02 },
			outline: 'texture',
			petiole: { length: 0.005, radius: 0.0009, flat: 0, droop: 15 },
			fold: 16,
			curl: 18,
			crossCurl: -6,
			twist: 6,
			wave: [0.003, 5],
			optics: {
				reflectance: [0.046, 0.095, 0.026],
				reflectanceBack: [0.15, 0.2, 0.14],
				transmittance: [0.06, 0.14, 0.02],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0 }],
		young: 0,
		youngRadius: 0.015,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		displacement: 0.04,
		collar: { swell: 0.2, length: 1.5, ridge: 0.6 },
		moss: { amount: 0.25, up: 3, north: 0.4, colour: [0.2, 0.22, 0.15] },
	},
	base: {
		flare: { amount: 0.55, height: 0.7 },
		buttress: { lobes: { mean: 6, spread: 1 }, amount: 0.22, sharpness: 2, height: 1.1 },
		flutes: { count: { mean: 9, spread: 2 }, depth: 0.035, height: 1.6 },
	},
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.2, 0.12, 0.03], transmittance: [0.3, 0.16, 0.02] },
	},
	wind: {
		stiffness: [
			[0, 0.97],
			[0.5, 0.85],
			[1, 0.35],
		],
		sway: { frequency: 0.25, amplitude: 0.03 },
		flutter: { kind: 'blade', amplitude: 0.25, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [24, 12, 160],
		woodOrders: [1, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: 6_000_000,
			variantBytes: 4_000_000,
			lod0Triangles: 2_500_000,
			lod1Triangles: 150_000,
			lod2Triangles: 30_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1121298234,
	roundBand: 0.29,
	cuttings: {
		branch: { order: 2, length: 1 },
		subbranch: { order: 2, length: 0.35 },
		cluster: { shoot: 'short' },
	},
};
