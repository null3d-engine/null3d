// The Norway maple, open-grown: a dense, regular, round dome a little wider than it is tall, on a
// short straight bole that forks low into a few steep limbs. Every axis carries opposite, decussate
// pairs of buds and shoots, so the branches fork in twos at right angles. Each shoot ends in a plump
// red-brown bud above the last pair of leaves, and its leaves are single palmate blades of five
// whisker-tipped lobes, on long slender stalks, that crowd into a rosette at the twig's end. The bark
// is a fine, shallow net of interlacing ridges, grey, that fades to smooth olive-grey on thin wood.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// texture source's contour and the single-leaf stills; the bark from the bark stills; the keys and
// the flowers from their stills. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a shoot: one long first internode, then the leaves crowd at its tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 12],
	[0.15, 0.6],
	[1, 0.3],
];

/** Internodes along an older shoot: even along the run, its leaves and twigs in opposite pairs. */
const PAIR: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The Norway maple's record. */
export const record: Species = {
	id: 'norway-maple',
	name: 'Norway maple',
	latin: 'Acer platanoides',
	form: 'dense round dome on a short, low-forking bole',
	// Stills 01, 02 and 18 stand the bole 0.051 to 0.057 of the tree's height across at breast
	// height, so a 20 m tree's bole is about a metre. The fitted crown is 1.14 of the height across,
	// which matches the whole views' widest run against their heights.
	size: { height: { mean: 20, spread: 2 }, dbh: 1.1, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 01 and 02: the crown is a dense net of fine opposite branches, so more lateral buds
		// put out a branch than the light alone gives.
		branching: 1.1,
		// Stills 01, 02 and 18: the foliage's lowest run stands 0.128 to 0.191 of the height, so the
		// bole is clean to about a fifth of the tree, and the crown's underside stands there.
		floor: 0.18,
		// Stills 01, 02 and 18: the great limbs pass round one another rather than through, and only
		// wood above a third of the trunk's girth keeps the clearance, so the crown's fine wood keeps
		// its own layout.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			// Stills 09, 10, 11 and 21: every axis carries opposite pairs of buds, each pair turned a
			// quarter turn from the last.
			arrangement: { kind: 'opposite', decussate: true },
			// Stills 07 and 17: three or four stout limbs leave the short trunk steeply and spread
			// into the dome, so the bud's angle opens with the order.
			angle: [
				[0.25, 46],
				[1, 52],
			],
			angleSpread: 6,
			// Stills 01 and 02: the crown is a dense net of fine opposite branches, so few buds die.
			extinction: [0.01, 0.015],
		},
		// Stills 01, 02 and 18: the crown is a broad dome, so the leader does not outgrow its limbs
		// as an ash's does; several limbs share the crown's top.
		apical: {
			control: [
				[0, 0.54],
				[1, 0.55],
			],
			dominance: [0.7, 0.6, 0.98],
			wander: 12,
		},
		// Stills 07 and 17: a short straight bole divides into three or four limbs a fifth of the way
		// up, the first running on at a slight lean. The wide limbs spread round the dome, as stills
		// 01 and 02's round crowns ask. The fitted outline holds no room below its lowest row, so the
		// fork stands at that row rather than the photographs' two and a half metres.
		divide: { at: 0.21, count: 4, angle: 56, lean: 22, plumb: 4 },
		// Stills 01 and 02: the crown's lit top and rim carry its fullest shoots.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 05 and 06: the limbs run out level and their ends turn up a little, so the shoots
		// bend against gravity most at their tips.
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.22],
				[0.4, 0.04],
				[0.75, 0.06],
				[1, 0.16],
			],
		},
		// Stills 01, 02 and 18: a bud that the righting carried under the crown stands in its shade,
		// and the bole is bare to the crown's base.
		shedding: { threshold: 0.1, cleanBole: 0.19, stubs: 0.2, underCrown: 0.8 },
		// The crown's sag was fitted with the wood weighed at a 3.5 m bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.15, girth: 3.5 },
		forkRule: true,
		kinks: true,
		// Stills 02 and 18: the foliage meets the wood at every twig, so a twig under the far view's
		// pixel draws wood for the leaves to stand on.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// Stills 09, 11 and 23: this year's shoot is short, and its few opposite leaf pairs crowd
				// into a rosette round the plump terminal bud, the oldest leaf hanging lowest and the
				// newest standing upright, so the cluster reads round from every side.
				name: 'short',
				vigor: [0, 0.06],
				share: 0.3,
				years: 1,
				length: { mean: 0.16, spread: 0.03 },
				nodes: { mean: 3, spread: 0.4 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 85],
					[1, 62],
				],
				// The rosette crowds its leaves at one point, so the curve alone gives them one angle
				// and the cluster stands flat. A spread opens them over a range instead.
				leafAngleSpread: 25,
				droop: 2,
			},
			{
				// Stills 09 and 22: last year's shoot, whose opposite pairs of twigs each end in a
				// rosette of leaves round a plump bud.
				name: 'long',
				vigor: [0.06, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.45, spread: 0.08 },
				nodes: { mean: 3, spread: 0.4 },
				internode: PAIR,
				stem: { radius: [0.005, 0.003] },
				// Still 09: each joint carries an exact opposite pair of twigs, both leaving at the one
				// node.
				laterals: 2,
				lateralGap: 0,
				// Still 10: the twigs run nearly straight between their nodes, with only a slight kink.
				bend: { length: 0.07, angle: 18 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 85],
					[1, 62],
				],
				droop: 3,
			},
			{
				// Stills 09 and 21: a limb's last two years of twigs, the older wood bare between the
				// pairs of leafy shoots, each end carrying a rosette round its bud.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 2,
				length: { mean: 1, spread: 0.15 },
				nodes: { mean: 3, spread: 0.4 },
				internode: PAIR,
				stem: { radius: [0.014, 0.006] },
				laterals: 2,
				lateralGap: 0,
				bend: { length: 0.07, angle: 18 },
				leafScale: [
					[0, 0.75],
					[1, 1],
				],
				leafAngle: [
					[0, 85],
					[1, 62],
				],
				droop: 4,
			},
		],
		// Stills 21, 22 and 23: a cut piece is a bare stem that forks once into two leafy shoots, far
		// sparser than the crown's own twigs. The crown cannot carry shoots this open, so the cuttings
		// draw this class and the crown never does.
		cuttingClasses: [
			{
				// Still 22 and the cluster's turn: a current-year shoot of two opposite pairs of leaves
				// round its terminal bud, as the photograph's cluster shows them.
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.14, spread: 0.02 },
				nodes: { mean: 2, spread: 0 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.9],
					[1, 1],
				],
				leafAngle: [
					[0, 85],
					[1, 65],
				],
				leafAngleSpread: 20,
				droop: 2,
			},
			{
				// Stills 21 and 22: last year's wood stands bare below this year's leader, whose opposite
				// leaf pairs run along it, with one opposite pair of side shoots at the joint. The piece's
				// stem stands about a thirtieth of its height across at its foot.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 0.75, spread: 0.2 },
				nodes: { mean: 3, spread: 0.4 },
				internode: PAIR,
				stem: { radius: [0.012, 0.006] },
				laterals: 2,
				lateralGap: 0.3,
				bend: { length: 0.06, angle: 16 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 80],
					[1, 60],
				],
				leafYears: 1,
				droop: 3,
			},
		],
		// Stills 09, 10 and 21: every pair of leaves stands at right angles to the pair below it.
		phyllotaxis: { kind: 'opposite', decussate: true },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Still 10: the twigs are stout and nearly straight between their nodes.
		stem: { radius: [0.004, 0.002], zigzag: 8 },
		// Stills 10 and 23: a plump red-brown bud with a green base, a centimetre or so long, stands
		// at every twig's end with a smaller pair below it.
		bud: {
			length: 0.011,
			width: 0.007,
			tipCluster: 3,
			cluster: { step: 0.25, lean: 45 },
			colour: [0.14, 0.055, 0.035],
		},
		placement: {
			// Stills 01 and 02: the limbs carry foliage along their length, so a limb a third of the
			// way out is leafy rather than bare.
			perMetre: [
				[0, 3],
				[0.55, 6],
				[1, 13],
			],
			// Stills 01 and 02: the crown is a dense mass, and the first round's curve alone left it
			// open, so the dial adds shoots along the finest axes without changing their reach.
			density: 3.8,
			shadePrune: 0,
			// Stills 01, 02 and 18: the crown's mass comes from its cards, and a self-pruning line took
			// shoots that the photographs keep in the crown's middle, so the line is off.
			skyPrune: 0,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.03,
			// Stills 02 and 05: the shoots stand up off their wood, so the foliage rides on the limbs.
			lift: 12,
			// Stills 01 and 02: the crown is wider than tall, and the foliage stands out from the fine
			// wood on long petioles, so each shoot row reaches this far past its bud.
			reach: 20,
			skyward: 0.55,
			scale: { mean: 1.3, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: one palmate blade of five whisker-tipped lobes, its blade broader than
			// it is long. The texture source measures its vertical extent as a share of the canvas,
			// so the record's length is that extent on the photographs' 12 cm leaf.
			length: { mean: 0.12, spread: 0.015 },
			outline: 'texture',
			// Still 12: a long slender stalk runs below the blade for about a fifth of the leaf's
			// extent, and the blade hangs slightly from it.
			petiole: { length: 0.05, radius: 0.0013, flat: 0, droop: 10 },
			fold: 8,
			curl: 10,
			crossCurl: -3,
			twist: 4,
			wave: [0.0015, 4],
			// Stills 24 and 25: the upper face's linear mean and the lower face's paler, matt one, as
			// the textures tool measures them.
			optics: {
				reflectance: [0.1, 0.233, 0.0068],
				reflectanceBack: [0.252, 0.357, 0.092],
				transmittance: [0.17, 0.36, 0.012],
				roughness: [0.42, 0.6],
			},
		},
	},
	bark: {
		// Stills 15 and 26 under the copy-stand lamps: a mid grey with a warm brown cast, so the
		// measured colour stands as it is.
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0, tint: [1, 1, 1] }],
		young: 0,
		// Still 16: the fine net fades to smooth olive-grey on wood thinner than about four
		// centimetres across.
		youngRadius: 0.02,
		// The net's cells stand wider on the thick bole than on the limbs, as stills 15 and 16 show.
		girthScale: [
			[0, 0.45],
			[1, 1],
		],
		// Still 15: the ridges stand shallower than the ash's.
		displacement: 0.022,
		// Stills 07 and 08: a limb meets the bole in a short, tight collar, and a fork closes in a
		// slight swelling.
		collar: { swell: 0.35, length: 1.5, ridge: 0.4 },
		fork: { bend: 2.5, knot: 0.2 },
		// Still 14: no moss or lichen stands on the foot or the lower bole.
		moss: { amount: 0, up: 0, north: 0, colour: [0.14, 0.2, 0.05] },
	},
	base: {
		// Still 14: the foot flares to about 1.3 times the bole half a metre up, on a few soft
		// buttresses that run out over the grass as roots.
		flare: { amount: 0.3, height: 0.5 },
		buttress: {
			lobes: { mean: 5, spread: 1 },
			amount: 0.25,
			sharpness: 2.2,
			height: 0.5,
			round: 0.6,
		},
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 1, spread: 0.2 },
			radius: 0.2,
			dive: 0.3,
			ridge: 0.6,
		},
	},
	extras: [
		{
			// Still 19: pairs of one-winged keys hang in dense bunches from the twig, each a small
			// seed body at the top and a broad green wing below it, the pair's wings spread almost in
			// a straight line.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.15,
			count: { mean: 8, spread: 2 },
			tipShare: 0.85,
			seasons: ['summer', 'autumn'],
			shape: {
				samara: {
					length: 0.035,
					width: 0.011,
					body: 0.2,
				},
				stalk: 0.04,
				pedicel: 0.012,
			},
			colour: [0.26, 0.34, 0.08],
			bandColour: [0.12, 0.1, 0.03],
			stalkColour: [0.2, 0.26, 0.07],
			roughness: [0.6, 0.6],
			hang: 180,
		},
		{
			// Still 20: upright corymbs of small lime-yellow flowers turn the bare crown acid green
			// before the leaves are out.
			kind: 'flower',
			at: 'shoot-tip',
			share: 0.7,
			count: { mean: 16, spread: 3 },
			tipShare: 0.9,
			seasons: ['blossom'],
			shape: { petals: 5, radius: 0.006, cup: 0.003 },
			colour: [0.6, 0.6, 0.08],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.3, 0.2, 0.015], transmittance: [0.42, 0.3, 0.03] },
		blossom: { extra: 1, leaves: 0 },
	},
	wind: {
		// The wind clip's bands, base first: the trunk moves least and the crown most.
		stiffness: [
			[0, 0.9],
			[0.5, 0.92],
			[1, 0.85],
		],
		sway: { frequency: 0.28, amplitude: 0.05 },
		flutter: { kind: 'blade', amplitude: 0.2, frequency: 2.8 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The cards stand well over twice the shoots they picture: the mip lift keeps a far card's
		// coverage, so the whole view's mass comes from the card's own size. Measured on the three
		// whole views, 2.4 brings their sky gaps inside their bands.
		cardGrow: 2.5,
		// Still 01: a card's twig is thinner than a pixel at a whole view, so a card draws its
		// supporting twig as a two-pixel line and the join shows.
		cardStalk: 2,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit measures 3.29, 3.98, 5.41 and 8.17 MB at the four tiers, the three cutting
			// classes and the leaf's palmate blade among them; each cap sits above its figure and the
			// medium one stays under the owner's four-megabyte ceiling.
			kitBytes: { low: 3_300_000, medium: 3_980_000, high: 5_450_000, ultra: 8_250_000 },
			// The crown's dense shoot dial puts 7,182 rosettes on the first variant, which measures
			// 16.42, 16.48, 16.55 and 16.65 MB; each cap sits above it, under the owner's ceiling.
			variantBytes: { low: 16_430_000, medium: 16_490_000, high: 16_560_000, ultra: 16_660_000 },
			lod0Triangles: 2_800_000,
			lod1Triangles: 150_000,
			lod2Triangles: 42_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 20261103,
	roundBand,
	cuttings: {
		// Stills 21 and 22: the branch and the sub-branch take the cut class, which the crown never
		// draws.
		branch: { shoot: 'cut' },
		subbranch: { shoot: 'cut', pick: 1 },
		// Still 23 and the cluster's turn: one short shoot of two opposite leaf pairs round its bud.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
