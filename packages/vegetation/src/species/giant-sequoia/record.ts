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
	//
	// The height is the growth target, not the drawn height: at this target the architectural grower
	// draws 61.565 m at variant 0 and seed 11, 0.435 m under the reference's 62 m band top, with the
	// crown base at 19.230 m of it (a share of 0.312). Read 56.0 as the target the grower aims at,
	// never as the species' height. The figure is provisional until a full round at the head that
	// carries this target.
	size: { height: { mean: 56.0, spread: 4 }, dbh: 6.6, aspect },
	growth: {
		model: 'architectural',
		// Stills 01, 02 and 18: one straight spire from the buttressed foot to its rounded top, with
		// no fork and only the smallest drift off the vertical.
		leader: { curve: 0.6, wander: 1.2, count: 1 },
		tiers: {
			// Stills 01, 02 and 05: boughs leave the trunk one at a time in a spiral, a tier about
			// every metre and a half, thinning and shortening toward the top.
			kind: 'spiral',
			spacing: [
				[0, 2.2],
				[0.5, 1.8],
				[1, 1.1],
			],
			perWhorl: { mean: 1, spread: 0.2 },
			// Stills 05 and 06: a few small boughs fill the gaps between the tiers, so the crown does
			// not read as a regular candelabra.
			between: 0.3,
			// Stills 01, 02 and 18: the lowest live bough stands about a third of the height up.
			start: 0.33,
			// The photographs show no dead brush on the bole: its bark sheds clean.
			deadBelow: { height: 0.33, stubs: 0 },
		},
		orders: [
			{
				// Stills 01, 02 and 17: a bough runs out almost level from a swollen base, longest
				// just above the crown's middle, and turns its tip up under its own weight.
				length: [
					[0, 4.5],
					[0.35, 6.8],
					[0.7, 4.5],
					[1, 2],
				],
				angle: [
					[0, 92],
					[0.5, 88],
					[0.85, 80],
					[1, 68],
				],
				density: 1.4,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0,
				sag: 7,
				upturn: 14,
				curve: 2,
			},
			{
				// Stills 05, 08 and 09: the bough carries short branches, widest toward its end, each
				// one dipping and turning up.
				length: [
					[0, 1.4],
					[0.5, 2.8],
					[1, 3.6],
				],
				angle: [
					[0, 66],
					[1, 52],
				],
				density: 1.05,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.45,
				sag: 5,
				upturn: 12,
				curve: 2,
			},
			{
				// Stills 09, 10 and 11: the last twigs are short ropes of scale shoots, gathered into
				// the clumps that close each bough's end.
				length: [
					[0, 0.45],
					[1, 0.8],
				],
				angle: [
					[0, 58],
					[1, 42],
				],
				density: 3,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.4,
				sag: 3,
				upturn: 8,
				curve: 0,
			},
		],
		// The pipe model fits the column to the record's diameter, and the leader keeps most of its
		// girth at every node, so the trunk runs as the near-parallel column of still 17.
		pipe: { exponent: 2.4, tipRadius: 0.02, leader: 0.8 },
	},
	envelope,
	shoots: {
		prototypes: 4,
		classes: [
			{
				// Stills 10, 11 and 23: this year's shoot, a short even rope of pressed scales with a
				// tuft of free tips at its end.
				name: 'short',
				vigor: [0, 0.62],
				share: 0.62,
				years: 1,
				length: { mean: 0.11, spread: 0.02 },
				nodes: { mean: 24, spread: 3 },
				internode: EVEN,
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 36],
					[1, 26],
				],
				droop: 8,
			},
			{
				// Still 21's branch: a spray of this year's and last year's rope shoots in two or three
				// orders, each short sub-shoot carrying its own tip. The close pieces are sprays, so
				// the shoots run denser and carry their side shafts, as the photographs show.
				name: 'spray',
				vigor: [0.62, 1],
				share: 0.38,
				years: 3,
				length: { mean: 0.32, spread: 0.04 },
				nodes: { mean: 72, spread: 8 },
				internode: EVEN,
				stem: { radius: [0.006, 0.002] },
				lateral: 70,
				laterals: { mean: 3, spread: 0 },
				lateralGap: 0.14,
				bend: { length: 0.04, angle: 15 },
				leafScale: [
					[0, 1.05],
					[1, 1.15],
				],
				leafAngle: [
					[0, 34],
					[1, 24],
				],
				droop: 22,
			},
		],
		// The studio shot of a shoot tip, still 23: a long central rope with its side shoots rising
		// close beside it, its scales dense enough to hide the stem. The crown's own sprays are
		// shorter and open wider, so the close piece takes a class of its own rather than make the
		// crown carry the picture's tuft.
		cuttingClasses: [
			{
				name: 'cut',
				cutOnly: true,
				vigor: [0.62, 1],
				share: 0,
				years: 3,
				length: { mean: 0.38, spread: 0.03 },
				nodes: { mean: 60, spread: 6 },
				internode: EVEN,
				stem: { radius: [0.007, 0.002] },
				lateral: 16,
				laterals: { mean: 3, spread: 0 },
				lateralGap: 0.3,
				bend: { length: 0.04, angle: 15 },
				// A leader's scales reach up to twice a side shoot's, and the picture shows this tuft
				// at that size: each rope reads as a green mass rather than a bare stem.
				leafScale: [
					[0, 1.6],
					[1, 1.8],
				],
				leafAngle: [
					[0, 40],
					[1, 32],
				],
				droop: 6,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 137.5 },
		orders: 3,
		years: 3,
		leafYears: 3,
		stem: { radius: [0.0028, 0.0015], zigzag: 0 },
		// Stills 10 and 12: naked buds hidden among the scales, too small to read as buds.
		bud: { length: 0.002, width: 0.0015, tipCluster: 1 },
		placement: {
			perMetre: [
				[0, 4.2],
				[0.5, 8.4],
				[1, 16.8],
			],
			density: 1.05,
			// Stills 04 and 05: sky and wood show between the clumps, so the crown's inside thins
			// while its lit outer masses stay.
			shadePrune: 0,
			skyPrune: 0.15,
			skyPruneLayer: 1,
			bareTrim: 0.02,
			// Stills 04, 05 and 11: the crown is built of separate rounded clumps, each of them
			// several shoots gathered on the axis, with a finer tufting within each mass.
			tipBias: 0.15,
			clump: { spacing: 1.6, depth: 0.55, fine: { spacing: 0.6, depth: 0.35 } },
			skyward: 0.25,
			scale: { mean: 1.15, spread: 0.12 },
		},
	},
	foliage: {
		kind: 'needle',
		needle: {
			// Stills 10, 12 and 13: awl-shaped scales 3 to 6 mm long, pressed to the shoot so only
			// their sharp tips flare, set about twelve to the centimetre.
			length: { mean: 0.005, spread: 0.001 },
			width: 0.003,
			section: 'awl',
			density: 18,
			angle: 20,
			ranks: 0,
			optics: {
				// The linear ratio of still 01's foliage to the render's, channel by channel: red 0.83,
				// green 0.74 and blue 0.79 (the alder's method, D-334). The faces and the transmitted
				// light take the same ratios, and the close shoot is read beside the whole view.
				reflectance: [0.11, 0.193, 0.098],
				reflectanceBack: [0.284, 0.354, 0.27],
				transmittance: [0.167, 0.266, 0.135],
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
		// The photographs give a flare of about 1.8 times the column at breast height and 2.3 at the
		// ground, carried by the buttress lobes rather than by an even cone, so the taper keeps a
		// third and each lobe swells the rest.
		taper: { amount: 0.3, height: 9 },
		buttress: {
			// Evenly round the column, as the photographs show a sequoia's foot from any side.
			lobes: { mean: 10, spread: 0 },
			amount: 1,
			sharpness: 4,
			height: 4.5,
			round: 0.35,
		},
		roots: {
			count: { mean: 7, spread: 1 },
			length: { mean: 3, spread: 0.6 },
			radius: 0.7,
			// The photographs' roots run out over the litter as rounded ridges, not half buried, so
			// they dive late and stand proud of it.
			dive: 0.12,
			ridge: 1,
		},
		// Stills 03, 15 and 17: long vertical fibrous ridges run up the column, so the flutes fade
		// slowly and high.
		flutes: { count: { mean: 12, spread: 2 }, depth: 0.5, height: 25 },
		// Still 20: an old ground fire burned a hollow up the foot about four metres, its charred
		// wood near black and the new bark rolled over its edges. The hollow faces the plant's +Z
		// side, which the review turns to the camera for the picture.
		scar: {
			from: 0,
			to: 4.2,
			angle: 90,
			width: 46,
			depth: 0.8,
			colour: [0.012, 0.011, 0.009],
			shade: 0.92,
		},
	},
	extras: [
		{
			// Stills 04, 11 and 19: egg-shaped woody cones, 5 to 8 cm long, in rows of wrinkled
			// diamond scales, green on the tree and browning with age.
			kind: 'cone',
			at: 'shoot-tip',
			share: 0.025,
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
				// Still 19: six rows of broad diamond bosses with dark crevices between them, so the
				// close cone reads as overlapping scales rather than one smooth green form.
				sides: 14,
				scales: 6,
				scaled: [0.008, 0.062],
				scaleShade: 0.7,
				scaleJitter: 0.35,
				stalk: 0.004,
				stalkSides: 5,
			},
			// The photographs' fresh cones are a yellow-green, brighter than the cone's shade on the
			// tree; the linear ratios of the picture's cones over the render's are about 1.45 in red
			// and green and 1.05 in blue.
			colour: [0.145, 0.18, 0.053],
			bandColour: [0.2, 0.19, 0.075],
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
		// A shoot's card stands many times the shoot, which reads as a blobby sheet closer than a
		// few tens of pixels, so the real shoots draw from twenty pixels up and the cards serve the
		// whole views alone.
		switchPixels: [20, 12, 160],
		// One card stands for a whole clump of its neighbours' shoots, so a crown of scale ropes
		// closes into the reference's separate masses rather than a scatter of specks.
		cardGrow: 14,
		// A shoot's own twig is under a pixel at a whole view, so each card draws a short stalk
		// down to the wood it grows from and joins the clump to its branch.
		cardStalk: 3,
		cardStalkToFoliage: true,
		// A scale is a millimetre and a half across, under one texel of the default card cell, so the
		// high tiers bake a finer cell and the crown keeps its blue-green at distance.
		cardCell: { low: 64, medium: 64, high: 128, ultra: 128 },
		woodOrders: [1, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 3_400_000, medium: 6_200_000, high: 11_500_000, ultra: 22_000_000 },
			variantBytes: { low: 10_000_000, medium: 11_000_000, high: 12_500_000, ultra: 13_000_000 },
			lod0Triangles: 2_500_000,
			lod1Triangles: 152_000,
			lod2Triangles: 42_800,
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
		// Stills 21 and 22: both pieces are sprays of rope shoots, so the two take the class's
		// prototypes rather than a thick macro axis, whose wood reads several times the photographs'.
		// The sub-branch takes the first prototype, whose all-round turn is the steadier of the two;
		// the second turned the piece nearly edge-on, 201 per cent in height against the fan's 7.
		branch: { shoot: 'spray', pick: 0 },
		subbranch: { shoot: 'spray', pick: 0 },
		// Still 23's shoot tip is a fan of long shoots whose scales hide their stems, and the cutting
		// class draws that tuft; still 11's whole spray with a cone is a different piece and is
		// recorded as a reference conflict.
		cluster: { shoot: 'cut' },
	},
};
