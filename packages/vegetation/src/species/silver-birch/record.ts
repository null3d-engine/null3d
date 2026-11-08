// The silver birch, open-grown: a slender tree on a single white bole, its crown a narrow open flame
// that narrows to a soft point, with sky showing through it. The great limbs climb steeply from the
// top of the clear bole and arch, and the fine outer twigs hang straight down in long weeping
// strands. The buds stand alternate along every twig. The leaves are simple diamonds with a long
// tapering point, on stalks of about two centimetres. The bark is white and papery with black
// diamond marks on the trunk, black and cracked into rough plates at the foot, and purple-brown on
// the young twigs. Catkins hang from the shoot ends.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// single-leaf stills and the texture sources; the bark from the bark stills; the catkins from the
// fruit still. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, crownBase, envelope, roundBand } from './fit';
import { forms } from './forms';

/** Internodes along a shoot: even along the run, the leaves alternate to its end. */
const ALTERNATE: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The silver birch's record. */
export const record: Species = {
	id: 'silver-birch',
	name: 'Silver birch',
	latin: 'Betula pendula',
	form: 'slender open flame on a white bole',
	// Stills 01, 02 and 18: the tree stands about two and a half times its crown's width, on a bole
	// about four hundredths of the height across at breast height, so the fit's 0.48 crown over the
	// height holds.
	size: { height: { mean: 21, spread: 2 }, dbh: 0.42, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 09 and 10: the fine twigs divide again and again, and the crown keeps sky between
		// them, so the branching follows the light the crown's own shoots leave.
		branching: 1,
		// Stills 01, 02 and 18: the bole is bare to the crown's base, which the fit puts at 0.22 of
		// the height.
		floor: crownBase,
		// Stills 01 and 02: the great limbs pass round one another rather than through, and only wood
		// above a third of the trunk's girth keeps the clearance, so the fine twigs keep their layout.
		clearance: 0.25,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.5, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 1 }, stool: 0, fused: 0 },
		buds: {
			// Stills 10 and 19: one bud at each node, a fifth of a turn from the last, so the twigs
			// stand alternate along every axis.
			arrangement: { kind: 'spiral', divergence: 137.5 },
			// Stills 07 and 18: the limbs leave the bole steeply and climb, and each fork closes to a
			// narrow V.
			angle: [
				[0.25, 40],
				[1, 46],
			],
			angleSpread: 6,
			// Stills 01 and 18: the crown is open and see-through, so few buds die.
			extinction: [0.015, 0.02],
		},
		// Stills 01 and 18: one leader carries the crown to a soft point, and the tree stands two and
		// a half times as tall as its crown is wide.
		apical: {
			control: [
				[0, 0.55],
				[1, 0.62],
			],
			dominance: [0.78, 0.6, 0.98],
			wander: 12,
		},
		// Still 18: the bole runs straight to the crown's base, then divides into four limbs that
		// leave at about 55 degrees and spread round it, the first running on at 25.
		divide: { at: 0.28, count: 4, angle: 55, lean: 25, plumb: 5 },
		light: { apical: 1, lateral: 1, shadow: [5, 0.05, 2], cells: 96, surface: true },
		// Stills 05, 19 and 01: the limbs arch out and their fine twigs hang straight down, so the
		// tips turn against gravity as the run goes out.
		tropism: {
			photo: 0.03,
			gravi: [
				[0, 0.18],
				[0.4, 0.05],
				[0.75, -0.15],
				[1, -0.3],
			],
		},
		// Stills 01, 02 and 18: the bole is bare to the crown's base, which the fit puts at 0.22 of
		// the height, and no limb below it dies of shade, so the crown keeps its drooping lower rim.
		shedding: { threshold: 0, cleanBole: 0.23, stubs: 0.2, underCrown: 0.5 },
		// Stills 01 and 19: the outer twigs hang and the crown's rim droops, so the wood bends under
		// its load and its tips turn down rather than up.
		bending: { strength: 0.6, upturn: 0.05, girth: 3 },
		forkRule: true,
		kinks: true,
		// Still 08: a limb forks into two arms that part in a narrow V.
		pipe: { exponent: 2.2, tipRadius: 0.008 },
	},
	envelope,
	shoots: {
		prototypes: 4,
		classes: [
			{
				// Still 23's shoot tip: this year's shoot ends in one small pointed bud, with a few
				// alternate leaves below it.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.2, spread: 0.03 },
				nodes: { mean: 7, spread: 0.4 },
				internode: ALTERNATE,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 62],
					[1, 45],
				],
				leafAngleSpread: 12,
				droop: 6,
			},
			{
				// Stills 09 and 22: last year's shoot, its alternate twigs each ending in a small bud
				// above a few leaves.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.4, spread: 0.06 },
				nodes: { mean: 16, spread: 1 },
				internode: ALTERNATE,
				stem: { radius: [0.004, 0.002] },
				laterals: 2,
				lateralGap: 0.45,
				bend: { length: 0.06, angle: 22 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 64],
					[1, 48],
				],
				droop: 5,
			},
			{
				// Stills 01, 10 and 19: a limb's last two years, its fine twigs hanging in long
				// weeping strands with the leaves along them.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 2,
				length: { mean: 0.6, spread: 0.1 },
				nodes: { mean: 24, spread: 1 },
				internode: ALTERNATE,
				stem: { radius: [0.009, 0.004] },
				laterals: 2,
				lateralGap: 0.45,
				bend: { length: 0.07, angle: 24 },
				leafScale: [
					[0, 0.75],
					[1, 1],
				],
				leafAngle: [
					[0, 66],
					[1, 50],
				],
				droop: 8,
			},
		],
		// The close pictures show cut pieces with their leaves spaced along the wood, which the
		// crown's own classes do not: a crown's spray crowds its leaves for the veil, and a cut piece
		// wants the run between them bare. Each close piece takes a class of its own, which the crown
		// never draws.
		cuttingClasses: [
			{
				// Still 21: a branch of about a metre divides into thin twigs that arch out and droop,
				// the leaves alternate along their run and spaced apart.
				name: 'whip',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 1, spread: 0.15 },
				nodes: { mean: 16, spread: 1 },
				internode: ALTERNATE,
				stem: { radius: [0.007, 0.003] },
				laterals: 3,
				lateralGap: 0.35,
				bend: { length: 0.06, angle: 22 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 72],
					[1, 54],
				],
				droop: 24,
			},
			{
				// Still 22: a sub-branch is about thirty-five centimetres of thin arching twig, its
				// alternate leaves along it and two-leaved side shoots at its joints.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.35, spread: 0.05 },
				nodes: { mean: 8, spread: 0.6 },
				internode: ALTERNATE,
				stem: { radius: [0.004, 0.0018] },
				laterals: 2,
				lateralGap: 0.4,
				bend: { length: 0.05, angle: 20 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 70],
					[1, 52],
				],
				droop: 18,
			},
		],
		// Still 19: the weeping twig ends draw as their own piece, with a bud at the tip and leaves
		// along the strand. The crown carries strands this long, so the class is the crown's own.
		// Stills 09, 10 and 19: one bud at each node, a fifth of a turn from the last.
		phyllotaxis: { kind: 'spiral', divergence: 137.5 },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Still 10: the twigs are fine and brown, with a slight zigzag at the nodes.
		stem: { radius: [0.003, 0.0015], zigzag: 5 },
		// Still 23: a small pointed brown bud, about half a centimetre long, at every twig's end.
		bud: {
			length: 0.005,
			width: 0.003,
			tipCluster: 1,
			colour: [0.02, 0.012, 0.008],
		},
		placement: {
			// Stills 01, 02 and 09: the crown's fine twigs carry leaves along their whole run, one
			// leafy strand every few centimetres of wood, and the hanging ends carry the most.
			perMetre: [
				[0, 4.2],
				[0.5, 4.8],
				[1, 9],
			],
			density: 1,
			shadePrune: 0,
			// Stills 01 and 18: the crown is open and the sky shows through it, so its inner shoots
			// thin where their own leaves leave them under this share of the sky.
			skyPrune: 0.1,
			skyPruneLayer: 1,
			// Stills 01 and 19: the hanging strands hang free, and no bare twig runs past them.
			bareTrim: 0.02,
			lift: 8,
			// Stills 10 and 19: the leaves hang down along the strands rather than facing the sky.
			skyward: 0.35,
			scale: { mean: 1.2, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: a diamond blade three to seven centimetres long, here five, on a
			// stalk of about two centimetres, which the texture source draws too.
			length: { mean: 0.05, spread: 0.008 },
			outline: 'texture',
			petiole: { length: 0.022, radius: 0.0012, flat: 0, droop: 12 },
			fold: 5,
			curl: 10,
			crossCurl: 0,
			twist: 6,
			wave: [0.001, 4],
			// Still 24: a fresh light green above and paler below, thin enough to glow in the light.
			optics: {
				reflectance: [0.09, 0.16, 0.03],
				reflectanceBack: [0.14, 0.2, 0.06],
				transmittance: [0.12, 0.22, 0.03],
				roughness: [0.5, 0.65],
			},
		},
	},
	bark: {
		zones: [
			// Still 14: the foot's bark is black and cracked into rough plates, and the black climbs
			// in tongues about a metre up.
			{ layer: 0, by: 'height', from: 0, to: 1, blend: 0.12, tint: [1, 1, 1] },
			// Stills 15 and 26: white and papery above, with black diamond marks and dark lenticel
			// dashes.
			{ layer: 1, by: 'height', from: 0.8, to: 40, blend: 0.2, tint: [1, 1, 1] },
		],
		young: 2,
		// Still 16: the white bark fades to the young purple-brown layer on wood thinner than about
		// four centimetres across.
		youngRadius: 0.02,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		// Still 14: the plates stand deeper than the ash's ridges and the white bark is nearly flat.
		displacement: 0.045,
		collar: { swell: 0.3, length: 1.4, ridge: 0.35 },
		fork: { bend: 2.2, knot: 0.2 },
		// Still 14: moss and lichen over the black foot, up to about a metre, on every side.
		moss: { amount: 0.5, up: 0.9, north: 0.1, colour: [0.15, 0.2, 0.05] },
		lichen: { amount: 0.35, from: 0.02, to: 0.4, colour: [0.4, 0.42, 0.36] },
		// Still 15: black diamond eyes stand where shed limbs were.
		scars: 4,
		// Stills 15 and 34: the chalky white bark lifts in thin horizontal strips that curl away from
		// the wood, over the dark fissures beneath.
		peel: { zone: 1, perSquareMetre: 30, width: { mean: 0.06, spread: 0.02 }, curl: 0.8 },
	},
	base: {
		// Still 14: the foot swells into the root crown, with roots running out over the litter.
		flare: { amount: 0.22, height: 0.4 },
		buttress: {
			lobes: { mean: 3, spread: 1 },
			amount: 0.25,
			sharpness: 2.5,
			height: 0.4,
			round: 0.6,
		},
		roots: {
			count: { mean: 4, spread: 1 },
			length: { mean: 0.9, spread: 0.2 },
			radius: 0.35,
			dive: 0.35,
			ridge: 0.8,
		},
	},
	extras: [
		{
			// Still 35: the fruiting catkins hang from the shoot ends in summer, short and cylindrical.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.08,
			count: { mean: 2, spread: 1 },
			tipShare: 0.9,
			seasons: ['summer', 'autumn'],
			shape: {
				catkin: { length: 0.025, radius: 0.004 },
				stalk: 0.012,
			},
			colour: [0.12, 0.1, 0.04],
			roughness: [0.7, 0.7],
			hang: 90,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		// Still 20: the autumn crown turns a clear yellow.
		autumn: { reflectance: [0.22, 0.16, 0.02], transmittance: [0.34, 0.26, 0.02] },
	},
	wind: {
		// The wind clip's bands, base first: the white bole stands stiff, the crown's lowest fringe of
		// hanging twigs swings most, and the top only flickers.
		stiffness: [
			[0, 0.95],
			[0.2, 0.4],
			[0.45, 0.55],
			[0.8, 0.85],
			[1, 1],
		],
		sway: { frequency: 0.32, amplitude: 0.05 },
		flutter: { kind: 'blade', amplitude: 0.25, frequency: 3.2 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		cardGrow: 1.4,
		// Stills 01 and 19: a card's twig is thinner than a pixel at a whole view, so its leaves read
		// as a piece in air; each card draws its twig as a line and the join shows.
		cardStalk: 1.5,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The largest of the species and its three forms, with about a twentieth to spare: 2.46,
			// 3.81, 6.11 and 10.48 MB. The kit holds the long leafy shoots the fine leaf needs.
			kitBytes: { low: 2_600_000, medium: 4_000_000, high: 6_300_000, ultra: 10_800_000 },
			// The largest variant of the species and its forms: 5.67, 5.76, 5.89 and 6.08 MB.
			variantBytes: { low: 5_800_000, medium: 5_900_000, high: 6_000_000, ultra: 6_200_000 },
			// The mature form's broad crown, with about a seventh to spare: 1.20, 1.22, 1.28 and
			// 1.40 million triangles.
			lod0Triangles: 1_450_000,
			// The same crown's card levels: 77,306, 81,428, 87,000 and 95,174 of the tree cap's
			// 150,000.
			lod1Triangles: 98_000,
			// 35,537, 36,110, 37,036 and 38,667 of the tree cap's 43,000.
			lod2Triangles: 39_500,
			// The birch's two bark zones buy the larger download the owner allows it.
			downloadBytes: 1_300_000,
			downloadHalfBytes: 400_000,
			growMilliseconds: 600,
		},
	},
	roundBand,
	// The young birch of stills 31 and 32, the mature birch of still 33 and the woodland birch of 30.
	forms,
	textures: 'own',
	variants: 6,
	seedSalt: 20221108,
	cuttings: {
		// Still 21: a cut branch of about a metre, its twigs arching out and drooping.
		branch: { shoot: 'whip' },
		// Still 22: the short leafy twig that arches over, which the cutting class draws.
		subbranch: { shoot: 'cut' },
		// Still 23: a twig tip with its alternate leaves and its small bud, spaced along the run.
		cluster: { shoot: 'cut' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
