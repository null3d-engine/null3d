// The pedunculate oak, open-grown: a broad low dome about one and a half times as wide as tall, on
// a short massive bole that forks low into several huge limbs. Limbs leave at wide angles, run out
// almost level and kink between joints. Twigs are short and stiff, with buds crowded at their
// ends, and each year's shoot ends in one rosette of about six lobed leaves round its bud cluster.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot classes from
// the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the texture
// source's contour and the single-leaf stills; the bark from the bark stills. The record is plain
// data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

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
	size: { height: { mean: 20, spread: 2 }, dbh: 3.5, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.25, 50],
				[1, 55],
			],
			angleSpread: 8,
			extinction: [0.02, 0.03],
		},
		apical: {
			control: [
				[0, 0.55],
				[1, 0.55],
			],
			dominance: [0.7, 0.6, 0.98],
			wander: 16,
		},
		divide: { at: 0.25, count: 5, angle: 64, lean: 35 },
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96 },
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.3],
				[0.25, 0],
				[0.5, 0],
				[0.75, 0],
				[1, 0.03],
			],
		},
		shedding: { threshold: 0.1, cleanBole: 0.2, stubs: 0.2 },
		bending: { strength: 0.5, upturn: 0.2 },
		forkRule: true,
		kinks: true,
		pipe: { exponent: 2.3, tipRadius: 0.004 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// This year's shoot of still 23: a straight twig ending in one rosette of about six
				// leaves round its bud cluster. The oldest leaf of the rosette opens widest and hangs
				// the lowest, the newest stands most upright, so the cluster is round from every side.
				name: 'short',
				vigor: [0, 0.04],
				share: 0.3,
				years: 1,
				length: { mean: 0.14, spread: 0.02 },
				nodes: { mean: 10, spread: 0.5 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 150],
					[0.5, 95],
					[1, 40],
				],
				// The rosette crowds its leaves at one point, so the curve alone gives them all one
				// angle and the cluster stands flat. A spread opens them over a range instead.
				leafAngleSpread: 30,
				droop: 3,
			},
			{
				// The twig of stills 10 and 22: last year's shoot, whose end cluster put out this
				// year's rosettes.
				name: 'long',
				vigor: [0.04, 0.2],
				share: 0.35,
				years: 2,
				length: { mean: 0.4, spread: 0.06 },
				nodes: { mean: 6, spread: 1 },
				internode: ROSETTE,
				stem: { radius: [0.006, 0.0035] },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 5,
			},
			{
				// The branch of still 21: three years of twigs, stiff and angular, with a cluster of
				// rosettes at each end.
				name: 'spray',
				vigor: [0.2, 1],
				share: 0.35,
				years: 3,
				length: { mean: 1.15, spread: 0.15 },
				nodes: { mean: 5, spread: 1 },
				internode: ROSETTE,
				stem: { radius: [0.018, 0.007] },
				lateral: 60,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 6,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 2,
		stem: { radius: [0.0035, 0.0025], zigzag: 12 },
		// The reference's own guide puts the cone near a fifteenth of a leaf; the species' buds run 3
		// to 6 mm, so the record takes the top of that range rather than the bottom.
		bud: { length: 0.0085, width: 0.006, tipCluster: 7, colour: [0.34, 0.2, 0.09] },
		placement: {
			perMetre: [
				[0, 0.5],
				[0.55, 0.9],
				[1, 7],
			],
			// The reference's crown is denser than the curve alone gives: this is the dial, not a
			// change of reach or part size. The low limbs now keep the foliage they carry below the
			// bole's line, so the dial sits lower than it did when that foliage was missing.
			density: 0.9,
			// The plates open the crown to the background. A shallow field is enough now: the foliage
			// stands on the upper side of the wood, which opens the crown's underside along the limbs,
			// and a deeper field only scatters it.
			clump: { spacing: 3.4, depth: 0.45 },
			shadePrune: 0.2,
			skyward: 0.65,
			scale: { mean: 1.4, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.12, spread: 0.02 },
			outline: 'texture',
			petiole: { length: 0.005, radius: 0.0009, flat: 0, droop: 15 },
			fold: 16,
			curl: 18,
			crossCurl: -6,
			twist: 6,
			wave: [0.003, 5],
			optics: {
				reflectance: [0.0429, 0.0864, 0.0194],
				reflectanceBack: [0.2344, 0.2975, 0.232],
				transmittance: [0.091, 0.195, 0.0195],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0 }],
		young: 0,
		youngRadius: 0.08,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		displacement: 0.04,
		collar: { swell: 0.45, length: 1.8, ridge: 0.6 },
		moss: { amount: 0.7, up: 1.6, north: 0.3, colour: [0.18, 0.22, 0.06] },
		lichen: { amount: 1, from: 0.6, colour: [0.38, 0.45, 0.34] },
	},
	base: {
		flare: { amount: 0.7, height: 0.6 },
		buttress: { lobes: { mean: 6, spread: 1 }, amount: 0.85, sharpness: 3, height: 1.6 },
		roots: {
			count: { mean: 6, spread: 1 },
			length: { mean: 1.2, spread: 0.3 },
			radius: 0.22,
			dive: 0.25,
		},
		flutes: { count: { mean: 7, spread: 1 }, depth: 0.28, height: 2.2 },
	},
	extras: [
		{
			// The acorn on its long stalk, the peduncle that tells this oak from the sessile oak: three
			// plump nuts on one stalk that forks into short footstalks, each nut in a deep cup of scale
			// rows that holds its top third, the nut swelling smooth below the cup to a small point.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.0475,
			count: { mean: 3, spread: 0 },
			// The acorns stand on the internode below the leaves' rosette, where the twig shows, as
			// the reference's peduncle does, not at the leafy tip.
			tipShare: 0.8,
			seasons: ['summer', 'autumn'],
			shape: {
				// The cup's scale rows cover the top third, its rim is the widest point, and the nut
				// swells smooth below the rim to a small point.
				lathe: [
					[0.0012, 0],
					[0.0034, 0.0016],
					[0.0064, 0.0042],
					[0.0075, 0.0068],
					[0.0064, 0.0078],
					[0.0072, 0.0108],
					[0.0066, 0.014],
					[0.005, 0.018],
					[0.0024, 0.0205],
					[0.001, 0.0215],
					[0, 0.022],
				],
				sides: 24,
				scales: 3,
				scaled: [0, 0.0068],
				stalk: 0.032,
				pedicel: 0.012,
			},
			colour: [0.24, 0.1, 0.03],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.2, 0.12, 0.03], transmittance: [0.3, 0.16, 0.02] },
	},
	wind: {
		stiffness: [
			[0, 0.99],
			[0.5, 0.95],
			[1, 0.8],
		],
		sway: { frequency: 0.25, amplitude: 0.03 },
		flutter: { kind: 'blade', amplitude: 0.25, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The cards stand a quarter larger than the shoots they picture, so a gap between one
		// shoot's leaves falls on a neighbour's leaves rather than on sky.
		cardGrow: 1.25,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// Leaves stand on two years of a shoot's run, which puts a second year's cards into every
			// prototype: the kit measures 5.61 MB at high and 10.65 MB at ultra. Each cap sits just
			// above the measured figure.
			kitBytes: { low: 2_000_000, medium: 3_100_000, high: 5_700_000, ultra: 10_800_000 },
			// The fitted envelope widens the crown, and the wider crown grows about a seventh more
			// leaf card; the thicker bole adds a little more. Each cap sits just above the first
			// variant's measured figure at its tier: 7.94, 8.13, 8.34 and 8.56 MB.
			// The two-year foliage also adds a second year's leaf card to each variant, which takes the
			// largest of the first three to 9.73 MB at ultra; each cap sits just above its figure.
			variantBytes: { low: 9_400_000, medium: 10_200_000, high: 11_300_000, ultra: 11_600_000 },
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
	roundBand,
	cuttings: {
		branch: { shoot: 'spray' },
		subbranch: { shoot: 'long' },
		cluster: { shoot: 'short' },
	},
};
