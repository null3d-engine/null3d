// The weeping willow, open-grown: a short stout bole that forks low into a few steep limbs, and a
// broad dome whose whole surface is long first-year shoots hanging almost straight down. The
// curtain reaches nearly to the grass, and it is widest near the bottom of its run. The leaves are
// very narrow lances in alternate ranks along the hanging shoots, light yellow-green above and a
// paler grey-green beneath, so the crown reads silvery where the backs turn out.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts). The shoot classes are fitted from the studio stills of a branch, a
// sub-branch and a leaf cluster; the leaf from the single-leaf stills and the texture sources; the
// bark from the bark stills; the catkins from the spring still. The record is plain data: no code
// runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';
import { forms } from './forms';

/** Internodes along a hanging shoot: even along the run, the leaves in alternate ranks to its end. */
const RANK: readonly (readonly [number, number])[] = [
	[0, 0.95],
	[0.5, 1],
	[1, 0.95],
];

/** The weeping willow's record. */
export const record: Species = {
	// A first pass at the floors a phone's lighter form keeps, set from the species' form and to
	// be measured on the phone set before they are trusted.
	sparse: { limbs: 0.4, leaves: 0.5, coarseness: 0.55 },
	id: 'weeping-willow',
	name: 'Weeping willow',
	latin: 'Salix babylonica',
	form: 'broad hanging dome on a short stout bole',
	// Stills 01, 02 and 18: the bole stands about six hundredths of the tree's height across at
	// breast height, on a tree about thirteen metres tall; the fit's crown is 1.26 of the height
	// wide, so the tree is broader than it is tall.
	size: { height: { mean: 13, spread: 1.5 }, dbh: 0.75, aspect },
	growth: {
		model: 'self-organizing',
		years: 34,
		macroOrders: 3,
		// Stills 09 and 21: the limbs carry leafy shoots along their length, so more lateral buds
		// put out a branch than the light alone gives.
		branching: 1.1,
		// Stills 01, 02 and 18: the limbs pass beside one another rather than through, and each
		// shoot turns aside to keep its air. Only wood above a third of the trunk's girth keeps the
		// clearance, so the hanging curtain keeps its own layout.
		clearance: 0.25,
		clearanceThickness: 0.35,
		turning: 28,
		// Stills 17 and 18: a short bole divides after a few long internodes, so the first limbs
		// leave low over the grass.
		internode: { length: 0.5, ageFactor: 0.97 },
		stems: { count: 1, lean: { mean: 3, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			// Stills 09, 10 and 23: every shoot carries its leaves and buds one at a time, in a
			// spiral up the stem, so the ranks alternate round it.
			arrangement: { kind: 'spiral', divergence: 137.5 },
			// Stills 07 and 18: the great limbs leave the bole steeply and spread as they rise, so
			// each fork opens wider than the last.
			angle: [
				[0.2, 40],
				[0.6, 48],
				[1, 58],
			],
			angleSpread: 8,
			// Stills 01 and 18: the crown is a curtain of fine shoots, so few buds die.
			extinction: [0.01, 0.04],
		},
		// Stills 01, 02 and 18: the crown spreads wider than the bole, and no leader runs on above
		// the fork, so the stem is decurrent.
		apical: {
			control: [
				[0, 0.5],
				[1, 0.42],
			],
			dominance: [0.7, 0.5, 0.94],
			wander: 6,
		},
		// Stills 07, 17 and 18: the bole forks low, about a sixth of the height, into four limbs
		// that leave at about 64 degrees and spread round it, the first running on at 42.
		divide: { at: 0.16, count: 4, angle: 64, lean: 42, plumb: 3 },
		// Still 18: the curtain's lit surface carries its fullest shoots.
		light: { apical: 1.1, lateral: 1.2, shadow: [5, 0.15, 2], cells: 64, surface: true },
		// Stills 01 and 18: the great limbs climb from the fork, then arch out and let their ends
		// fall, so the outer orders turn down while the bole stays upright.
		tropism: {
			photo: 0.05,
			gravi: [
				[0, 0.25],
				[0.34, 0.02],
				[0.6, -0.06],
				[1, -0.1],
			],
		},
		// Stills 02 and 05: the inner limbs stand bare of leaf near the trunk while the curtain's
		// rim stays full, so the shaded wood inside sheds and the lit tips are spared.
		shedding: { threshold: 0.08, cleanBole: 0.12, stubs: 0.03, underCrown: 0.5 },
		// Stills 01 and 02: the long shoots hang almost straight down, so the limbs arch under the
		// curtain's weight and their own line is what the eye reads at the rim.
		bending: { strength: 0.7, upturn: 0.1, girth: 3 },
		forkRule: true,
		kinks: true,
		// Still 08: a limb forks into arms that part in a narrow V, so a limb's end keeps its
		// foliage on wood thick enough for the far view to draw.
		pipe: { exponent: 2.4, tipRadius: 0.005 },
	},
	envelope,
	shoots: {
		prototypes: 5,
		classes: [
			{
				// Stills 11, 19 and 21: the curtain is made of this year's long shoots, hanging
				// almost vertically and carrying leaves in alternate ranks the whole way down.
				name: 'whip',
				vigor: [0.55, 1],
				share: 0.5,
				years: 1,
				length: { mean: 2.6, spread: 0.35 },
				nodes: { mean: 36, spread: 4 },
				internode: RANK,
				stem: { radius: [0.005, 0.0015] },
				leafScale: [
					[0, 0.9],
					[0.5, 1],
					[1, 0.85],
				],
				leafAngle: [
					[0, 28],
					[1, 38],
				],
				leafAngleSpread: 8,
				skyward: 0.15,
				droop: -120,
			},
			{
				// Still 22: last year's shoot hangs on below this year's growth, so the curtain keeps
				// its older strands between the new ones.
				name: 'long',
				vigor: [0.2, 0.55],
				share: 0.3,
				years: 2,
				length: { mean: 1.8, spread: 0.25 },
				nodes: { mean: 24, spread: 3 },
				internode: RANK,
				stem: { radius: [0.008, 0.003] },
				leafScale: [
					[0, 0.9],
					[0.5, 1],
					[1, 0.88],
				],
				leafAngle: [
					[0, 28],
					[1, 38],
				],
				skyward: 0.15,
				droop: -110,
			},
			{
				// Stills 05 and 31: the inner wood and the young tree carry short leafy shoots that
				// fill the gaps behind the long curtain.
				name: 'short',
				vigor: [0, 0.2],
				share: 0.2,
				years: 1,
				length: { mean: 0.45, spread: 0.08 },
				nodes: { mean: 12, spread: 2 },
				internode: RANK,
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 32],
					[1, 42],
				],
				leafAngleSpread: 10,
				skyward: 0.2,
				droop: -25,
			},
		],
		// Still 21: the branch held upright in the clamp rises and arches, its side shoots falling
		// from the upper half; still 22: a short twig with two or three pliant shoots hanging from
		// its end; still 23: the end of one shoot with eight to twelve leaves. A cutting class never
		// offers itself to the crown, so the tree keeps its long hanging shoots.
		cuttingClasses: [
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 1, spread: 0.1 },
				nodes: { mean: 48, spread: 4 },
				internode: [
					[0, 1.6],
					[0.5, 1],
					[1, 0.8],
				],
				stem: { radius: [0.012, 0.006] },
				laterals: { mean: 3, spread: 0 },
				lateralGap: 0.25,
				bend: { length: 0.09, angle: 19 },
				leafScale: [
					[0, 1.25],
					[1, 1.4],
				],
				leafAngle: [
					[0, 22],
					[1, 32],
				],
				leafAngleSpread: 10,
				leafYears: 2,
				// The piece's leaves face across its two ranks rather than up, so a camera looking
				// at the branch's plane sees the blades and not their edges.
				phyllotaxis: { kind: 'distichous', flatten: 0.2 },
				skyward: 0.05,
				droop: 70,
			},
			{
				name: 'spray',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 0.35, spread: 0.04 },
				nodes: { mean: 8, spread: 1 },
				internode: [
					[0, 1.4],
					[1, 0.9],
				],
				stem: { radius: [0.005, 0.003] },
				laterals: { mean: 2, spread: 0.5 },
				lateralGap: 0.3,
				bend: { length: 0.07, angle: 22 },
				leafScale: [
					[0, 1],
					[1, 1.1],
				],
				leafAngle: [
					[0, 30],
					[1, 40],
				],
				leafAngleSpread: 12,
				leafYears: 1,
				skyward: 0.2,
				droop: 60,
			},
			{
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.2, spread: 0.02 },
				nodes: { mean: 8, spread: 1 },
				internode: RANK,
				stem: { radius: [0.003, 0.002] },
				leafScale: [
					[0, 0.85],
					[0.5, 1],
					[1, 0.8],
				],
				leafAngle: [
					[0, 35],
					[1, 48],
				],
				leafAngleSpread: 12,
				skyward: 0.25,
				droop: 3,
			},
		],
		// Stills 11 and 23: one leaf at each node, in two opposite ranks down the shoot, and each
		// blade turned into the shoot's own plane so the ranks join into one narrow falling lance.
		phyllotaxis: { kind: 'distichous', flatten: 0.75 },
		orders: 2,
		years: 2,
		leafYears: 2,
		// Still 10: the hanging shoots are thin and pliant, with no stiff zigzag between the nodes.
		stem: { radius: [0.004, 0.0015], zigzag: 0 },
		// Stills 10 and 23: a small slender bud stands pressed to the shoot in each leaf's axil, and
		// one closes the tip.
		bud: { length: 0.005, width: 0.0025, tipCluster: 1 },
		placement: {
			// Stills 01 and 02: the curtain carries its densest shoots at the limbs' ends and around
			// the rim, where the living surface of the crown is.
			perMetre: [
				[0, 14],
				[0.5, 16],
				[1, 18],
			],
			// Stills 01 and 02: the hanging curtain overlaps into a sheet, so the crown carries
			// more shoots than the fitted dial and shows its sky only between the outer strands.
			density: 2.9,
			shadePrune: 0.08,
			// Stills 05 and 06: the inner limbs stand bare near the trunk, so a tip in the crown's
			// own deepest shade keeps no rosette.
			tipPrune: 0.06,
			// Stills 01, 02 and 06: the bole and its fork read through the curtain, so the deepest
			// interior of the crown thins to the wood while the lit rim keeps its strands.
			skyPrune: 0.35,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twig hangs outside the foliage.
			bareTrim: 0.02,
			// Stills 01 and 19: the shoots leave the wood and fall at once, so the blades hang with
			// the shoot and the curtain breaks into narrow lances.
			lift: 0,
			// Stills 11 and 13: the blades hang along the shoot, their faces turned out where the
			// curtain turns, so the crown reads silvery.
			skyward: 0.12,
			scale: { mean: 1.1, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12, 13 and 24: the blade is a very narrow lance, eight to fifteen centimetres
			// long and one to two wide, widest near the middle, with a long drawn-out point.
			length: { mean: 0.115, spread: 0.015 },
			outline: 'texture',
			// Stills 12 and 24: the blade runs almost to its short stalk, which bends so the blade
			// hangs along the shoot rather than standing out from it.
			petiole: { length: 0.004, radius: 0.0006, flat: 0, droop: 40 },
			fold: 10,
			curl: 18,
			crossCurl: 0,
			twist: 7,
			wave: [0, 0],
			optics: {
				reflectance: [0.1, 0.22, 0.012],
				// The crown draws a mixture of the three faces. Its whole views stand too green and
				// too yellow against their photographs, so the back face and the light through the
				// leaf carry the photograph-to-render ratio per channel: a tenth more red, a little
				// more green and a third more blue. The front face keeps its measured values.
				reflectanceBack: [0.228, 0.298, 0.158],
				transmittance: [0.091, 0.186, 0.026],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		// Stills 14, 15 and 16: the foot, the mid-trunk and the great limbs draw under different light
		// and read apart, so each takes its own tint of the one trunk layer. The foot stands too light
		// and too yellow at the base picture, so it darkens and loses some yellow; the mid trunk and
		// the limbs keep the measured colour until their own figures ask otherwise.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 1, blend: 0.25, tint: [0.75, 0.72, 0.62] },
			{ layer: 0, by: 'height', from: 1, to: 1.9, blend: 0.3, tint: [1, 1, 1] },
			{ layer: 0, by: 'height', from: 1.9, to: 40, blend: 0.5, tint: [1.15, 1.05, 0.18] },
		],
		young: 0,
		// Still 16: the deep ridges fade to smooth grey-green bark on wood thinner than about six
		// centimetres across.
		youngRadius: 0.03,
		// Stills 15 and 16: the ridges stand wide on the thick bole and close on the limbs.
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		// Still 26: the furrows stand deep, deeper than the ash's net.
		displacement: 0.045,
		// Still 07: a limb meets the bole in a short, heavy collar.
		collar: { swell: 0.4, length: 1.2, ridge: 0.6 },
		// Still 08: the fork closes in a knot, its arms parting in a narrow V.
		fork: { bend: 2, knot: 0.3 },
		// Still 14: a green film of moss over the buttresses' flanks, reaching about a metre up.
		moss: { amount: 0.5, up: 1.1, north: 0.2, colour: [0.09, 0.15, 0.05] },
		// Still 15: pale lichen flecks the ridges of the lower bole.
		lichen: { amount: 0.25, from: 0.08, to: 0.45, colour: [0.4, 0.42, 0.36] },
	},
	base: {
		// Still 14: the foot flares to about 1.3 times the bole a metre up, over heavy roots.
		flare: { amount: 0.32, height: 0.6 },
		buttress: {
			lobes: { mean: 4, spread: 1 },
			amount: 0.35,
			sharpness: 2.5,
			height: 0.6,
			round: 0.5,
		},
		// Still 14: thick roots run out over the turf and sink as they go.
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 1.2, spread: 0.25 },
			radius: 0.35,
			dive: 0.3,
			ridge: 0.9,
		},
	},
	extras: [
		{
			// Still 20: slender yellow-green catkins open with the new leaves, hanging at the nodes
			// along the whole length of the flowering shoots.
			kind: 'catkin',
			at: 'node',
			share: 0.15,
			count: { mean: 1, spread: 0 },
			seasons: ['blossom'],
			shape: { catkin: { length: 0.03, radius: 0.0035 } },
			colour: [0.3, 0.34, 0.08],
			hang: 20,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.16, 0.14, 0.03], transmittance: [0.28, 0.2, 0.03] },
		// Still 20: the catkins open as about half the leaves come out.
		blossom: { extra: 0, leaves: 0.55 },
	},
	wind: {
		// The wind clip: the trunk and the great limbs hold while the long shoots swing, but the
		// clip's outline changes little from frame to frame, so the shoots are far stiffer than a
		// free pendulum.
		stiffness: [
			[0, 0.95],
			[0.5, 0.9],
			[1, 0.7],
		],
		sway: { frequency: 0.3, amplitude: 0.004 },
		whips: { fromOrder: 2, pendulum: 0.05 },
		flutter: { kind: 'blade', amplitude: 0.03, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		// The hanging shoots are far longer than any other species', so the cards take over sooner:
		// a shoot of this length spans half a column of pixels at the switch, and the nearer rows
		// carry only the shoots a walk up to the curtain needs.
		switchPixels: [500, 12, 160],
		// The cards stand well past the shoots they picture, so a hanging shoot's card overlaps its
		// neighbours and the far crown reads as one curtain rather than a fringe of specks.
		cardGrow: 4,
		// Stills 01 and 02: a card's twig is thinner than a pixel at a whole view, so each draws its
		// supporting twig as a line and the join shows.
		cardStalk: 4,
		// A hanging shoot's card stands its whole length ahead of the row that draws it, so the
		// stalk runs on to the card's centre and the curtain meets the wood it grows from.
		cardStalkToFoliage: true,
		// Stills 01 and 02: the card's leaves scatter into separate islands at a whole view, so each
		// card also draws its shoot's own axis as one connected strand for the leaves to join.
		cardStrand: 1,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 3_400_000, medium: 6_100_000, high: 11_500_000, ultra: 22_000_000 },
			variantBytes: { low: 19_500_000, medium: 19_800_000, high: 20_000_000, ultra: 20_400_000 },
			lod0Triangles: 2_800_000,
			lod1Triangles: 150_000,
			lod2Triangles: 42_000,
			downloadBytes: 900_000,
			downloadHalfBytes: 320_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 20261108,
	forms,
	roundBand,
	cuttings: {
		// Still 21: a metre of arching branch with its hanging shoots still on it. The shoots share
		// one base and stay in one leaf plane, and the whole piece turns a quarter about its axis so
		// that plane and its side shoots face the frame.
		branch: { shoot: 'cut', shoots: 8, fanRing: 0.06, fanSpin: 0, fanYaw: 90 },
		// Still 22: a short twig with two or three pliant shoots hanging from its end. Its photograph
		// is narrower than the branch's, so the piece turns less about its axis.
		subbranch: { shoot: 'spray', shoots: 3, fanRing: 0.06, fanSpin: 0, fanYaw: 38 },
		// Still 23: the end of one shoot, its narrow leaves in alternate ranks.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
