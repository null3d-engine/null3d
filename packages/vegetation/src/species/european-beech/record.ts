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

/** Internodes along a growth unit: an even spacing, as the beech's leaves alternate along the shoot. */
const ALTERNATE: readonly (readonly [number, number])[] = [
	[0, 1],
	[1, 1],
];

/**
 * Internodes of a plate: short runs where two or three leaves crowd together, with a longer stretch
 * of bare stem between the runs, so the blades overlap in one plane as the photographs' sprays do.
 */
const PLATE: readonly (readonly [number, number])[] = [
	[0, 1.35],
	[0.25, 0.3],
	[0.5, 1.35],
	[0.75, 0.3],
	[1, 1.35],
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
		// Stills 06, 07 and 08: the great limbs pass round one another rather than through, so the
		// grey bole and the low fork show between them as 01 and 02 show it. Only the thick wood keeps
		// the clearance, so the crown's fine twigs keep their own layout.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
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
				// The shoot of stills 10, 11 and 23: a long zigzag twig in one plane, its leaves in
				// two ranks held nearly level and spaced along it, so the blade stands about a fifth
				// of the shoot's length, and a long copper bud at the tip.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.6, spread: 0.06 },
				nodes: { mean: 9, spread: 0.5 },
				internode: PLATE,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 94],
					[0.5, 88],
					[1, 76],
				],
				droop: 1.5,
			},
			{
				// The two-year twig of still 10: the copper buds of last year's tip below this year's
				// spray.
				name: 'long',
				vigor: [0.05, 0.25],
				share: 0.35,
				years: 3,
				length: { mean: 0.7, spread: 0.1 },
				nodes: { mean: 6, spread: 1 },
				internode: ALTERNATE,
				stem: { radius: [0.005, 0.003] },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 100],
					[0.5, 78],
					[1, 52],
				],
				droop: 8,
			},
			{
				// The branch of still 21 and the crown's limb ends: three years of zigzag wood fanning
				// into flat sprays. The strongest shoots carry the most leaves, so the crown's masses
				// gather at the limbs' ends as stills 01 and 02 show them.
				name: 'spray',
				vigor: [0.25, 1],
				share: 0.35,
				years: 3,
				length: { mean: 1.15, spread: 0.15 },
				nodes: { mean: 6, spread: 1 },
				internode: PLATE,
				stem: { radius: [0.011, 0.004] },
				lateral: 55,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 100],
					[0.5, 78],
					[1, 52],
				],
				droop: 10,
			},
		],
		// Stills 21 and 22: a cut twig forks at last year's joint into two long laterals, so the piece
		// ends in three leafy sprays on a bare lower stem. The crown cannot carry twigs this bare, so
		// the cuttings draw a class the crown never does. Its two prototypes differ in how widely they
		// spread, so the branch takes the wide piece and the sub-branch the tall one.
		cuttingClasses: [
			{
				// Stills 21 and 22: a two-year spray, its lower stem bare, forking into two long leafy
				// laterals that reach nearly the axis's own length.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				leafYears: 1,
				length: { mean: 0.95, spread: 0.08 },
				// Stills 21 and 22 hold about forty leaves over their three sprays, so a spray carries
				// more leaves than the crown's own shoots do.
				nodes: { mean: 8, spread: 0.5 },
				internode: ALTERNATE,
				stem: { radius: [0.006, 0.003] },
				lateral: 55,
				laterals: 2,
				lateralGap: 0.3,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 96],
					[0.5, 86],
					[1, 70],
				],
				droop: 3,
			},
		],
		phyllotaxis: { kind: 'distichous', flatten: 1 },
		orders: 3,
		years: 3,
		leafYears: 1,
		stem: { radius: [0.0035, 0.0025], zigzag: 20 },
		// Stills 11 and 23: a long copper bud at each twig's tip, about half a leaf's length and
		// plump, with smaller axillary buds at the nodes below it.
		bud: { length: 0.055, width: 0.018, tipCluster: 1, colour: [0.32, 0.18, 0.08] },
		placement: {
			perMetre: [
				[0, 1.8],
				[0.3, 3],
				[1, 9.5],
			],
			// The growth's own light drops the shaded shoots: the inner skirt under the crown goes, so
			// the bole to the fork reads, while the lit outer skirt and rim keep their foliage.
			shadePrune: 0.25,
			// Stills 01, 02, 03 and 05: the crown's own leaves shade its middle, so the shoots there
			// thin and the grey bole and the great limbs read between the foliage masses, while the
			// lit rim keeps its shoots.
			skyPrune: 0.34,
			skyPruneLayer: 1,
			// Stills 01 and 02: the foliage stands in layered masses at the limbs' ends, with the bole
			// and the great limbs reading between them, rather than spread along every axis.
			tipBias: 0.7,
			// Stills 01 and 02: the low shoots ride up off the limbs, so the sightline to the bole
			// clears while the skirt stays low and full at the rim.
			lift: 15,
			// Stills 01 and 02: no bare twig stands past the leaves at a whole view, so the wood past
			// the last shoot-bearing node is dead and goes.
			bareTrim: 0.03,
			// Stills 01, 02, 03 and 05: the grey bole stands clear to the fork, about a sixth of the
			// height. The column reaches past the inner skirt because a side view sees the foliage
			// beside the trunk as well as on it: at 1.2 m the trunk's own stretch was clear and the
			// near-side skirt still covered the bole. The skirt at the rim, eight to sixteen metres
			// out, keeps its low foliage.
			bareBole: { radius: 4, height: 0.17 },
			skyward: 0.4,
			scale: { mean: 1.95, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// The single leaf of stills 12 and 13 and the texture sources 24 and 25: an oval blade,
			// seven pairs of straight parallel veins, a wavy untoothed margin and a very short stalk.
			// The stalk is a stub rather than the photograph's four millimetres, so a blade drawn on a
			// twig at a cut view meets the wood instead of standing a pixel or two clear of it.
			length: { mean: 0.13, spread: 0.02 },
			outline: 'texture',
			petiole: { length: 0.0015, radius: 0.0012, flat: 0, droop: 12 },
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
		// Stills 16 and 28: the young olive bark runs up the limbs and thin wood, so a limb in a close
		// view still shows its lenticels and ring scars.
		youngRadius: 0.15,
		girthScale: [
			[0, 0.7],
			[1, 1],
		],
		displacement: 0.006,
		// Still 7: the wrinkles gather in the armpit of a limb's joint.
		collar: { swell: 0.45, length: 1.8, ridge: 0.7 },
		// Still 16: the green sits on the limb's upper side, while the bole stays silver-grey; a film
		// over the whole plant gives that, with the upper faces taking most of it. Still 14 keeps a
		// little more on the buttress toes.
		moss: { amount: 0.3, up: 24, north: 0.1, colour: [0.2, 0.3, 0.13] },
		lichen: { amount: 0.12, from: 0, colour: [0.32, 0.42, 0.28] },
		// The pale eyes along the bole where shed branches were, as stills 7 and 17 show.
		scars: 1.5,
	},
	base: {
		// Still 17: broad smooth buttress roots like an elephant's toes.
		flare: { amount: 0.8, height: 0.5 },
		// Still 14: the toes rise from the meadow as rounded flanks with smooth creases between them,
		// not as angular slabs.
		buttress: {
			lobes: { mean: 7, spread: 1 },
			amount: 0.8,
			sharpness: 1.6,
			height: 1.0,
			round: 1,
		},
		roots: {
			count: { mean: 6, spread: 1 },
			length: { mean: 1.1, spread: 0.3 },
			radius: 0.3,
			dive: 0.3,
			// The roots run out as ridges that sink into the leaf litter, as the photograph's do.
			ridge: 0.6,
		},
		// Still 14: deep clefts between the buttress toes run up the foot.
		flutes: { count: { mean: 8, spread: 1 }, depth: 0.18, height: 1.8 },
	},
	extras: [
		{
			// Still 19: two small bristly cupules hanging on slender stalks below the leaves. The
			// drawings show the closed husk; the split one that shows its nuts is not built.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 2, spread: 0.5 },
			// The cupules hang on the stretch below the leaves' cluster, where the twig shows.
			tipShare: 0.82,
			seasons: ['autumn'],
			shape: {
				// A closed husk: a plump body that swells from the stalk and closes again over its top,
				// so no opening faces the light.
				lathe: [
					[0, 0],
					[0.004, 0.003],
					[0.008, 0.007],
					[0.011, 0.012],
					[0.012, 0.017],
					[0.011, 0.022],
					[0.008, 0.026],
					[0.004, 0.029],
					[0, 0.03],
				],
				sides: 12,
				// Still 19's husk is a bed of fine bristles over its whole face, not a smooth urn.
				scales: 9,
				scaled: [0.002, 0.029],
				scaleShade: 0.45,
				scaleJitter: 0.35,
				stalk: 0.025,
				pedicel: 0.005,
				stalkSides: 5,
			},
			colour: [0.3, 0.2, 0.08],
			// The bristle bed stands paler than the husk beneath it, as the photograph's dried spines do.
			bandColour: [0.38, 0.31, 0.16],
			stalkColour: [0.26, 0.2, 0.1],
			roughness: [0.85, 0.95],
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
			[0, 1],
			[0.5, 0.99],
			[1, 0.98],
		],
		sway: { frequency: 0.3, amplitude: 0.018 },
		// The reference's wind clip moves its low skirt most and its crown's top least. The foliage on
		// both ends is the same branch order, so the stiffness cannot tell them apart; the flutter
		// falls with height instead.
		flutter: {
			kind: 'blade',
			amplitude: 0.025,
			frequency: 2.6,
			byHeight: [
				[0, 6],
				[0.25, 4.5],
				[0.5, 1],
				[1, 0.3],
			],
		},
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The crown's leaves are small against the whole view, so their twigs fall below a pixel there
		// and a card reads as a leaf group in air. A two-pixel line draws the twig that carries it,
		// and it runs on to the foliage's own centre: this tree's long shoots put that centre 0.6 to
		// 1.4 m ahead of the row, where the stretch behind the row cannot reach it.
		cardStalk: 2,
		cardStalkToFoliage: true,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The crown's prototypes, whose strongest shoots carry the crown's masses, with the cut
			// twig's own class beside them: 2.45, 3.25, 4.68 and 7.51 MB at the four tiers, and the
			// owner's tree caps are 2.7, 4, 7.1 and 13 MB.
			kitBytes: { low: 2_550_000, medium: 3_350_000, high: 4_850_000, ultra: 7_700_000 },
			variantBytes: { low: 10_500_000, medium: 11_000_000, high: 11_200_000, ultra: 11_500_000 },
			// The crown's strongest shoot carries six leaves a year, which puts the densest near band at
			// 2,702,377 triangles; the owner's cap for a tree is 2,900,000.
			lod0Triangles: 2_750_000,
			lod1Triangles: 150_000,
			// The crown's cards, each with the twig line that ties its leaves to the wood: the densest
			// variant measures 42,687, and the owner's cap for a tree is 43,000.
			lod2Triangles: 42_700,
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
		// The wide prototype suits the branch's three sprays; the tall one suits the sub-branch.
		branch: { shoot: 'cut', pick: 1 },
		subbranch: { shoot: 'cut', pick: 0 },
		// The shots of the cluster are face-on to the spray's plane, where the first prototype's
		// draw turns it half away.
		cluster: { shoot: 'short', pick: 1 },
	},
};
