// The small-leaved lime, open-grown: a tall egg-shaped dome, clearly taller than wide, on one
// straight central stem that runs from the ground to the crown's top. Slender branches leave the
// stem all the way up at wide angles, arch out and droop at their ends, and divide into a fine web
// of zigzag red-brown twigs. The leaves stand alternately in two ranks along each twig, one
// heart-shaped blade with a long stalk at every node, and one lopsided red bud above each stalk.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// single-leaf stills and the texture sources; the bark from the bark stills. The record is plain
// data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a shoot: the leaves stand evenly along the run, alternate in one plane. */
const TWO_RANKED: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.85],
];

/** The small-leaved lime's record. */
export const record: Species = {
	id: 'small-leaved-lime',
	name: 'Small-leaved lime',
	latin: 'Tilia cordata',
	form: 'tall egg-shaped dome on one straight central stem',
	// Stills 01, 02 and 18: the bole stands about a thirtieth of the tree's height across at breast
	// height, 0.030 to 0.034 on the silhouette, so a 22 m tree's bole is about three quarters of a
	// metre thick.
	size: { height: { mean: 20.9, spread: 2 }, dbh: 0.72, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 01, 02 and 18: the lowest foliage stands a sixth of the height up, and the bole shows
		// bare below it. The fitted envelope's base sets the deepest room that it fills.
		floor: 0.156,
		// Stills 05, 06 and 07: the great limbs pass round one another rather than through. The rule
		// holds only above a third of the trunk's girth, so the crown's fine wood keeps its own layout.
		clearance: 0.3,
		// Stills 01, 02 and 18: the crown's limbs stand close enough that the dome reads full from
		// every side, so a bud grows a branch more readily than the light alone gives.
		branching: 1.4,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.5, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			// Stills 09, 10, 11 and 22: the leaves stand one at a time, alternate along the twig, in two
			// ranks that hold one plane, so the shoots read flat from the side.
			arrangement: { kind: 'distichous', flatten: 0.7 },
			// Stills 07 and 17: the branches leave the stem at wide angles, 40 to 65 degrees, and climb
			// only gently as they run out.
			angle: [
				[0.25, 52],
				[1, 62],
			],
			angleSpread: 6,
			// Stills 01, 02 and 18: the crown is a dense web of fine twigs, so few buds die.
			extinction: [0.01, 0.015],
		},
		// Stills 01, 02, 17 and 18: one leader carries the crown to its single apex, with the laterals
		// held well below it, so the tree is longer than it is broad.
		apical: {
			control: [
				[0, 0.68],
				[1, 0.7],
			],
			dominance: [0.78, 0.6, 0.98],
			wander: 8,
		},
		// The stem runs on to the crown's top and gives laterals along its whole length, so no single
		// fork splits it: still 17 carries one straight central stem up through the crown.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 02 and 07: the branches arch out and their ends droop below the horizontal, so the
		// finest wood bends away from the sky.
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.08],
				[0.5, 0],
				[1, -0.06],
			],
		},
		// Stills 01, 02 and 18: a bud that the righting carried under the crown stands in its shade,
		// and the bole is bare to the crown's base.
		shedding: { threshold: 0.1, cleanBole: 0.12, stubs: 0.2, underCrown: 0.8 },
		// The crown's own sag was fitted with the wood weighed at a 3 m bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.3, girth: 3 },
		forkRule: true,
		kinks: true,
		// Still 08: a limb forks into two arms that part in a slight knot, so a limb's end keeps its
		// foliage on wood thick enough for the far view to draw.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 5,
		classes: [
			{
				// Stills 10 and 23: this year's shoot is a red-brown zigzag twig, one lopsided red bud at
				// every node, ending in a single terminal bud with a few alternate leaves below it.
				name: 'short',
				vigor: [0, 0.04],
				share: 0.3,
				years: 1,
				length: { mean: 0.16, spread: 0.03 },
				nodes: { mean: 11, spread: 0.5 },
				internode: TWO_RANKED,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 82],
					[1, 68],
				],
				leafAngleSpread: 12,
				droop: 3,
			},
			{
				// Stills 09 and 22: last year's shoot, its alternate leaves in two ranks and its side
				// twigs leaving one at a time at the nodes.
				name: 'long',
				vigor: [0.04, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.42, spread: 0.06 },
				nodes: { mean: 14, spread: 0.5 },
				internode: TWO_RANKED,
				stem: { radius: [0.005, 0.003] },
				laterals: 2,
				lateralGap: 0.35,
				// Still 10: the twigs run in a clear zigzag between the flattened nodes, not as one rod.
				bend: { length: 0.05, angle: 28 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 84],
					[1, 70],
				],
				droop: 4,
			},
			{
				// Still 21: a limb's last years of growth, its alternate twigs along the stem and its
				// leaves in two ranks, drooping slightly at the ends.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 2,
				length: { mean: 1.05, spread: 0.15 },
				nodes: { mean: 17, spread: 0.5 },
				internode: TWO_RANKED,
				stem: { radius: [0.014, 0.006] },
				laterals: 2,
				lateralGap: 0.3,
				bend: { length: 0.06, angle: 28 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 84],
					[1, 68],
				],
				droop: 6,
			},
		],
		// Stills 21, 22 and 23: a cut piece is one slender shoot with a few alternate leaves in two
		// ranks, far sparser than the crown's own sprays. The crown cannot carry a shoot this open, so
		// the cuttings draw these classes and the crown never does. The branch and the sub-branch draw
		// the cut class's two prototypes, and the cluster draws the spur.
		cuttingClasses: [
			{
				// Still 21: a metre of the branch's wood, dividing into three side twigs with alternate
				// leaves in two ranks. Its leaves stand far apart, as the photograph's do.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 3,
				length: { mean: 0.75, spread: 0.15 },
				nodes: { mean: 4, spread: 0.5 },
				internode: TWO_RANKED,
				stem: { radius: [0.005, 0.002] },
				laterals: 2,
				lateral: 85,
				lateralGap: 0.4,
				bend: { length: 0.08, angle: 32 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 84],
					[1, 68],
				],
				droop: 5,
			},
			{
				// Still 23: a shoot tip of five alternate leaves and one terminal red bud.
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.3, spread: 0.04 },
				nodes: { mean: 8, spread: 0.5 },
				internode: TWO_RANKED,
				stem: { radius: [0.004, 0.0025] },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 78],
					[1, 64],
				],
				leafAngleSpread: 12,
				droop: 4,
			},
		],
		// Stills 09, 10 and 11: one leaf at each node, the next turned half a turn from the last, so
		// the leaves stand in two ranks and the spray lies in one plane.
		phyllotaxis: { kind: 'distichous', flatten: 0.7 },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Stills 10 and 22: the twigs are slender, red-brown and clearly zigzag between the nodes.
		stem: { radius: [0.0035, 0.0025], zigzag: 24 },
		// Still 10: one small lopsided red bud stands at every node above the leaf stalk, and a single
		// terminal bud ends the twig. The young bark's own tone carries the bud's colour.
		bud: {
			length: 0.009,
			width: 0.0055,
			tipCluster: 1,
			colour: [0.18, 0.03, 0.015],
		},
		placement: {
			// Stills 01, 02 and 05: the crown is a dense web of small leaves on fine twigs, so every
			// metre of the finest wood carries many shoots.
			perMetre: [
				[0, 4.2],
				[0.55, 5.4],
				[1, 11],
			],
			// Stills 01, 02 and 18: the crown's own box shows about a twentieth of sky, so the shoots
			// stand much denser than the curve alone gives.
			density: 2.1,
			shadePrune: 0,
			// Stills 01, 03 and 05: a little sky shows through the crown's middle and under it, where
			// its own leaves leave a shoot under this share of the sky; the lit outer masses stay.
			skyPrune: 0,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.03,
			// Stills 02 and 05: the shoots stand up off their wood a little, so the foliage rides on
			// the limbs rather than hanging under them.
			lift: 12,
			skyward: 0.55,
			scale: { mean: 1.35, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12, 13 and 24: a small heart-shaped blade about as wide as it is long, its base
			// uneven and notched, its tip a short abrupt point. Still 21's one-metre branch draws its
			// leaves about a thirteenth of its length, and a small-leaved lime's blade runs 3 to 9 cm.
			length: { mean: 0.07, spread: 0.01 },
			outline: 'texture',
			// Stills 11, 12 and 24: a long slender stalk runs below the blade for about two fifths of
			// its length, and hangs the blade away from the twig.
			petiole: { length: 0.028, radius: 0.003, flat: 0, droop: 5 },
			fold: 8,
			curl: 10,
			crossCurl: -4,
			twist: 6,
			wave: [0.0015, 5],
			optics: {
				// Stills 24 and 25: the upper face a deep green and the lower a pale blue-grey, both
				// sampled in linear light. The rust-orange hair tufts in the lower face's vein angles
				// are the mark of this lime and come with the texture.
				reflectance: [0.0394, 0.0926, 0.011],
				reflectanceBack: [0.2674, 0.3228, 0.2011],
				transmittance: [0.09, 0.18, 0.02],
				roughness: [0.45, 0.65],
			},
		},
	},
	bark: {
		// Stills 15 and 26 under the copy-stand lamps: a warm grey, so the measured colour stands as it
		// is and the tint stays at one.
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0, tint: [1, 1, 1] }],
		young: 0,
		// Still 28: the smooth green and red-brown bark, with pale lenticels, holds on wood thinner than
		// about six centimetres across.
		youngRadius: 0.03,
		// The shallow fissures stand wider apart on the thick bole than on the limbs, as stills 15 and
		// 16 show.
		girthScale: [
			[0, 0.5],
			[1, 1],
		],
		// Still 15: the fissures are shallow, long and irregular, between flat ridges.
		displacement: 0.03,
		// Still 07: a limb meets the bole in a short, tight collar.
		collar: { swell: 0.35, length: 1.5, ridge: 0.4 },
		// Still 08: the fork closes in a slight swelling, its arms parting smoothly.
		fork: { bend: 2.5, knot: 0.25 },
		// Still 14: a thin green film of moss over the lower buttresses, reaching about a metre up.
		moss: { amount: 0.6, up: 1, north: 0, colour: [0.14, 0.2, 0.05] },
		// Still 15: pale grey-green lichen flecks the ridges of the lower bole.
		lichen: { amount: 0.25, from: 0.1, to: 0.6, colour: [0.4, 0.42, 0.36] },
	},
	base: {
		// Still 14: the foot flares to about 1.25 times the bole half a metre up, on a few soft
		// buttresses.
		flare: { amount: 0.28, height: 0.5 },
		buttress: {
			lobes: { mean: 4, spread: 1 },
			amount: 0.3,
			sharpness: 2.5,
			height: 0.5,
			round: 0.5,
		},
		// Still 14: a few roots run out over the litter and sink as they go.
		roots: {
			count: { mean: 4, spread: 1 },
			length: { mean: 1, spread: 0.2 },
			radius: 0.35,
			dive: 0.3,
			ridge: 0.9,
		},
		flutes: { count: { mean: 6, spread: 1 }, depth: 0.05, height: 0.8 },
	},
	extras: [
		{
			// Still 19: in midsummer small cream flowers stand in loose clusters at the ends of the
			// year's shoots, each cluster joined to a pale strap-shaped bract. The record draws the
			// flowers as pale five-petalled cups at the shoot tips; the bract is a single flat blade
			// that the extra shapes do not carry.
			kind: 'flower',
			at: 'shoot-tip',
			share: 0.4,
			// Still 19: a lime's flowers stand five to ten together on one stalk, each about a
			// centimetre across, so a site carries a cluster rather than a single small cup.
			count: { mean: 4, spread: 1 },
			seasons: ['blossom'],
			shape: { petals: 5, radius: 0.0015, cup: 0.35 },
			colour: [0.8, 0.78, 0.5],
			hang: 20,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		// A lime turns a clear yellow in autumn.
		autumn: { reflectance: [0.24, 0.17, 0.03], transmittance: [0.3, 0.2, 0.03] },
	},
	wind: {
		// The wind clip's bands: the reference clip sways most in its low and middle bands, so the
		// trunk stays soft up to the crown's base while the blades flutter less than a breeze alone
		// gives, which keeps the top band near its photograph's. The foot's band does not move: a sway
		// record bends the crown where a real tree moves at its foot, a model-shape limit the maple
		// and the ash state in the same words.
		stiffness: [
			[0, 0.5],
			[0.5, 0.55],
			[1, 0.88],
		],
		sway: { frequency: 0.3, amplitude: 0.06 },
		flutter: { kind: 'blade', amplitude: 0.1, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The cards stand half again larger than the shoots they picture, so a gap between one shoot's
		// leaves falls on a neighbour's leaves rather than on sky, and the far crown reads solid.
		cardGrow: 1.87,
		// Stills 01 and 02: a card's twig is thinner than a pixel at a whole view, so a card's leaves
		// read as a piece in air unless its twig is drawn as a line.
		cardStalk: 1.5,
		woodOrders: [2, 1],
		impostor: { views: 12, texels: 128 },
		shadowLevel: 1,
		budget: {
			// The kit holds the crown's three classes and the cuttings' own two; each cap sits just
			// above the measured figure at its tier, at 2.48, 3.85, 6.26 and 10.82 MB, and under the
			// owner's cap for a tree.
			kitBytes: { low: 2_600_000, medium: 4_000_000, high: 6_500_000, ultra: 11_200_000 },
			// The first variant measures 3.21, 3.27, 3.35 and 3.47 MB from the coarsest tier up, and its
			// blossom season, which carries the flowers, 7.00, 7.06, 7.14 and 7.26 MB.
			variantBytes: { low: 7_200_000, medium: 7_300_000, high: 7_400_000, ultra: 7_500_000 },
			lod0Triangles: 2_900_000,
			// The heaviest variant's first card level draws about 62,500 triangles, and its second
			// 28,300, under the owner's 43,000 cap at the finest tier.
			lod1Triangles: 70_000,
			lod2Triangles: 43_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 18,
	roundBand,
	cuttings: {
		// Still 21: a metre of limb that runs out almost as wide as it is tall, its long side twigs
		// leaving almost level with their own stem.
		branch: { shoot: 'cut' },
		// Still 22: one slender shoot of the cut class, its alternate leaves well apart.
		subbranch: { shoot: 'cut', pick: 1 },
		// Still 23: a shoot tip of five alternate leaves and one terminal red bud.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
