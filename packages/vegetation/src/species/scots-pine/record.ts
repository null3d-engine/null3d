// The Scots pine, open-grown: one straight bole, bare and orange above a grey plated foot, carrying
// a flat-topped umbrella of nearly level crooked limbs. The crown's foliage stands as separate
// plates of paired blue-green needles at the ends of bare twigs. The reference set's whole views
// stand the bole at about two fifths of the height, the crown about 1.1 times as wide as the tree is
// tall, and its separate masses leave sky through the middle.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable and
// the whole views; the shoot classes from the studio stills of a bough, a shoot and a shoot tip; the
// needle from the texture sources and the single-needle stills; the bark from the three bark stills.
// The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';
import { forms } from './forms';

/** The Scots pine's record. */
export const record: Species = {
	id: 'scots-pine',
	name: 'Scots pine',
	latin: 'Pinus sylvestris',
	form: 'bare straight bole under a flat open umbrella of separate needle plates',
	size: { height: { mean: 20, spread: 2 }, dbh: 0.9, aspect },
	growth: {
		model: 'architectural',
		// Stills 01, 02 and 18: the bole runs straight from its flare to the crown with no fork, and
		// leans no more than a couple of degrees.
		leader: { curve: 2, wander: 2, count: 1 },
		tiers: {
			// Stills 03 and 05: the great limbs leave the trunk in rings, nearly level, a few to a
			// ring, with a long run of bare limb before the foliage. The rings thin toward the top,
			// where the crown's plates lie closest.
			kind: 'whorl',
			spacing: [
				[0, 1.6],
				[0.5, 1.3],
				[1, 0.9],
			],
			perWhorl: { mean: 2, spread: 1 },
			between: 0.1,
			// Stills 01 and 18: the lowest live limbs stand just under half the height, and the
			// needle plates begin a little above them, so the crown's foliage fills the upper half.
			start: 0.52,
			// Stills 05 and 16: short dead stubs stand on the lower trunk, and the knots they leave
			// mark the old whorls above them.
			deadBelow: { height: 0.48, stubs: 1.4 },
		},
		orders: [
			{
				// Stills 01, 02 and 07: a bough runs out almost level to the crown's outline, sags a
				// little, and turns its tufted tip back up. The widest boughs stand just above the
				// crown's middle.
				length: [
					[0, 14],
					[0.3, 13],
					[0.65, 10],
					[1, 5],
				],
				angle: [
					[0, 90],
					[0.5, 88],
					[0.85, 82],
					[1, 68],
				],
				density: 0.8,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0,
				sag: 0,
				upturn: 8,
				curve: 1,
			},
			{
				// Still 09: the side branches leave the bough irregularly and widely, not in a comb,
				// and run out longest towards the bough's tip. A bough carries only a few of them.
				length: [
					[0, 1.2],
					[0.5, 2.8],
					[1, 3.6],
				],
				angle: [
					[0, 72],
					[1, 58],
				],
				density: 0.8,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.55,
				sag: 3,
				upturn: 12,
				curve: 1,
			},
			{
				// Stills 10 and 21: the last twigs are short, stiff and open, and carry the needle
				// brushes at their ends.
				length: [
					[0, 0.4],
					[1, 0.8],
				],
				angle: [
					[0, 62],
					[1, 45],
				],
				density: 4,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.5,
				sag: 2,
				upturn: 8,
				curve: 0,
			},
		],
		// Still 17: the bole is nearly cylindrical over a long run. The many fine twigs give the
		// pipe model the trunk's girth, which is fitted to the record's diameter at breast height.
		pipe: { exponent: 2.3, tipRadius: 0.004, leader: 0.72 },
	},
	envelope,
	shoots: {
		prototypes: 4,
		classes: [
			{
				// Still 10: last year's twig with this year's needle brush at its end. The sheaths of
				// fallen older bundles stand bare behind it.
				name: 'short',
				vigor: [0, 0.6],
				share: 0.62,
				years: 2,
				length: { mean: 0.12, spread: 0.015 },
				nodes: { mean: 50, spread: 2 },
				internode: [
					[0, 1.2],
					[1, 0.8],
				],
				stem: { radius: [0.0018, 0.001] },
				leafYears: 2,
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 60],
					[1, 45],
				],
				leafAngleSpread: 12,
				droop: 2,
			},
			{
				// Still 23: this year's extension shoot, longer and sparser, with the buds of next
				// year's brush crowded at its tip.
				name: 'long',
				vigor: [0.6, 1],
				share: 0.38,
				years: 1,
				length: { mean: 0.22, spread: 0.03 },
				nodes: { mean: 50, spread: 2 },
				internode: [
					[0, 1],
					[1, 0.8],
				],
				stem: { radius: [0.0022, 0.0012] },
				leafYears: 1,
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 55],
					[1, 40],
				],
				leafAngleSpread: 12,
				droop: 1,
				laterals: { mean: 0.6, spread: 0.3 },
				lateralGap: 0.3,
			},
		],
		// Stills 11, 12 and 24: exactly two needles in each papery sheath, spraying in a narrow V.
		phyllotaxis: { kind: 'fascicle', needles: 2 },
		orders: 2,
		years: 2,
		leafYears: 2,
		stem: { radius: [0.0018, 0.001], zigzag: 6 },
		// Still 23: the tip carries a cluster of resinous pointed buds, red-brown, about a centimetre
		// long, gathered into a round bunch.
		bud: {
			length: 0.0075,
			width: 0.0038,
			tipCluster: 5,
			cluster: { step: 0.35, lean: 50 },
			colour: [0.34, 0.13, 0.05],
		},
		placement: {
			// Stills 01, 04 and 20: the needle brushes stand at the ends of the finest twigs, with
			// bare orange twig between them, and gather into dense plates at the crown's rim.
			perMetre: [
				[0, 8],
				[0.5, 30],
				[1, 55],
			],
			density: 1.1,
			tipBias: 0.88,
			shadePrune: 0.08,
			tipPrune: 0.18,
			// Stills 03 and 05: sky and bare limb show through the crown's middle and under it,
			// while the lit outer plates stay.
			skyPrune: 0.3,
			skyPruneLayer: 1.2,
			// Stills 01 and 18: no bare whisker stands outside the crown; a twig left with no shoot
			// has died and goes.
			bareTrim: 0.018,
			lift: 20,
			reach: 12,
			skyward: 0.35,
			// The brushes gather at the nodes, so the internode between them shows bare.
			gather: 0.15,
			scale: { mean: 1.45, spread: 0.12 },
			// Still 20: the crown's top is built of separate plates at different heights, so the
			// foliage gathers into tufts with wood and sky between them.
			clump: { spacing: 1.2, depth: 0.15, fine: { spacing: 0.4, depth: 0.2 } },
		},
	},
	foliage: {
		kind: 'fascicle',
		needle: {
			// Stills 11, 12 and 13: 4 to 7 cm long, about a millimetre and a half wide, stiff and
			// twisted, blue-green above and paler grey-blue below.
			length: { mean: 0.055, spread: 0.008 },
			width: 0.0016,
			section: 'half-round',
			density: 4,
			angle: 55,
			ranks: 0,
			optics: {
				// The blue-green cast of stills 12, 13 and 24: less yellow than the broadleaves, with
				// the blue channel close to the green.
				reflectance: [0.055, 0.1, 0.062],
				reflectanceBack: [0.16, 0.2, 0.175],
				transmittance: [0.08, 0.15, 0.075],
				roughness: [0.5, 0.6],
			},
		},
		// Still 11: the two needles spring from a papery grey sheath about half a centimetre long,
		// and twist about their own length.
		sheath: 0.0047,
		twist: 35,
	},
	bark: {
		// Still 15: the grey-brown plated bark of the lower trunk changes to warm flaking scales at
		// mid-trunk; stills 14 and 16 give each zone's figure.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 10.5, blend: 1.5 },
			{ layer: 1, by: 'height', from: 10.5, to: 40, blend: 1.5 },
		],
		young: 0,
		// Still 28: thin wood carries the orange-brown flaking bark of young branches.
		youngRadius: 0.017,
		// Still 16: the flakes stand small on the thin upper limbs and broad on the bole.
		girthScale: [
			[0, 0.5],
			[1, 1],
		],
		displacement: 0.05,
		// Still 07: the limb leaves the trunk on a long, smooth curve under a ribbed swelling.
		collar: { swell: 0.4, length: 1.8, ridge: 0.5 },
		fork: { bend: 2.5 },
		// Stills 05 and 16: the dead whorls leave knots and eyes down the bole.
		scars: 1.6,
	},
	base: {
		// Still 14: the foot spreads into a wide, shallow flare over several buttress lobes, with
		// thick roots running out over the litter.
		flare: { amount: 0.14, height: 0.4 },
		taper: { amount: 0.06, height: 1 },
		buttress: {
			lobes: { mean: 5, spread: 1 },
			amount: 0.2,
			sharpness: 2.6,
			height: 0.5,
			round: 0.35,
		},
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 1.4, spread: 0.3 },
			radius: 0.4,
			dive: 0.3,
			ridge: 0.8,
		},
		flutes: { count: { mean: 6, spread: 1 }, depth: 0.025, height: 1.4 },
	},
	extras: [
		{
			// Still 19: small ovoid cones with raised pyramidal scale bosses and a blunt prickle,
			// hanging back along the shoot among the needles.
			kind: 'cone',
			at: 'node',
			share: 0.025,
			count: { mean: 1, spread: 0 },
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.003, 0],
					[0.008, 0.004],
					[0.012, 0.01],
					[0.0135, 0.018],
					[0.013, 0.026],
					[0.011, 0.034],
					[0.007, 0.041],
					[0.003, 0.046],
					[0.0008, 0.05],
				],
				sides: 10,
				scales: 8,
				scaled: [0.004, 0.05],
				scaleShade: 0.4,
				scaleJitter: 0.25,
				stalk: 0.006,
			},
			colour: [0.12, 0.085, 0.05],
			// The scale faces take the lighter grey-brown of still 19; the crevices keep the body.
			bandColour: [0.23, 0.17, 0.1],
			roughness: [0.7, 0.9],
			hang: 145,
		},
	],
	seasons: { default: 'summer', deciduous: false, winter: 'evergreen' },
	wind: {
		// The wind clip: the bole and heavy limbs hold while the needle tufts toss at their ends.
		stiffness: [
			[0, 0.98],
			[0.4, 0.93],
			[1, 0.72],
		],
		sway: { frequency: 0.28, amplitude: 0.025 },
		flutter: { kind: 'needle', amplitude: 0.45, frequency: 2.6 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		woodOrders: [2, 1],
		// A brush's card stands a little larger than the shoots it pictures, so gaps between
		// neighbouring brushes fall on needles rather than on sky.
		cardGrow: 3.4,
		// A card's twig is thinner than a pixel at a whole view, so the card draws a two-pixel stalk
		// to the wood it grows from and runs it on to the foliage's centre.
		cardStalk: 3,
		cardStalkToFoliage: true,
		// A needle is a millimetre and a half across, under one texel of the default card cell, so
		// the high tiers bake a cell twice as fine and the crown keeps its blue-green at distance.
		cardCell: { low: 64, medium: 64, high: 128, ultra: 128 },
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 3_200_000, medium: 3_900_000, high: 6_900_000, ultra: 12_800_000 },
			variantBytes: { low: 15_000_000, medium: 16_000_000, high: 17_000_000, ultra: 17_500_000 },
			lod0Triangles: 2_800_000,
			lod1Triangles: 140_000,
			lod2Triangles: 42_000,
			downloadBytes: 1_300_000,
			downloadHalfBytes: 400_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1735287123,
	roundBand,
	// Stills 21 to 23: the studio pieces cut from the plant and the kit.
	cuttings: {
		// Still 21: a one-metre bough with its tufts and cones.
		branch: { order: 1, length: 1 },
		// Still 22: a shoot forking into three, drawn by the kit's longer class.
		subbranch: { shoot: 'long', pick: 0 },
		// Still 23: the tip of one shoot with its buds and paired needles.
		cluster: { shoot: 'short', pick: 0 },
	},
	forms,
};
