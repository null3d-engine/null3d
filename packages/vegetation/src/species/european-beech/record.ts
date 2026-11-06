// The European beech, open-grown: a broad low dome, wider than tall, on a short massive bole of
// smooth silver-grey bark. The bole forks low into several great limbs that run out nearly level and
// arch down at their ends, so a low skirt of flat leaf sprays hangs almost to the ground. Twigs
// zigzag, each node kinked, and long copper buds stand off them. Alternate oval leaves sit in two
// ranks on flat sprays, so the crown reads as layered shingles rather than a loose sprinkle.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// and the whole-plant stills by the fitting tool (fit.ts); the growth numbers are fitted to the same
// video; the shoot classes from the branch, sub-branch and leaf-cluster stills; the leaf from the
// texture source's contour and the single-leaf stills; the bark from the bark stills. The record is
// plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a growth unit: one long first internode, then the leaves crowd at its tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/** The European beech's record. */
export const record: Species = {
	id: 'european-beech',
	name: 'European beech',
	latin: 'Fagus sylvatica',
	form: 'broad low dome on a short, low-forking bole',
	size: { height: { mean: 20, spread: 2 }, dbh: 2.0, aspect },
	growth: {
		model: 'self-organizing',
		years: 40,
		macroOrders: 4,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 1, spread: 1 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.2, 45],
				[1, 55],
			],
			angleSpread: 8,
			extinction: [0.02, 0.03],
		},
		apical: {
			control: [
				[0, 0.5],
				[1, 0.5],
			],
			dominance: [0.65, 0.6, 0.97],
			wander: 12,
		},
		divide: { at: 0.16, count: 4, angle: 70, lean: 28 },
		light: { apical: 1, lateral: 1.1, shadow: [5, 0.15, 2], cells: 96 },
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.35],
				[0.25, 0],
				[0.5, 0],
				[0.75, 0],
				[1, 0.02],
			],
		},
		shedding: { threshold: 0.08, cleanBole: 0.1, stubs: 0.2 },
		bending: { strength: 0.6, upturn: 0.15 },
		forkRule: true,
		kinks: false,
		pipe: { exponent: 2.4, tipRadius: 0.004 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// This year's shoot of stills 10 and 11: a short zigzag twig in one plane, its leaves in
				// two ranks and a long copper bud at the tip.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.12, spread: 0.02 },
				nodes: { mean: 6, spread: 0.5 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 145],
					[0.5, 95],
					[1, 45],
				],
				droop: 4,
			},
			{
				// The two-year twig of still 10: the copper buds of last year's tip below this year's
				// spray.
				name: 'long',
				vigor: [0.05, 0.25],
				share: 0.35,
				years: 2,
				length: { mean: 0.35, spread: 0.05 },
				nodes: { mean: 6, spread: 1 },
				internode: ROSETTE,
				stem: { radius: [0.005, 0.003] },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 85],
					[1, 55],
				],
				droop: 8,
			},
			{
				// The branch of still 21: three years of zigzag wood fanning into flat sprays.
				name: 'spray',
				vigor: [0.25, 1],
				share: 0.35,
				years: 3,
				length: { mean: 0.9, spread: 0.15 },
				nodes: { mean: 5, spread: 1 },
				internode: ROSETTE,
				stem: { radius: [0.011, 0.004] },
				lateral: 55,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 115],
					[0.5, 80],
					[1, 50],
				],
				droop: 10,
			},
		],
		phyllotaxis: { kind: 'distichous', flatten: 1 },
		orders: 3,
		years: 3,
		leafYears: 1,
		stem: { radius: [0.0035, 0.0025], zigzag: 20 },
		bud: { length: 0.016, width: 0.006, tipCluster: 1, colour: [0.3, 0.17, 0.08] },
		placement: {
			perMetre: [
				[0, 2],
				[0.3, 3],
				[1, 8.2],
			],
			shadePrune: 0.06,
			skyward: 0.4,
			scale: { mean: 1.95, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// The single leaf of stills 12 and 13 and the texture sources 24 and 25: an oval blade,
			// seven pairs of straight parallel veins, a wavy untoothed margin and a very short stalk.
			length: { mean: 0.16, spread: 0.025 },
			outline: 'texture',
			petiole: { length: 0.004, radius: 0.0008, flat: 0, droop: 12 },
			fold: 12,
			curl: 12,
			crossCurl: -4,
			twist: 5,
			wave: [0.002, 4],
			optics: {
				// The texture sources' measured means.
				reflectance: [0.0689, 0.1513, 0.0171],
				reflectanceBack: [0.259, 0.2929, 0.1355],
				transmittance: [0.12, 0.22, 0.028],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		// Still 26: thin, smooth, mottled silver-grey bark with no fissures. The shallow figure comes
		// from the texture's own measured depth.
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0 }],
		young: 0,
		youngRadius: 0.08,
		girthScale: [
			[0, 0.7],
			[1, 1],
		],
		displacement: 0.006,
		// Still 7: the wrinkles gather in the armpit of a limb's joint.
		collar: { swell: 0.35, length: 1.6, ridge: 0.6 },
		moss: { amount: 0.8, up: 2.5, north: 0.25, colour: [0.18, 0.3, 0.12] },
		lichen: { amount: 0.4, from: 0, colour: [0.32, 0.42, 0.28] },
		// The pale eyes along the bole where shed branches were, as stills 7 and 17 show.
		scars: 1.5,
	},
	base: {
		// Still 17: broad smooth buttress roots like an elephant's toes.
		flare: { amount: 0.8, height: 0.5 },
		buttress: { lobes: { mean: 6, spread: 1 }, amount: 0.6, sharpness: 2.5, height: 0.6 },
		roots: {
			count: { mean: 6, spread: 1 },
			length: { mean: 1.0, spread: 0.3 },
			radius: 0.3,
			dive: 0.3,
		},
	},
	extras: [
		{
			// Still 19: a small bristly cupule hanging singly on a short stalk in early autumn, split
			// to show the two three-sided nuts.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.05,
			seasons: ['autumn'],
			shape: {
				lathe: [
					[0.001, 0],
					[0.007, 0.006],
					[0.011, 0.013],
					[0.009, 0.02],
					[0.003, 0.024],
					[0, 0.025],
				],
				scales: 4,
				scaled: [0.004, 0.02],
			},
			colour: [0.3, 0.19, 0.08],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.2, 0.1, 0.03], transmittance: [0.22, 0.1, 0.02] },
	},
	wind: {
		stiffness: [
			[0, 0.98],
			[0.5, 0.95],
			[1, 0.75],
		],
		sway: { frequency: 0.28, amplitude: 0.025 },
		flutter: { kind: 'blade', amplitude: 0.28, frequency: 2.6 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 2_000_000, medium: 2_900_000, high: 5_300_000, ultra: 9_500_000 },
			variantBytes: { low: 10_500_000, medium: 11_000_000, high: 11_200_000, ultra: 11_500_000 },
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
	seedSalt: 2357111317,
	roundBand,
	cuttings: {
		branch: { shoot: 'spray' },
		subbranch: { shoot: 'long' },
		cluster: { shoot: 'short' },
	},
};
