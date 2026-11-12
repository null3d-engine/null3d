// The olive, ancient and open-grown: a squat bole of thick twisted columns that stand bare to about
// two fifths of the height, then divide into a few crooked limbs that spread wide round it. The
// crown is a broad, irregular, airy evergreen dome, wider than it is tall, whose outer twigs droop.
// Every young axis carries opposite, decussate pairs of narrow lance-shaped leaves, dull grey-green
// above and silver beneath, and small green drupes hang in the leaf axils. The bark is pale grey,
// deep spiralling ridges broken into small plates, smooth and grey-green on the thin wood.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the
// shoot classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from
// the texture sources and the single-leaf stills; the bark from the bark stills; the fruit from the
// fruit still. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a shoot: the pairs stand evenly along the run, to its tip. */
const PAIR: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The olive's record. */
export const record: Species = {
	id: 'olive',
	name: 'Olive',
	latin: 'Olea europaea',
	form: 'squat bole of twisted columns under a broad, airy evergreen dome',
	// The species' own fact sheet gives the tree 6 to 9 m tall, but the stills' fit puts it at 7 plus
	// or minus 0.8 m, and a plant's target must sample inside that band: a 1.3 m spread drew seed 11
	// at 7.952 m, above the band's top. The mean and the fitted aspect stand as the pictures give them.
	// The trunk's diameter is one stem's: the stool's columns stand within a bole about two and a half
	// metres across, and the silhouette's width at breast height is the stool's, not one stem's.
	size: { height: { mean: 7, spread: 0.8 }, dbh: 1.2, aspect },
	growth: {
		model: 'self-organizing',
		years: 40,
		macroOrders: 4,
		// Stills 05 and 06: the crown is a web of many fine branches along every limb, so more lateral
		// buds put out a branch than the light alone gives.
		branching: 1.25,
		// Stills 01, 02 and 18: the bole stands bare to the crown's underside, which hangs to about a
		// sixth of the height where the outer limbs droop lowest.
		floor: 0.16,
		// Stills 05, 07 and 08: the great limbs pass round one another rather than through, and each
		// turns aside to keep its air. Only wood above a third of the trunk's girth keeps the
		// clearance, so the crown's fine wood keeps its own layout.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.42, ageFactor: 0.99 },
		// Stills 01 and 02: an old stool of three to five twisted columns that stand fused within one
		// bole and lean apart as they rise, each dividing into its own limbs.
		stems: { count: { mean: 4, spread: 1 }, lean: { mean: 8, spread: 3 }, stool: 0.5, fused: 1.2 },
		buds: {
			// Stills 03, 05 and 06: the old wood's limbs leave at uneven spacing round the bole, so
			// their buds stand in the spiral an irregular crown needs, not in pairs.
			arrangement: { kind: 'spiral', divergence: 137.5 },
			// Stills 05 and 18: the great limbs leave the bole at middling angles and the branches
			// above them spread wider, so the crown is broad rather than conical.
			angle: [
				[0.25, 55],
				[1, 62],
			],
			angleSpread: 10,
			// Stills 05 and 06: the crown is a filigree of many fine branches, so few buds die.
			extinction: [0.01, 0.015],
		},
		// Stills 01, 02 and 18: the bole is outgrown by its limbs at the division, so no leader runs
		// on through the crown and the tree stays broader than it is tall.
		apical: {
			control: [
				[0, 0.44],
				[1, 0.48],
			],
			dominance: [0.5, 0.6, 0.95],
			// Stills 05 and 06: the limbs wander and crook as they run out, bending at every joint.
			wander: 22,
		},
		// Stills 01, 02, 05 and 18: the bole divides at about two fifths of the height into five
		// crooked limbs that spread wide round it, the first running on at a low angle.
		divide: { at: 0.38, count: 5, angle: 66, lean: 34, plumb: 6 },
		// Stills 01 and 02: the crown's lit top and rim carry its fullest shoots.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 04, 05 and 06: the great limbs turn up as they run out, and the finest twigs at the
		// crown's rim hang, which is what gives an olive its drooping edge.
		tropism: {
			photo: 0.05,
			gravi: [
				[0, 0.15],
				[0.5, 0.02],
				[0.8, -0.06],
				[1, -0.22],
			],
		},
		// Stills 01, 02 and 18: the bole stands bare to the crown's underside, and wood that the
		// crown's own leaves leave without light dies back rather than standing under it.
		shedding: { threshold: 0.1, cleanBole: 0.2, stubs: 0.2, underCrown: 1 },
		// The crown's sag was fitted with the wood weighed at its own bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.2, girth: 2.1 },
		forkRule: true,
		kinks: true,
		// Stills 02 and 04: the foliage meets the wood at every twig. A finer tip leaves leaf groups
		// hanging off the crown as pieces of their own, since a twig under the far view's pixel draws
		// nothing for them to stand on.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 4,
		classes: [
			{
				// Still 23: this year's shoot, its opposite pairs standing evenly along the run and a
				// small cluster of pointed buds at its tip.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.18, spread: 0.03 },
				nodes: { mean: 5, spread: 0.5 },
				internode: PAIR,
				leafScale: [
					[0, 0.9],
					[1, 1.1],
				],
				leafAngle: [
					[0, 110],
					[0.5, 95],
					[1, 80],
				],
				leafAngleSpread: 20,
				droop: 3,
			},
			{
				// Stills 09 and 21: last year's shoot, whose opposite pairs of twigs each carry their
				// own pairs of leaves and end in a pointed bud.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.4, spread: 0.06 },
				nodes: { mean: 5, spread: 0.6 },
				internode: PAIR,
				stem: { radius: [0.005, 0.003] },
				// Still 09: each joint carries an exact opposite pair of twigs, both leaving at the one
				// node.
				laterals: 2,
				lateralGap: 0.2,
				// Still 10: the twigs run stiff and gently crooked between their nodes, not as one rod.
				bend: { length: 0.06, angle: 26 },
				leafScale: [
					[0, 0.95],
					[1, 1.15],
				],
				leafAngle: [
					[0, 110],
					[0.5, 95],
					[1, 80],
				],
				droop: 4,
			},
			{
				// Still 21: a limb's last years of twigs, the older wood bare between the pairs of
				// leafy shoots, with their leaves in opposite decussate pairs.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 3,
				length: { mean: 0.55, spread: 0.08 },
				nodes: { mean: 7, spread: 0.6 },
				internode: PAIR,
				stem: { radius: [0.012, 0.006] },
				lateral: 70,
				// Still 21: the side twigs leave the stem one at a time, alternating along it, and droop
				// at their ends.
				laterals: { mean: 1.6, spread: 0.4 },
				lateralGap: 0.3,
				bend: { length: 0.06, angle: 28 },
				leafScale: [
					[0, 1],
					[1, 1.2],
				],
				leafAngle: [
					[0, 110],
					[0.5, 95],
					[1, 80],
				],
				droop: 6,
			},
		],
		// Still 23: the studio's shoot tip carries five opposite pairs in one year's growth and a
		// small cluster of pointed buds at its end. The crown's own shoots carry fewer, so the cluster
		// view cuts this class and the crown never does. It stands its blades face on, as a twig held
		// up to the camera shows them, where the crown's leaves turn their faces to the light.
		cuttingClasses: [
			{
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				cutOnly: true,
				years: 1,
				length: { mean: 0.28, spread: 0.03 },
				nodes: { mean: 5.5, spread: 0.4 },
				internode: PAIR,
				phyllotaxis: { kind: 'opposite', decussate: true },
				skyward: 0.5,
				leafScale: [
					[0, 0.9],
					[1, 1.05],
				],
				leafAngle: [
					[0, 110],
					[0.5, 95],
					[1, 80],
				],
				leafAngleSpread: 20,
				droop: 4,
			},
			{
				// Still 22: the sub-branch, a twig about a third of a metre long whose side shoots leave
				// one at a time and droop at their ends.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				cutOnly: true,
				years: 2,
				length: { mean: 0.35, spread: 0.05 },
				nodes: { mean: 5, spread: 0.5 },
				internode: PAIR,
				stem: { radius: [0.005, 0.0025] },
				phyllotaxis: { kind: 'opposite', decussate: true },
				skyward: 0.45,
				lateral: 70,
				laterals: { mean: 1.8, spread: 0.4 },
				lateralGap: 0.3,
				bend: { length: 0.05, angle: 26 },
				leafScale: [
					[0, 0.95],
					[1, 1.15],
				],
				leafAngle: [
					[0, 110],
					[0.5, 95],
					[1, 80],
				],
				droop: 5,
			},
		],
		// Stills 10, 11 and 23: every pair of leaves stands at right angles to the pair below it.
		phyllotaxis: { kind: 'opposite', decussate: true },
		orders: 3,
		years: 3,
		// The olive is evergreen: this year's and last year's shoots both keep their leaves.
		leafYears: 2,
		// Still 10: the twigs are slender and round, a little crooked between their nodes.
		stem: { radius: [0.003, 0.002], zigzag: 8 },
		// Still 23: a small cluster of tiny pointed buds at the shoot's tip, and smaller buds in the
		// axils below it.
		bud: {
			length: 0.002,
			width: 0.0015,
			tipCluster: 3,
			cluster: { step: 0.25, lean: 28 },
			colour: [0.2, 0.22, 0.1],
		},
		placement: {
			// Stills 01, 02 and 05: the limbs carry leafy twigs along their run, so a limb a third of
			// the way out is leafy rather than bare.
			perMetre: [
				[0, 2.5],
				[0.55, 4],
				[1, 24],
			],
			// Stills 01 and 02: the crown's box shows less sky than the photographs, and the curve
			// above carries leafy twigs along every limb, so the dial sits well above the curve's own
			// count.
			density: 2.36,
			shadePrune: 0.1,
			// Stills 01, 03 and 05: sky shows through the crown's middle and under it, where its own
			// leaves leave a shoot under this share of the sky; the lit outer masses stay.
			skyPrune: 0.36,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.05,
			// Stills 02 and 04: the shoots stand a little up off their wood, and their tips hang.
			lift: 5,
			// Stills 04, 11 and 23: the blades lie in the shoot's own planes, not turned up to the sky,
			// so a side view shows their faces rather than their edges.
			skyward: 0.15,
			scale: { mean: 1.25, spread: 0.15 },
			// Stills 01, 02 and 18: the crown's top stands above the photographs' and the plant draws
			// over its height band, so the topmost shoots stand shorter past their twigs while the
			// middle keeps its reach and the crown's foot is untouched.
			scaleByHeight: [
				[0, 1],
				[0.55, 1],
				[0.8, 0.85],
				[1, 0.32],
			],
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: a narrow lance-shaped blade, about five times as long as it is wide,
			// the texture source's contour a little broad for the species.
			length: { mean: 0.065, spread: 0.008 },
			outline: 'texture',
			petiole: { length: 0.005, radius: 0.001, flat: 0, droop: 10 },
			fold: 14,
			curl: 14,
			// Stills 12 and 13: the margins roll a little under, the face above dull and the silver
			// beneath turned toward the ground.
			crossCurl: -6,
			twist: 24,
			wave: [0, 0],
			optics: {
				// Stills 12 and 24: a dull grey-green upper face in flat light.
				reflectance: [0.064, 0.084, 0.051],
				// Stills 13 and 25: the silvery lower face, a dense felt that catches the light.
				reflectanceBack: [0.41, 0.43, 0.38],
				transmittance: [0.05, 0.09, 0.016],
				roughness: [0.42, 0.7],
				sheen: 0.55,
			},
		},
	},
	bark: {
		// Stills 26 and 15: the bole's pale grey, deep spiralling ridges broken into small plates. Still
		// 16: the smoother, paler bark of the great limbs above the bole, which reads sixteen steps
		// lighter than the trunk's under the same light.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 1.4, blend: 0.7, tint: [1.36, 1.04, 0.8] },
			{ layer: 0, by: 'height', from: 1.4, to: 2.6, blend: 1.2 },
			{ layer: 1, by: 'height', from: 2.6, to: 40, blend: 1.2 },
		],
		young: 0,
		// Still 16: the spiralling ridges fade to smooth grey bark on wood thinner than about three
		// centimetres across.
		youngRadius: 0.055,
		// The ridges stand wider on the thick bole than on the limbs, as stills 26 and 16 show.
		girthScale: [
			[0, 0.55],
			[1, 1],
		],
		// Still 15: the furrows between the ridges stand deep, broken into small plates.
		displacement: 0.04,
		// Stills 07 and 08: a limb meets the bole in a long swell, and a fork closes over a burr.
		collar: { swell: 0.5, length: 1.8, ridge: 0.6 },
		fork: { bend: 6, knot: 0.5 },
		// Still 26: pale grey-green lichen flecks the crests of the ridges on the lower bole, with no
		// moss on the dry ground.
		lichen: { amount: 0.3, from: 0.1, to: 1.2, colour: [0.4, 0.42, 0.35] },
	},
	base: {
		// Stills 14 and 20: the foot swells into a massive burred flare, about 1.6 times the bole a
		// quarter metre up.
		flare: { amount: 0.15, height: 0.25 },
		// Still 14: a few deep lobes with knobbly crests, each fading by about half a metre, and the
		// furrows between them run up the bole as flutes.
		buttress: {
			lobes: { mean: 5, spread: 1 },
			amount: 0.55,
			sharpness: 3.4,
			height: 0.5,
			round: 0.55,
		},
		// Still 14: the roots run out over the dry ground as round ridges that sink as they go.
		roots: {
			count: { mean: 6, spread: 1 },
			length: { mean: 1.3, spread: 0.3 },
			radius: 0.35,
			dive: 0.35,
			ridge: 0.95,
		},
		// Still 20: the bole's twisted columns stand as ridges with deep grooves between them, up the
		// whole bare bole.
		flutes: { count: { mean: 8, spread: 1 }, depth: 0.12, height: 3 },
	},
	extras: [
		{
			// Still 19: oval drupes from green through violet to glossy black, one to three on short
			// stalks in the leaf axils, about two centimetres long.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.3,
			count: { mean: 2, spread: 1 },
			// The drupes stand on the internode below the leaves' tip, where the twig shows, as the
			// reference's stalks do.
			tipShare: 0.75,
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.001, 0],
					[0.004, 0.0018],
					[0.0064, 0.0044],
					[0.0074, 0.008],
					[0.0072, 0.0122],
					[0.006, 0.0164],
					[0.0042, 0.0196],
					[0.0022, 0.0214],
					[0.0008, 0.0222],
					[0, 0.0226],
				],
				// Still 19: a drupe two centimetres long reads round at eight faces, and the fruit's
				// cost falls by a quarter on a twig that carries several.
				sides: 8,
				// Still 19: a short stalk below each drupe, so the fruit clears the leaves above it.
				stalk: 0.008,
			},
			// Still 19: a green drupe, dull to glossy as it ripens.
			colour: [0.09, 0.14, 0.03],
			roughness: [0.3, 0.65],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
	},
	wind: {
		// The wind clip's bands: an olive's wood is stiff and its motion faint, so the crown moves
		// little at every order.
		stiffness: [
			[0, 0.98],
			[0.5, 0.95],
			[1, 0.92],
		],
		sway: { frequency: 0.22, amplitude: 0.012 },
		flutter: { kind: 'blade', amplitude: 0.1, frequency: 2.4 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [500, 12, 160],
		// The cards stand half again larger than the shoots they picture, so a gap between one shoot's
		// leaves falls on a neighbour's leaves rather than on sky.
		cardGrow: 2.2,
		// Stills 01 and 02: a card's twig is thinner than a pixel at a whole view, so its leaves read
		// as a piece in air. Each draws its twig as a line, and the join shows.
		cardStalk: 0,
		cardStalkToFoliage: true,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The plant's kit measures 1.13, 1.84, 3.26 and 6.33 MB and the cutting kit 0.11, 1.12, 3.17
			// and 7.58 MB at the four tiers; each cap sits just above the larger of the two. The studio
			// classes stand in the cutting kit alone, so the plant's kit carries the crown's classes
			// only, while a studio piece pays for its own leaves and no card levels.
			kitBytes: { low: 1_150_000, medium: 1_880_000, high: 3_300_000, ultra: 7_650_000 },
			// The largest of seed 11's six variants measures 5.24, 5.36, 5.52 and 5.69 MB.
			variantBytes: { low: 5_280_000, medium: 5_400_000, high: 5_560_000, ultra: 5_730_000 },
			lod0Triangles: 2_900_000,
			// The largest variant draws 110,503 triangles at the middle card level and 10,633 at the
			// farthest, so each cap sits just above its own figure.
			lod1Triangles: 115_000,
			lod2Triangles: 11_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 4150070,
	roundBand,
	cuttings: {
		// Still 21: the branch is cut from a fine order of the grown plant, where the crown's leaves
		// run along the wood, so the piece carries leaves over its whole run rather than at one end.
		branch: { order: 3, length: 0.9 },
		// Still 22: the sub-branch, a twig about a third of a metre long whose side shoots leave one at
		// a time and droop at their ends.
		subbranch: { shoot: 'cut' },
		// Still 23: one upright shoot, its pairs of leaves along the run and buds at its tip.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
