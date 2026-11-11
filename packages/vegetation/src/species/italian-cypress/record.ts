// The Italian cypress: one straight stem carrying a dense evergreen column of short boughs pressed
// close to the vertical, clothed to the ground in cords of appressed scale leaves. The column runs
// from a short bole at the foot to a narrow rounded point, and its width stays within a fifth of its
// height. The reference set's whole views stand the foliage at the ground, the column about 0.17 as
// wide as the plant is tall, and the boughs at a narrow angle from the stem.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable and the whole
// views; the shoot classes from the studio stills of a bough, a spray and a shoot tip; the scale
// leaf from the texture sources; the bark from the three bark stills. The record is plain data: no
// code runs in it.
import type { Species } from '../../core/record';
import { aspect, crownBase, envelope, roundBand } from './fit';
import { forms } from './forms';

/** The Italian cypress's record. */
export const record: Species = {
	id: 'italian-cypress',
	name: 'Italian cypress',
	latin: 'Cupressus sempervirens',
	form: 'a narrow evergreen column of short upright boughs, foliage from the ground to a rounded point',
	size: { height: { mean: 17, spread: 2 }, dbh: 0.4, aspect },
	growth: {
		model: 'architectural',
		// Stills 01, 02 and 18: the stem runs straight to the tip, with no fork and almost no lean.
		leader: { curve: 1.5, wander: 1.2, count: 1 },
		tiers: {
			// Stills 04, 06 and 17: boughs leave the stem in close rings, all the way from the ground
			// to the tip. They run up the column rather than out of it, and their clothed branchlets
			// build the column's surface.
			kind: 'whorl',
			spacing: [
				[0, 0.75],
				[0.5, 0.6],
				[1, 0.45],
			],
			perWhorl: { mean: 4, spread: 1 },
			between: 1.5,
			// Stills 01 and 18: the foliage begins just above the ground, and the lowest live boughs
			// stand there.
			start: crownBase,
			// Still 14: the bole shows for the height of a foot below the foliage, with no dead stubs
			// on the short clear length.
			deadBelow: { height: 0.02, stubs: 0 },
		},
		orders: [
			{
				// Stills 05, 07 and 08: a bough leaves the stem at a narrow angle and rises almost
				// parallel to it. The lower crown's boughs are the longest, and the column narrows to
				// its point.
				length: [
					[0, 2.5],
					[0.3, 3.6],
					[0.7, 3],
					[1, 1.2],
				],
				angle: [
					[0, 30],
					[0.5, 24],
					[1, 18],
				],
				density: 1,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.1,
				sag: 0,
				upturn: 8,
				curve: 1,
			},
			{
				// Still 09: the side branches crowd the bough in every direction, rise steeply, and run
				// out longest toward its tip.
				length: [
					[0, 0.3],
					[0.5, 0.5],
					[1, 0.3],
				],
				angle: [
					[0, 48],
					[1, 36],
				],
				density: 4,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.25,
				sag: 1,
				upturn: 6,
				curve: 1,
			},
		],
		// Stills 15 and 17: the bole is slim and short under the foliage. The many fine cords give the
		// pipe model its girth, fitted to the record's diameter at breast height.
		pipe: { exponent: 2.2, tipRadius: 0.0008, leader: 0.8 },
	},
	envelope,
	shoots: {
		prototypes: 4,
		classes: [
			{
				// Stills 11, 12 and 23: one cord-like shoot six centimetres long, crowded with whorls
				// of appressed scale leaves and carrying the short side cords.
				name: 'spray',
				vigor: [0, 1],
				share: 1,
				years: 2,
				length: { mean: 0.06, spread: 0.01 },
				nodes: { mean: 6, spread: 1 },
				internode: [
					[0, 1],
					[1, 0.85],
				],
				stem: { radius: [0.0013, 0.0007] },
				leafYears: 2,
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 20],
					[1, 12],
				],
				leafAngleSpread: 6,
				droop: 2,
			},
		],
		// Stills 12 and 13: the scale-leaf sprays stand in whorls of three round the stem, each
		// whorl turned on from the last, so the shoot clothes every side.
		phyllotaxis: { kind: 'whorled', count: 3 },
		orders: 2,
		years: 2,
		leafYears: 2,
		stem: { radius: [0.0013, 0.0007], zigzag: 5 },
		// Still 23: a cypress shows no visible buds at its shoot tip. The record keeps the smallest
		// bud the spec accepts so the tip still meets the wood it grows from.
		bud: { length: 0.0008, width: 0.0006, tipCluster: 1 },
		placement: {
			// Stills 04, 06 and 21: the cords crowd every fine axis, most densely at the lit outer
			// surface, and the column's inner face keeps its shade.
			perMetre: [
				[0, 7],
				[0.5, 17],
				[1, 26],
			],
			density: 1.1,
			tipBias: 0.5,
			shadePrune: 0.12,
			tipPrune: 0.1,
			// Stills 04 and 05: the surface is a dense wall of sprays with shallow crevices, and no
			// open sky reaches the stem inside.
			skyPrune: 0.2,
			skyPruneLayer: 1.2,
			// Stills 01 and 18: nothing bare stands outside the column; a twig left with no spray has
			// died and goes.
			bareTrim: 0.006,
			lift: 20,
			reach: 10,
			skyward: 0.2,
			gather: 0.2,
			scale: { mean: 1, spread: 0.1 },
			// Stills 04 and 05: the column's surface gathers into upright ridges with shallow darker
			// grooves between them, not an even green wall.
			clump: { spacing: 0.3, depth: 0.2, fine: { spacing: 0.1, depth: 0.15 } },
		},
	},
	// Stills 11 to 13, 24 and 25: a leaf is a flattened spray of short cords, each clothed in two
	// ranks of tiny pointed scales. The foliage kind builds the scales itself, since one scale is far
	// below the size a card can hold.
	foliage: {
		kind: 'scale-spray',
		spray: {
			// Stills 11 and 12: the leaf a shoot carries is a flattened spray of two or three short
			// cords, each clothed along its whole length in shingled scale leaves.
			orders: 2,
			segment: 0.022,
			radius: 0.0014,
			// Stills 11, 12 and 22: the side cords stand in the spray's own flat plane, as a cypress
			// frond does.
			flatten: 1,
			// Every shoot draws these same meshes, so one dead cord in a mesh would brown a third of
			// the crown: the column's inner sprays keep their shade instead.
			dead: 0,
			// Stills 12, 13 and 24: a dark green face, a paler grey-green back with the stomatal band,
			// and little light through the thick scale.
			optics: {
				reflectance: [0.055, 0.1, 0.03],
				reflectanceBack: [0.1, 0.15, 0.07],
				transmittance: [0.04, 0.08, 0.025],
				roughness: [0.55, 0.7],
			},
		},
	},
	bark: {
		// Stills 15 and 26: one zone of thin grey-brown bark in long narrow fibrous strips, with
		// red-brown in the furrows. The bark changes little over the short bole. Under the copy
		// stand the plates read 5.1 light and 3.0 too yellow, so the zone darkens and keeps more blue.
		zones: [{ layer: 0, by: 'height', from: 0, to: 22, blend: 1.5, tint: [0.8, 0.78, 0.855] }],
		young: 0,
		// Stills 16 and 28: thin wood carries the redder, finer branch bark. The young source frames
		// wood about five centimetres across, so the split reaches past that radius.
		youngRadius: 0.06,
		// Still 16: the strips are narrow on the thin limbs and broader on the bole.
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		displacement: 0.03,
		// Still 07: the bough leaves the stem in a narrow crotch under a smooth swelling.
		collar: { swell: 0.35, length: 1.2, ridge: 0.35 },
		// Stills 07 and 08: a bough divides in a long narrow fork.
		fork: { bend: 2.2 },
		// Still 16: small scars mark where sprays fell.
		scars: 0.4,
	},
	base: {
		// Still 14: a modest flare in fibrous bark, with a few low root ridges over the litter.
		flare: { amount: 0.14, height: 0.35 },
		taper: { amount: 0.04, height: 0.8 },
		buttress: {
			lobes: { mean: 4, spread: 1 },
			amount: 0.08,
			sharpness: 2.2,
			height: 0.3,
			round: 0.45,
		},
		roots: {
			count: { mean: 3, spread: 1 },
			length: { mean: 0.45, spread: 0.1 },
			radius: 0.18,
			dive: 0.45,
			ridge: 1,
		},
		flutes: { count: { mean: 5, spread: 1 }, depth: 0.02, height: 1 },
	},
	extras: [
		{
			// Still 19: a nearly spherical cone of thick peltate scales, about three centimetres
			// across, standing singly at a node on a short stalk among the sprays.
			kind: 'cone',
			at: 'node',
			share: 0.02,
			count: { mean: 1, spread: 0 },
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.002, 0],
					[0.007, 0.003],
					[0.0115, 0.008],
					[0.0135, 0.015],
					[0.0125, 0.023],
					[0.009, 0.028],
					[0.004, 0.031],
					[0.001, 0.033],
				],
				sides: 8,
				scales: 4,
				scaled: [0.004, 0.03],
				scaleShade: 0.45,
				scaleJitter: 0.25,
				stalk: 0.005,
			},
			colour: [0.13, 0.1, 0.06],
			// The scale faces take the grey-brown of the ripe cone in still 19.
			bandColour: [0.2, 0.16, 0.11],
			roughness: [0.65, 0.85],
			hang: 55,
		},
	],
	seasons: { default: 'summer', deciduous: false, winter: 'evergreen' },
	wind: {
		// The wind clip: the column sways as one stiff mass from the base, the tip most, while the
		// sprays shimmer.
		stiffness: [
			[0, 0.995],
			[0.5, 0.99],
			[1, 0.8],
		],
		sway: { frequency: 0.22, amplitude: 0.02 },
		flutter: { kind: 'needle', amplitude: 0.1, frequency: 2.4 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [50, 12, 160],
		woodOrders: [2, 1],
		// A card stands wider than the shoot it pictures, so the cards of neighbouring shoots meet
		// and the column reads as one mass rather than a scatter of tufts.
		cardGrow: 5.5,
		// A card's cord is thinner than a pixel at a whole view, so the card draws a two-pixel stalk
		// to the wood it grows from and runs it on to the foliage's centre.
		cardStalk: 3,
		cardStalkToFoliage: true,
		// A card holds a whole spray rather than one scale, so the default cell keeps the column's
		// scaly grain at distance.
		cardCell: { low: 64, medium: 64, high: 64, ultra: 64 },
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 3_500_000, medium: 6_300_000, high: 11_800_000, ultra: 22_600_000 },
			variantBytes: { low: 20_000_000, medium: 20_100_000, high: 20_300_000, ultra: 20_700_000 },
			lod0Triangles: 2_900_000,
			lod1Triangles: 155_000,
			lod2Triangles: 43_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1969616979,
	roundBand,
	// Stills 21 to 23: the studio pieces cut from the plant and the kit.
	cuttings: {
		// Still 22: the 35 cm spray, drawn by the kit's longer shoot and at the record's own
		// threefold covering.
		density: 3,
		// Stills 09 and 21: a metre bough clothed along its whole length, at twice the record's
		// covering, because its photograph fills the frame where the spray's leaves it airy.
		branch: { order: 1, length: 1, density: 6 },
		subbranch: { shoot: 'spray', pick: 0 },
		// Still 23 and the close spray stills: one shoot tip with its cords. A piece taken from a
		// shoot prototype carries the prototype's own covering, so no placement density can thin it.
		cluster: { shoot: 'spray', pick: 1 },
	},
	forms,
};
