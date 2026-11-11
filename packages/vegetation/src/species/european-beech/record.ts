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
 * Internodes of a spray's plate run: two crowded leaves with a short bare stretch between the runs,
 * mild enough that the crown keeps its mass. The cluster's own class carries it, so the plate face
 * fires only on the cutting.
 */
const PLATE_RUN: readonly (readonly [number, number])[] = [
	[0, 1.2],
	[0.2, 0.5],
	[0.45, 0.5],
	[0.6, 1.2],
	[0.85, 0.5],
	[1, 0.5],
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
				internode: ALTERNATE,
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
				internode: ALTERNATE,
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
				// more leaves than the crown's own shoots do. A dozen along each made the piece denser
				// and narrower, so the sprays reach outward instead: the laterals leave wider.
				nodes: { mean: 8, spread: 0.5 },
				// A side spray runs about 1.6 growth units rather than the species' two to 2.4, so
				// the cut piece keeps its breadth without the long sparse arms that stand the branch
				// turn up on its edge.
				arm: { mean: 1.6, spread: 0.2 },
				internode: ALTERNATE,
				stem: { radius: [0.006, 0.003] },
				lateral: 60,
				laterals: 2,
				lateralGap: 0.3,
				leafScale: [
					[0, 0.95],
					[1, 1.2],
				],
				leafAngle: [
					[0, 96],
					[0.5, 86],
					[1, 70],
				],
				droop: 3,
			},
			{
				// Stills 11 and 23: the cluster's own one-year spray, drawn only by the cluster cutting,
				// with the crowding that stands its runs as plates. The crown never draws this class.
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				// A young shoot of the year: short enough that its leaves overlap their neighbours,
				// as the photograph's sprig does.
				length: { mean: 0.35, spread: 0.05 },
				// Five leaves and the bud, where the photograph's sprig holds six large ones. The turn
				// reads 119.5 wide against a band of 101 and 56.5 tall against 25. Three levers leave
				// the spray 84 to 89 mm deep: the five-node class, the larger leaf, and ranks turned a
				// little round the stem. The stills need the two ranks the photograph shows and the
				// turn needs a depth a two-ranked spray does not have; that conflict stands as the
				// row's limit rather than another round.
				nodes: { mean: 5, spread: 0.5 },
				internode: PLATE_RUN,
				// A young shoot's leaves are larger than the crown's, and the photograph's sprig
				// spans its own breadth with six of them. Each node's leaf turns a little past the
				// opposite rank, so the still keeps its two ranks and the turn finds depth.
				phyllotaxis: { kind: 'distichous', flatten: 0.7, turn: 10 },
				leafScale: [
					[0, 1.35],
					[1, 1.65],
				],
				leafAngle: [
					[0, 94],
					[0.5, 88],
					[1, 76],
				],
				droop: 1.5,
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
				[1, 11],
			],
			// The growth's own light drops the shaded shoots: the inner skirt under the crown goes, so
			// the bole to the fork reads, while the lit outer skirt and rim keep their foliage. The
			// shoots this line spares stand behind the cards that a far view draws, so it cannot move
			// a whole view's sky gap: at 0.15 against 0.25, the three gaps moved by two thousandths.
			shadePrune: 0.25,
			// Stills 01, 02, 03 and 05: the crown's own leaves shade its middle, so the shoots there
			// thin and the grey bole and the great limbs read between the foliage masses, while the
			// lit rim keeps its shoots. The shoots this line keeps stand where the far cards draw over
			// them, so it cannot move a whole view's sky gap either: at 0.24 against 0.34, the three
			// gaps moved by two thousandths or less.
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
			// A spray's crowded runs stand in one face; only the cluster's own class crowds.
			plate: true,
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
		// from the texture's own measured depth. Still 15 photographs the trunk 7.4 light units above
		// the measured colour, while still 16's great limb already reads light: only the trunk takes
		// the lift, and a limb stops short of its girth.
		zones: [
			// The trunk's masked close view reads 0.8 light, 2.7 short on red and 2.1 long on yellow,
			// so its lift carries a warmer, less yellow cast.
			{ layer: 0, by: 'radius', from: 0.45, to: 5, blend: 0.05, tint: [1.48, 1.4, 1.58] },
			// The limb's masked view reads 1.7 light and 5.0 short on yellow, so the thinner wood
			// keeps a darker, yellower cast.
			{ layer: 0, by: 'radius', from: 0, to: 0.45, blend: 0.05, tint: [0.95, 0.93, 0.72] },
			// Still 14: the foot's bark reads lighter and yellower than the photograph's grey. The
			// cast fades over 0.2 m centred at 1.1 m, so the fade ends at 1.2 m where the mid-trunk
			// view's frame begins: the foot gains the cast without a hard seam and that view keeps
			// its material.
			{
				layer: 0,
				by: 'radius',
				from: 0,
				to: 5,
				blend: 0.05,
				tint: [1.18, 1.02, 0.9],
				second: { from: 0, to: 1.1, blend: 0.2 },
			},
		],
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
		collar: { swell: 0.45, length: 1.8, ridge: 0.7, creases: 1 },
		// Still 16: the green sits on the limb's upper side, while the bole stays silver-grey; a film
		// over the whole plant gives that, with the upper faces taking most of it. Still 14 keeps a
		// little more on the buttress toes.
		moss: { amount: 0.45, up: 30, north: 0.1, colour: [0.2, 0.3, 0.13] },
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
			count: { mean: 1, spread: 0 },
			// The cupules hang together from one twig: this one a little nearer the tip, the split
			// cupule and its nuts below it, each where the wood shows.
			tipShare: 0.8,
			seasons: ['autumn'],
			// Both cupules belong to one group, so they stand on one shoot.
			group: 0,
			// The burr hangs to one side of the split cupule.
			offset: [0.02, 0, 0],
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
				// Still 19: a burr of soft spines over the whole husk, not a shaded cone.
				bristles: { rows: 6, sides: 16, length: 0.006 },
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
		{
			// Still 19: the split cupule's four valves, opening round the two nuts at the same site.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 1, spread: 0 },
			tipShare: 0.78,
			seasons: ['autumn'],
			// The split cupule stands in the burr's group, on the far side of the shoot.
			group: 0,
			offset: [-0.02, 0, 0],
			shape: { petals: 4, radius: 0.012, cup: 0.35 },
			colour: [0.38, 0.31, 0.16],
			roughness: [0.85, 0.85],
			hang: 180,
		},
		{
			// Still 19: the two glossy three-sided nuts inside the valves, drawn as three-faced lathes.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 2, spread: 0 },
			tipShare: 0.78,
			seasons: ['autumn'],
			// The nuts share the split cupule's site, so they sit inside its valves, a little below
			// their rims.
			group: 0,
			offset: [-0.02, -0.006, 0],
			shape: {
				lathe: [
					[0, 0],
					[0.003, 0.0015],
					[0.0045, 0.004],
					[0.005, 0.007],
					[0.004, 0.0095],
					[0.0016, 0.011],
					[0, 0.0115],
				],
				sides: 3,
				stalk: 0.004,
				pedicel: 0.008,
				stalkSides: 4,
			},
			colour: [0.24, 0.1, 0.035],
			roughness: [0.25, 0.3],
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
		// The far cards grow past the shoots, so their gaps fall on a neighbour's leaves. A step at
		// the leaf back-face base (9d28b90d7) read 0.1174 and 0.0964 against 0.1186 and 0.0942, so
		// the second view stood 0.0022 open; this larger step holds it. The cost is the distant
		// view's outline, 0.8113 to 0.7882, and the silhouette's eight pieces for six.
		cardGrow: 1.15,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The crown's prototypes, whose strongest shoots carry the crown's masses, with two cutting
			// classes beside them: the branched cut twig and the cluster's own spray. 3.30, 3.99, 5.24
			// and 7.70 MB at the four tiers; the owner's tree caps are 3.4, 4, 7.1 and 13 MB.
			kitBytes: { low: 3_350_000, medium: 4_000_000, high: 5_300_000, ultra: 7_800_000 },
			// The blossom and autumn seasons carry the flowers and the fruit, and a seasonal variant at
			// high measures 16,500,724 bytes; the owner's cap for a tree variant is 20 MB.
			variantBytes: { low: 10_500_000, medium: 11_000_000, high: 17_000_000, ultra: 11_500_000 },
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
	// The owner's ruling, and the floors the measured runs used: the broadleaf keeps little wood and
	// less leaf, and coarsens more than any other species, because its crown carries the most.
	sparse: { limbs: 0.32, leaves: 0.38, coarseness: 0.65 },
	roundBand,
	cuttings: {
		// The wide prototype suits the branch's three sprays; the tall one suits the sub-branch.
		branch: { shoot: 'cut', pick: 1 },
		subbranch: { shoot: 'cut', pick: 0 },
		// The shots of the cluster are face-on to the spray's plane, where the first prototype's
		// draw turns it half away.
		cluster: { shoot: 'spur', pick: 0 },
	},
};
