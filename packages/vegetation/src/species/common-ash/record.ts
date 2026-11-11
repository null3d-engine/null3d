// The common ash, open-grown: a tall, narrow, open crown on a long clean bole that divides high into
// a few steep limbs. The bole runs straight to about a third of the height, then forks into four
// limbs that spread wide and turn up at their ends. Every axis carries opposite, decussate
// pairs of buds and shoots, so the twigs fork in twos at right angles, and each shoot ends in a
// single stout jet-black bud. The leaves are pinnate: eleven stalkless lance-shaped leaflets with
// toothed margins on one rachis. The bark is a close diamond net of ridges, pale grey, smooth on the
// thin wood.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// single-leaf stills and the texture sources; the bark from the bark stills; the keys from the fruit
// still. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a shoot: even along the run, the leaves in opposite pairs to its end. */
const PAIR: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The common ash's record. */
export const record: Species = {
	id: 'common-ash',
	name: 'Common ash',
	latin: 'Fraxinus excelsior',
	form: 'tall open dome on a long clean bole',
	// Stills 01, 02 and 18 stand the bole 0.038 to 0.051 of the tree's height across at breast
	// height, and the fit's crown is 0.9 of the height wide, so the tree is taller than it is broad.
	// Still 17 and the whole views: the bole's diameter is about four hundredths of the tree's height,
	// where the fitted 0.95 metre drew a hair thin at three and a half.
	size: { height: { mean: 22, spread: 2 }, dbh: 1.1, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 09 and 21: the pairs divide again and again into fine twigs, so more lateral buds
		// put out a branch than the light alone gives.
		branching: 1.15,
		// The fitted outline holds no room below the crown's base, and stills 01, 02 and 18 show the
		// bole bare to about a quarter of the height, so the crown's underside stands there.
		floor: 0.25,
		// Stills 01, 02 and 18: the great limbs pass round one another rather than through, and each
		// shoot turns aside to keep its air. Only wood above a third of the trunk's girth keeps the
		// clearance, so the crown's fine wood keeps its own layout.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.55, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			// Stills 09, 10 and 20: every axis carries opposite pairs of buds, each pair turned a
			// quarter turn from the last.
			arrangement: { kind: 'opposite', decussate: true },
			// Stills 07 and 18: the great limbs leave the bole steeply, so they climb rather than
			// spread level, and each fork closes to a narrow V.
			angle: [
				[0.25, 48],
				[1, 55],
			],
			angleSpread: 5,
			// Stills 01 and 18: the crown is a filigree of fine opposite branches, so few buds die.
			extinction: [0.01, 0.015],
		},
		// Stills 01, 02 and 18: one leader carries the crown to its top and outgrows every limb, so the
		// tree is longer than it is broad.
		// Stills 01, 02 and 18: one leader carries the crown to a single apex, so the crown stands
		// taller than it is wide where a broad dome would not.
		apical: {
			control: [
				[0, 0.62],
				[1, 0.64],
			],
			dominance: [0.78, 0.6, 0.98],
			wander: 8,
		},
		// Still 18: the bole runs straight to the crown's base, then divides into five limbs that leave
		// at about 62 degrees and spread round it, the first running on at 28.
		divide: { at: 0.3, count: 5, angle: 62, lean: 28, plumb: 4 },
		// Stills 01 and 02: the crown's lit top and rim carry its fullest shoots.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 05 and 06: the limbs run out and their ends turn up, so the shoots bend against
		// gravity most at their tips.
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.2],
				[0.4, 0.05],
				[0.75, 0.08],
				[1, 0.24],
			],
		},
		// Stills 01, 02 and 18: a bud that the righting carried under the crown stands in its shade,
		// and the bole is bare to the crown's base.
		shedding: { threshold: 0.1, cleanBole: 0.26, stubs: 0.2, underCrown: 0.5 },
		// The crown's sag was fitted with the wood weighed at a 3 m bole; the bend keeps weighing it so,
		// whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.4, girth: 3 },
		forkRule: true,
		kinks: true,
		// Still 08: a limb forks into two arms that part in a narrow V, so a limb's end keeps its
		// foliage on wood thick enough for the far view to draw.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 5,
		classes: [
			{
				// Still 22's shoot tip: this year's shoot ends in one black bud, with one or two
				// opposite pairs of leaves just below it.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.18, spread: 0.03 },
				nodes: { mean: 2.4, spread: 0.4 },
				internode: PAIR,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 70],
					[1, 55],
				],
				leafAngleSpread: 15,
				droop: 2,
			},
			{
				// Stills 09 and 22: last year's shoot, whose opposite pairs of twigs each end in a black
				// bud under a pair of leaves.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.45, spread: 0.07 },
				nodes: { mean: 3, spread: 0.4 },
				internode: PAIR,
				stem: { radius: [0.005, 0.003] },
				// Still 09: each joint carries an exact opposite pair of twigs, both leaving at the one
				// node.
				laterals: 2,
				lateralGap: 0,
				// Still 10: the twigs run stiff and nearly straight between their flattened nodes.
				bend: { length: 0.05, angle: 26 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 72],
					[1, 52],
				],
				droop: 3,
			},
			{
				// Still 21: a limb's last two years of twigs, the older wood bare between the pairs of
				// leafy shoots, with a black bud at each end.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 2,
				length: { mean: 1.1, spread: 0.15 },
				nodes: { mean: 3, spread: 0.4 },
				internode: PAIR,
				stem: { radius: [0.014, 0.006] },
				laterals: 2,
				lateralGap: 0,
				bend: { length: 0.06, angle: 28 },
				leafScale: [
					[0, 0.75],
					[1, 1],
				],
				leafAngle: [
					[0, 72],
					[1, 52],
				],
				droop: 3,
			},
		],
		// Stills 20, 21 and 22: a cut twig forks at one joint into two shoots, each with a pair or two
		// of leaves below its black bud and bare wood between the joints. The crown cannot carry a
		// shoot this open, so the cuttings draw this class and the crown never does.
		cuttingClasses: [
			{
				// Still 23 and the cluster's turn: the video's piece carries six leaves in three
				// opposite pairs on a shoot of its own, where the crown's short shoots carry two
				// pairs. A cutting class never offers itself to the crown, so the tree keeps its own
				// shoots, as the branch's cut class does.
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.34, spread: 0.04 },
				nodes: { mean: 3, spread: 0 },
				internode: PAIR,
				// Still 23: the piece's pairs do not lie in one plane, so the shoot runs in short
				// stiff pieces that turn from one another, as the held piece does.
				bend: { length: 0.06, angle: 40 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 70],
					[1, 55],
				],
				leafAngleSpread: 15,
				droop: 2,
			},
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.42, spread: 0.06 },
				nodes: { mean: 2, spread: 0.4 },
				internode: PAIR,
				// Stills 21 and 22: the cut twig stands about a thirtieth of the piece's height across
				// at its foot, twice the width the class drew before.
				stem: { radius: [0.011, 0.007] },
				laterals: 2,
				lateralGap: 0,
				bend: { length: 0.05, angle: 26 },
				leafScale: [
					[0, 0.9],
					[1, 1],
				],
				leafAngle: [
					[0, 70],
					[1, 50],
				],
				leafYears: 1,
				droop: 3,
			},
		],
		// Stills 09, 10 and 22: every pair of leaves stands at right angles to the pair below it.
		phyllotaxis: { kind: 'opposite', decussate: true },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Still 10: the twigs are stout and flattened at the joints, a little thicker than the oak's.
		stem: { radius: [0.004, 0.002], zigzag: 6 },
		// Stills 10 and 20: a stout jet-black bud, a centimetre or so long, stands at every twig's end
		// with a smaller pair below it, each over a pale crescent scar.
		bud: {
			length: 0.012,
			width: 0.007,
			tipCluster: 3,
			cluster: { step: 0.35, lean: 45 },
			colour: [0.0086, 0.0086, 0.0091],
		},
		placement: {
			// Stills 01 and 02: the limbs carry foliage along their length, so a limb a third of the
			// way out is leafy rather than bare.
			// Stills 01, 02 and 05: every limb carries leafy twigs along its run, not only at its end,
			// so the crown reads as a filigree of opposite branches rather than tufts on bare axes.
			perMetre: [
				[0, 2.4],
				[0.55, 3],
				[1, 8],
			],
			// Stills 01 and 02: about a quarter of the crown's own box shows sky, and the curve above
			// carries leafy twigs along every limb, so the dial keeps the curve's own count.
			density: 1,
			shadePrune: 0,
			// Stills 01, 03 and 05: a shoot whose leaves see less sky than this share goes, so the
			// crown's shaded middle stays open and the lit outer masses stay. The share sits low
			// enough that the middle keeps its own shoots, since the leaflet's tapered tips leave
			// more sky between them than a rounded blade does.
			skyPrune: 0.35,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.03,
			// Stills 02 and 05: the shoots stand up off their wood, so the foliage rides on the limbs.
			lift: 10,
			skyward: 0.5,
			scale: { mean: 1.2, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: one leaflet of the eleven that fill the pinnate leaf. In the texture
			// source the terminal leaflet runs 0.37 of the whole leaf and a side leaflet as much, so
			// on the photographs' 26 cm leaf each is about ten centimetres.
			length: { mean: 0.098, spread: 0.012 },
			outline: 'texture',
			// Still 12: a bare stalk runs below the lowest pair for about an eighth of the leaf, then
			// the pairs of leaflets to a single one at the tip. The stalk stands about 1.6 millimetres
			// across on the photograph, thick enough to read as the wood the leaf hangs from.
			petiole: { length: 0.03, radius: 0.0026, flat: 0, droop: 8 },
			fold: 6,
			curl: 8,
			crossCurl: 0,
			twist: 4,
			wave: [0, 0],
			optics: {
				reflectance: [0.065, 0.133, 0.0144],
				reflectanceBack: [0.171, 0.254, 0.065],
				transmittance: [0.09, 0.19, 0.02],
				roughness: [0.5, 0.65],
			},
		},
		// Stills 12 and 24: five opposite pairs of stalkless leaflets and one at the tip. The rachis
		// runs 0.63 of the whole leaf against a leaflet's 0.37, so it measures 1.68 leaflet lengths.
		compound: {
			kind: 'pinnate',
			leaflets: { mean: 9, spread: 0.5 },
			// Stills 12 and 13: the leaflets take about two fifths of the leaf's length, and they
			// stand well out from the rachis, so the leaf's plan is broad for its length.
			rachis: 1.5,
			terminal: true,
			angle: 74,
			// Stills 12 and 13: each leaflet's blade meets the rachis with no stalk of its own.
			leafletStalk: 0,
		},
	},
	bark: {
		// Stills 26 and 15 under the copy-stand lamps: a pale, cool grey, so the measured colour stands
		// as it is. A lighter layer over a drawn trunk reads three steps further from its photograph,
		// so the tint stays at one.
		zones: [
			// Stills 14 and 15: the foot stands a shade lighter than the bole above it, and the bole
			// reads lighter and yellower than its photograph, so each takes its own measured tone.
			{ layer: 0, by: 'height', from: 0, to: 1.2, blend: 0.3, tint: [1.03, 0.98, 0.78] },
			{ layer: 0, by: 'height', from: 1.2, to: 40, blend: 0.3, tint: [0.79, 0.79, 0.66] },
			// Still 16: a great limb's bark reads darker than the limb in its photograph, so wood
			// thinner than the bole takes a lighter tone of its own.
			{ layer: 0, by: 'radius', from: 0, to: 0.3, blend: 0.05, tint: [1.38, 1.4, 1.22] },
		],
		young: 0,
		// Still 16: the diamond net fades to smooth pale grey on wood thinner than about six
		// centimetres across.
		youngRadius: 0.03,
		// The net's cells stand wider on the thick bole than on the limbs, as stills 15 and 16 show.
		girthScale: [
			[0, 0.45],
			[1, 1],
		],
		// Still 15: the ridges stand shallower than the oak's plates.
		displacement: 0.03,
		// Still 07: a limb meets the bole in a short, tight collar.
		collar: { swell: 0.35, length: 1.5, ridge: 0.4 },
		// Still 08: the fork closes in a small knot, its arms part in a narrow V.
		fork: { bend: 2.5, knot: 0.25 },
		// Still 14: a green film of moss over the buttresses' flanks, reaching about a metre up, on
		// every side of the foot rather than one.
		moss: { amount: 0.55, up: 1, north: 0, colour: [0.09, 0.15, 0.05] },
		// Still 15: pale grey-green lichen flecks the crests of the net on the lower bole.
		lichen: { amount: 0.3, from: 0.1, to: 0.6, colour: [0.4, 0.42, 0.36] },
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
		// Still 14: a few roots run out over the turf and sink as they go.
		roots: {
			count: { mean: 4, spread: 1 },
			length: { mean: 1, spread: 0.2 },
			radius: 0.35,
			dive: 0.3,
			ridge: 0.9,
		},
	},
	extras: [
		{
			// Still 19: dense bunches of several dozen single-winged keys hang from the last joint of
			// the shoot, each a small seed body at the top and a long narrow wing below it.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 34, spread: 8 },
			tipShare: 0.85,
			seasons: ['summer', 'autumn'],
			shape: {
				samara: {
					// Still 19: a key about three centimetres long and a fifth as wide, on a small
					// round seed body less than a fifth of that length.
					length: 0.032,
					width: 0.0068,
					body: 0.18,
				},
				// Still 19: the bunch hangs from a stalk several centimetres long below the twig, so
				// its keys stand clear of the leaves above them, on footstalks of their own.
				stalk: 0.05,
				pedicel: 0.014,
			},
			// Still 19: a yellow-green wing on a red-brown seed body, the body darker than the wing.
			colour: [0.22, 0.28, 0.08],
			bandColour: [0.16, 0.08, 0.04],
			// Still 19: the pedicels and their shared stalk are green, so each brown body stands
			// separate on its own footstalk instead of running into its neighbours' as one collar.
			stalkColour: [0.2, 0.26, 0.07],
			roughness: [0.6, 0.6],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.18, 0.14, 0.03], transmittance: [0.3, 0.2, 0.03] },
	},
	wind: {
		// The wind clip's bands, base first: the trunk moves least and the crown most, but by about a
		// quarter less at the top than the record drew before.
		stiffness: [
			[0, 0.8],
			[0.5, 0.88],
			[1, 0.95],
		],
		sway: { frequency: 0.3, amplitude: 0.05 },
		flutter: { kind: 'blade', amplitude: 0.25, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The cards stand larger than the shoots they picture, so a gap between one shoot's leaves
		// falls on a neighbour's leaves rather than on sky, and the far crown's rim reads solid.
		cardGrow: 1.0,
		// Stills 01 and 02: a card's twig is thinner than a pixel at a whole view, so a card's leaves
		// read as a piece in air. Each draws its twig as a line, and the join shows.
		cardStalk: 1.5,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit measures 2.63, 3.03, 5.25 and 9.92 MB, the leaf's nine sessile leaflets and the
			// cutting class among them; each cap sits above its figure, and the low tier's just under
			// the owner's cap for a tree.
			kitBytes: { low: 2_680_000, medium: 3_150_000, high: 5_900_000, ultra: 11_600_000 },
			// The largest of seed 11's six variants measures 5.84, 5.92, 6.00 and 6.09 MB, the keys'
			// bunches of 34 taking close to half of it.
			variantBytes: { low: 5_970_000, medium: 6_040_000, high: 6_120_000, ultra: 6_210_000 },
			lod0Triangles: 2_500_000,
			// The heaviest variant's first card level draws 20,704, 23,700, 26,754 and 30,594
			// triangles from the coarsest tier up, and its second 8,521, 9,181, 10,092 and 10,932.
			lod1Triangles: 38_000,
			lod2Triangles: 14_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			// A variant grows in 156 to 260 ms.
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 20221107,
	// A first pass at the floors a phone's lighter form keeps, set from the species' form and to
	// be measured on the phone set before they are trusted.
	sparse: { limbs: 0.45, leaves: 0.5, coarseness: 0.55 },
	roundBand,
	cuttings: {
		// Stills 20, 21 and 22: a cut piece is a bare stem that forks once into two leafy shoots, far
		// sparser than the crown's own twigs, so the close views draw the class the photographs do.
		branch: { shoot: 'cut' },
		subbranch: { shoot: 'cut', pick: 1 },
		// Still 23: one opposite pair of leaves under a small black terminal bud, as this year's shoot
		// draws it.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
