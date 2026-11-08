// The giant sequoia, open-grown: one immense column of a stem, bare for its lower two fifths and
// widening into a buttressed foot, under a narrow spire of short level boughs that dip and turn up
// at their ends, their tips clothed in dense separate clumps of rope-like scale shoots.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the
// shoot classes from the studio stills of a branch, a sub-branch and a shoot tip; the needle from
// the shoot close-ups; the bark from the trunk and limb stills. The record is plain data: no code
// runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/**
 * Internodes along a shoot's growth unit: even, as a scale-clad shoot runs, with the newest
 * scales crowding a little at the tip.
 */
const EVEN: readonly (readonly [number, number])[] = [
	[0, 1],
	[0.8, 0.9],
	[1, 0.8],
];

/** The giant sequoia's record. */
export const record: Species = {
	id: 'giant-sequoia',
	name: 'Giant sequoia',
	latin: 'Sequoiadendron giganteum',
	form: 'narrow spire of short level boughs on an immense tapering column',
	// The whole-tree stills stand the bole a fifth of the tree's height across at breast height
	// (0.21 in 01, 0.19 in 18), where the buttressed taper still widens it. The pipe radius is the
	// column's own width there, and the base taper adds the flare the photographs show.
	size: { height: { mean: 58, spread: 4 }, dbh: 8.4, aspect },
	growth: {
		model: 'self-organizing',
		years: 45,
		macroOrders: 4,
		// The leader runs on to the tip: stills 01, 02 and 18 show one continuous spire, with no fork
		// below it. Strong apical control keeps a single axis, and the boughs stay short.
		internode: { length: 0.55, ageFactor: 0.985 },
		stems: { count: 1, lean: { mean: 0.6, spread: 0.8 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			// Stills 05 and 07: boughs leave the stem almost level, and each order above them stands
			// steeper, so the spire closes as it rises.
			angle: [
				[0.25, 88],
				[0.5, 74],
				[0.75, 58],
				[1, 44],
			],
			angleSpread: 6,
			extinction: [0.01, 0.04],
			sideOrders: 4,
		},
		apical: {
			control: [
				[0, 0.63],
				[1, 0.63],
			],
			dominance: [0.8, 0.5, 0.9],
			wander: 3,
		},
		// Stills 01 and 18: the crown's outer shell carries its fullest clumps, not a starved rim.
		light: { apical: 1, lateral: 1, shadow: [6, 0.18, 2], cells: 96, surface: true },
		tropism: {
			photo: 0.03,
			// Stills 05 and 07: a bough runs out level and its end lifts, so the low orders take a
			// gentle lift and the fine shoots stand up off the wood.
			gravi: [
				[0, 0.32],
				[0.35, 0],
				[0.8, 0],
				[1, 0.06],
			],
		},
		// Stills 01, 02 and 18: the bole is bare to the crown's base and carries no dead brush below
		// it. Inside the clumps the wood stays: a sequoia's dead inner sprays are part of the crown.
		shedding: { threshold: 0.1, cleanBole: 0.33, stubs: 0.05, underCrown: 1 },
		bending: { strength: 0.5, upturn: 0.35, girth: 8.4 },
		forkRule: true,
		kinks: false,
		// Stills 04, 10 and 11: a clump's shoots are fine wood under dense scales, and the far view
		// must still draw wood under every clump.
		pipe: { exponent: 2.4, tipRadius: 0.02 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// Stills 10, 11 and 23: this year's shoot, a short even rope of pressed scales with a
				// tuft of free tips at its end.
				name: 'short',
				vigor: [0, 0.35],
				share: 0.4,
				years: 1,
				length: { mean: 0.07, spread: 0.015 },
				nodes: { mean: 18, spread: 3 },
				internode: EVEN,
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 36],
					[1, 26],
				],
				droop: 0,
			},
			{
				// Stills 09 and 11: last year's shoot, with a few short side shoots at its end where the
				// clump thickens.
				name: 'long',
				vigor: [0.35, 0.7],
				share: 0.35,
				years: 2,
				length: { mean: 0.14, spread: 0.03 },
				nodes: { mean: 34, spread: 4 },
				internode: EVEN,
				stem: { radius: [0.0035, 0.0015] },
				laterals: 2,
				lateralGap: 0.45,
				bend: { length: 0.03, angle: 12 },
				leafScale: [
					[0, 0.95],
					[1, 1],
				],
				leafAngle: [
					[0, 34],
					[1, 24],
				],
				droop: 2,
			},
			{
				// Still 21's branch: a spray of this year's and last year's rope shoots in two or three
				// orders, each short sub-shoot carrying its own tip.
				name: 'spray',
				vigor: [0.7, 1],
				share: 0.25,
				years: 3,
				length: { mean: 0.3, spread: 0.05 },
				nodes: { mean: 58, spread: 6 },
				internode: EVEN,
				stem: { radius: [0.006, 0.002] },
				lateral: 70,
				laterals: { mean: 3, spread: 0 },
				lateralGap: 0.32,
				bend: { length: 0.04, angle: 15 },
				leafScale: [
					[0, 0.9],
					[1, 1],
				],
				leafAngle: [
					[0, 34],
					[1, 24],
				],
				droop: 4,
			},
		],
		// Stills 10 and 11: the cut spray forks into shorter rope shoots at last year's joint, which
		// the crown's own clumps already carry; the cutting class keeps the photograph's looser spray.
		cuttingClasses: [
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 3,
				length: { mean: 0.26, spread: 0.05 },
				nodes: { mean: 38, spread: 5 },
				internode: EVEN,
				stem: { radius: [0.005, 0.002] },
				lateral: 65,
				laterals: 3,
				lateralGap: 0.3,
				bend: { length: 0.04, angle: 14 },
				leafScale: [
					[0, 0.9],
					[1, 1],
				],
				leafAngle: [
					[0, 34],
					[1, 24],
				],
				droop: 3,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 137.5 },
		orders: 3,
		years: 3,
		leafYears: 3,
		stem: { radius: [0.004, 0.002], zigzag: 0 },
		// Stills 10 and 12: naked buds hidden among the scales, too small to read as buds.
		bud: { length: 0.002, width: 0.0015, tipCluster: 1 },
		placement: {
			perMetre: [
				[0, 6],
				[0.5, 12],
				[1, 26],
			],
			density: 1,
			// Stills 04 and 05: sky and wood show between the clumps, so the crown's inside thins
			// while its lit outer masses stay.
			shadePrune: 0,
			skyPrune: 0.3,
			skyPruneLayer: 1,
			bareTrim: 0.02,
			// Stills 04, 05 and 11: the crown is built of separate rounded clumps, each of them
			// several shoots gathered on the axis, with a finer tufting within each mass.
			clump: { spacing: 0.7, depth: 0.5, fine: { spacing: 0.28, depth: 0.35 } },
			skyward: 0.25,
			scale: { mean: 1, spread: 0.12 },
		},
	},
	foliage: {
		kind: 'needle',
		needle: {
			// Stills 10, 12 and 13: awl-shaped scales 3 to 6 mm long, pressed to the shoot so only
			// their sharp tips flare, set about twelve to the centimetre.
			length: { mean: 0.005, spread: 0.001 },
			width: 0.0016,
			section: 'awl',
			density: 12,
			angle: 28,
			ranks: 0,
			optics: {
				reflectance: [0.05, 0.1, 0.055],
				reflectanceBack: [0.14, 0.2, 0.15],
				transmittance: [0.08, 0.15, 0.07],
				roughness: [0.5, 0.7],
			},
		},
	},
	bark: {
		zones: [
			// Still 15: the trunk's spongy cinnamon-red bark in long vertical fibrous ridges.
			{ layer: 0, by: 'height', from: 0, to: 40, blend: 0.3, tint: [1.02, 0.98, 0.95] },
			// Stills 16 and 03: the upper trunk and the boughs read red still, and the young wood at
			// their tips greyer, which the young layer takes below.
			{ layer: 0, by: 'height', from: 40, to: 58, blend: 0.4, tint: [0.98, 0.92, 0.9] },
		],
		young: 0,
		// Still 16: a bough a few decimetres thick is already smooth grey-brown branch bark.
		youngRadius: 0.22,
		girthScale: [
			[0, 1.4],
			[1, 1],
		],
		displacement: 0.06,
		collar: { swell: 0.45, length: 1.6, ridge: 0.6 },
		fork: { bend: 4 },
		// Stills 03 and 20: the fibrous bark holds little moss on an open-grown tree, and the pale
		// weathered crests of still 15 read as faint lichen.
		lichen: { amount: 0.2, from: 0, colour: [0.42, 0.4, 0.33] },
	},
	base: {
		// Stills 01, 14 and 17: the buttressed foot spreads to about 1.5 times the column, on broad
		// rounded lobes with deep furrows between them.
		flare: { amount: 0.25, height: 1.5 },
		// The column itself widens strongly through its lowest tenth, as still 17 shows, and is
		// nearly parallel above that.
		taper: { amount: 0.5, height: 13 },
		buttress: {
			lobes: { mean: 6, spread: 1 },
			amount: 0.55,
			sharpness: 2,
			height: 3.5,
			round: 0.6,
		},
		roots: {
			count: { mean: 7, spread: 1 },
			length: { mean: 3, spread: 0.6 },
			radius: 0.7,
			dive: 0.3,
			ridge: 0.9,
		},
		// Stills 03, 15 and 17: long vertical fibrous ridges run up the column, so the flutes fade
		// slowly and high.
		flutes: { count: { mean: 10, spread: 2 }, depth: 0.25, height: 25 },
	},
	extras: [
		{
			// Stills 04, 11 and 19: egg-shaped woody cones, 5 to 8 cm long, in rows of wrinkled
			// diamond scales, green on the tree and browning with age.
			kind: 'cone',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 1, spread: 0 },
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.0016, 0],
					[0.009, 0.006],
					[0.016, 0.016],
					[0.021, 0.028],
					[0.023, 0.04],
					[0.021, 0.05],
					[0.016, 0.058],
					[0.009, 0.064],
					[0.003, 0.067],
					[0, 0.068],
				],
				sides: 14,
				scales: 9,
				scaled: [0.008, 0.062],
				scaleShade: 0.45,
				scaleJitter: 0.25,
				stalk: 0.004,
				stalkSides: 5,
			},
			colour: [0.11, 0.16, 0.06],
			bandColour: [0.09, 0.12, 0.05],
			roughness: [0.85, 0.9],
			stalkColour: [0.16, 0.09, 0.05],
			hang: 20,
		},
	],
	seasons: { default: 'summer', deciduous: false, winter: 'evergreen' },
	wind: {
		// A massive tree: the trunk stands almost still and its clumps rock.
		stiffness: [
			[0, 0.995],
			[0.5, 0.97],
			[1, 0.85],
		],
		sway: { frequency: 0.18, amplitude: 0.02 },
		flutter: { kind: 'needle', amplitude: 0.15, frequency: 1.8 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The clumps stand about a fifth larger than their shoots, so the gaps between one clump's
		// shoots fall on a neighbour's scales rather than on sky.
		cardGrow: 1.2,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 3_400_000, medium: 6_000_000, high: 10_000_000, ultra: 18_000_000 },
			variantBytes: { low: 10_000_000, medium: 11_000_000, high: 12_500_000, ultra: 13_000_000 },
			lod0Triangles: 2_500_000,
			lod1Triangles: 150_000,
			lod2Triangles: 30_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 340_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1919802519,
	roundBand,
	cuttings: {
		// Still 21's branch is the spray, and still 22's branchlet the cutting class's looser spray.
		branch: { order: 1, length: 1 },
		subbranch: { shoot: 'cut' },
		// Still 23's shoot tip is the short even rope of this year's shoot.
		cluster: { shoot: 'short' },
	},
};
