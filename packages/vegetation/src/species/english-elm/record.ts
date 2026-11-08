// The English elm, open-grown: a tall broad goblet on a short thick bole that forks low into four
// or five great limbs. The limbs rise steeply, run near-parallel, then flare and divide into a
// dense clumped crown a little wider than tall. Every axis carries alternate buds in two flat rows,
// so the twigs zigzag and the leaves stand in a herringbone. Each shoot ends in a small dark
// red-brown bud. The leaf is oval with double teeth and a markedly uneven base. The bark is a
// close grey-brown net of corky ridges that cross and rejoin.
//
// The envelope is measured from the two whole-plant stills, since the reference set has no turning
// video of the whole plant (fit.ts). The growth numbers are fitted to the same stills; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// texture sources and the single-leaf stills; the bark from the bark stills; the samaras from the
//
// The review slots light each still as its photograph was lit: the upper half's sky reads a mean
// linear luminance of 0.51 at still 01 and 0.70 at 02, so pi times each is 1.60 and 2.18 times the
// page's soft daylight. At that light the crown reads fifteen and seven colour steps from the
// photographs. The drawn crown is darker than either, and the crown's own sky extinction is the
// term that darkens it: at zero the same crown reads six and five steps. No record lever closes
// that inside the sky-gap bands, so the colour stands as a limit.
// fruit still. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';
import { forms } from './forms';

/** Internodes along a cut piece's shoot: a bare foot, then the leaves crowd toward its end. */
const CROWDED: readonly (readonly [number, number])[] = [
	[0, 0.55],
	[0.72, 1],
	[1, 0.45],
];

/** Internodes along a shoot: even along its run, the leaves in two rows to a terminal bud. */
const RANK: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The English elm's record. */
export const record: Species = {
	id: 'english-elm',
	name: 'English elm',
	latin: 'Ulmus minor',
	form: 'tall broad goblet on a short low-forking bole',
	// Still 01 stands the tree 1.16 times as wide as tall, measured from its outline, and still 02
	// stands the bole about eight hundredths of the height across at breast height.
	size: { height: { mean: 22, spread: 2 }, dbh: 1.9, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 09 and 21: the alternate buds divide again and again into fine twigs, so more
		// lateral buds put out a branch than the light alone gives.
		branching: 1.1,
		// Still 01: the lowest foliage stands a fifth of the height above the foot, and stills 02,
		// 17 and 18 show the bole bare below it.
		floor: 0.16,
		// Stills 06, 07 and 17: the great limbs pass round one another rather than through. Only
		// wood above a share of the trunk's girth keeps the clearance, so the crown's fine wood
		// keeps its own layout while its great limbs keep apart.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.55, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			// Stills 09, 10 and 22: every axis carries alternate buds in two flat rows, each leaf a
			// half turn from the one before it.
			arrangement: { kind: 'spiral', divergence: 180 },
			// Stills 07 and 17: the great limbs climb steeply before they flare, and each fork
			// closes to a narrow V.
			angle: [
				[0.3, 58],
				[1, 64],
			],
			angleSpread: 6,
			// Stills 01, 04 and 18: the crown is a dense mass of alternate sprays, so few buds die.
			extinction: [0.012, 0.018],
		},
		// Stills 01 and 02: one leader carries the crown to a single apex, and the tree is a little
		// wider than tall rather than a broad dome.
		apical: {
			control: [
				[0, 0.52],
				[1, 0.56],
			],
			dominance: [0.75, 0.6, 0.98],
			wander: 8,
		},
		// Stills 01, 02, 07 and 17: the bole forks at about a quarter of the height into five great
		// limbs that leave at about 45 degrees and run on near-parallel, the first at about 20.
		divide: { at: 0.19, count: 5, angle: 45, lean: 20, plumb: 4 },
		// Stills 01, 02 and 04: the crown's lit top and rim carry its fullest shoots.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 05 and 06: the limbs run out and their ends flare back up, so the shoots bend
		// against gravity most at their tips.
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.28],
				[0.4, 0.04],
				[0.75, 0.06],
				[1, 0.22],
			],
		},
		// Stills 01, 02 and 18: a bud that the righting carried under the crown stands in its
		// shade, and the bole is bare to the crown's base.
		shedding: { threshold: 0.06, cleanBole: 0.15, stubs: 0.2, underCrown: 0.2 },
		// The crown's sag was fitted with the wood weighed at a 3 m bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.2, girth: 3 },
		forkRule: true,
		kinks: true,
		// Stills 04 and 05: a limb's end keeps its foliage on wood thick enough for the far view to
		// draw, so no leaf group hangs off the crown's rim as a piece of its own.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// Still 23's shoot: this year's shoot ends in a small dark bud, with alternate leaves
				// in two rows below it and buds in their axils.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.16, spread: 0.03 },
				nodes: { mean: 5, spread: 0.5 },
				internode: RANK,
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 75],
					[1, 55],
				],
				leafAngleSpread: 12,
				droop: 3,
			},
			{
				// Stills 09 and 22: last year's shoot, whose alternate buds put out this year's
				// short shoots, each ending in its bud.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.42, spread: 0.07 },
				nodes: { mean: 7, spread: 0.5 },
				internode: RANK,
				stem: { radius: [0.005, 0.003] },
				// Still 09: the side shoots leave the stem one at a time, alternating along it in
				// the same two ranks as the leaves.
				laterals: 3,
				lateralGap: 0.3,
				// Still 10: the twigs run slightly zigzag between their joints, not as one rod.
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
				// Still 21: a limb's last three years of twigs, with the older wood bare between the
				// leafy spurs and a small bud at every joint.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 3,
				length: { mean: 1.15, spread: 0.15 },
				nodes: { mean: 8, spread: 0.5 },
				internode: RANK,
				stem: { radius: [0.014, 0.006] },
				laterals: { mean: 2.4, spread: 0.4 },
				lateralGap: 0.35,
				bend: { length: 0.06, angle: 28 },
				leafScale: [
					[0, 0.75],
					[1, 1],
				],
				leafAngle: [
					[0, 72],
					[1, 52],
				],
				droop: 4,
			},
		],
		// Still 23 and the cluster's turn: the piece is a shoot about fifteen centimetres long with six
		// to eight alternate leaves in two rows. The crown cannot carry a shoot this crowded at its
		// strongest class, so the cutting draws this class and the crown never does.
		cuttingClasses: [
			{
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.15, spread: 0.02 },
				nodes: { mean: 6.5, spread: 0.5 },
				internode: RANK,
				// Still 23: every blade stands at the record's own leaf, as the photograph's few large
				// blades do, rather than shrunk.
				leafScale: [
					[0, 1],
					[1, 1],
				],
				// Still 23: the leaves lie in two rows close to the shoot, overlapping like shingles,
				// rather than opening out from it.
				leafAngle: [
					[0, 55],
					[1, 35],
				],
				// The cluster's leaves stand out of its plane, so the piece keeps a silhouette when the
				// camera turns edge-on to it, as the reference twig's leaves do.
				leafAngleSpread: 35,
				droop: 6,
			},
			{
				// Stills 21 and 22: the cut piece is a bare stem that divides two or three times into
				// slender shoots, each carrying alternate leaves in two rows and a terminal bud, with
				// the leaves crowded along the last year's growth. Three units of four nodes let a side
				// arm leaving the first unit carry two units of its own, where a shorter piece's arm
				// carries one; that is what widens the piece and steadies its turn.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 3,
				length: { mean: 0.9, spread: 0.12 },
				nodes: { mean: 4, spread: 0.5 },
				internode: CROWDED,
				// Still 21: the piece's foot stands about a twenty-fifth of its height across.
				stem: { radius: [0.009, 0.005] },
				laterals: 3,
				lateralGap: 0.1,
				bend: { length: 0.05, angle: 26 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 72],
					[1, 52],
				],
				droop: 3,
			},
		],
		// Stills 09, 10 and 22: every leaf stands a half turn from the one below it, in two ranks.
		phyllotaxis: { kind: 'spiral', divergence: 180 },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Still 10: the twigs are slender and slightly flattened at the joints.
		stem: { radius: [0.0035, 0.002], zigzag: 12 },
		// Stills 10 and 23: a small pointed dark red-brown bud stands in every leaf's axil, with two
		// or three crowded at the shoot's end.
		bud: {
			length: 0.005,
			width: 0.0032,
			tipCluster: 3,
			cluster: { step: 0.25, lean: 45 },
			colour: [0.11, 0.05, 0.035],
		},
		placement: {
			// Stills 01, 02 and 04: every limb carries leafy twigs along its run, and the crown is a
			// dense clumped mass rather than tufts on bare axes.
			perMetre: [
				[0, 2.2],
				[0.55, 3],
				[1, 8],
			],
			// Stills 01 and 02: the crown's own box shows about five hundredths of sky, denser than
			// the oak's crown, so the dial sits above the curve's count.
			density: 1.6,
			shadePrune: 0,
			// Stills 01, 03 and 05: sky shows through the crown's middle and under it, where its own
			// leaves leave a shoot under this share of the sky, and the lit outer masses stay.
			skyPrune: 0.33,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.03,
			// Stills 02 and 05: the shoots stand up off their wood, so the foliage rides on the limbs.
			lift: 10,
			skyward: 0.55,
			scale: { mean: 1.2, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: an oval blade one and a half times as long as wide on a short stalk.
			// Stills 09, 23 and 24 show the larger end of the fact sheet's four to nine centimetres,
			// about eight and a half.
			length: { mean: 0.085, spread: 0.01 },
			outline: 'texture',
			// Stills 12 and 23: the blade meets its stalk on a very short petiole, about six
			// millimetres, the base's lower half running a little down it. The stalk stands thick
			// enough to draw at the close views' scale, so each blade meets its shoot.
			petiole: { length: 0.007, radius: 0.0022, flat: 0, droop: 4 },
			fold: 8,
			curl: 12,
			crossCurl: -4,
			twist: 5,
			wave: [0.002, 4],
			optics: {
				reflectance: [0.0434, 0.0962, 0.019],
				reflectanceBack: [0.2192, 0.2615, 0.1528],
				transmittance: [0.09, 0.19, 0.02],
				roughness: [0.5, 0.65],
			},
		},
	},
	bark: {
		// Stills 26 and 15 under the copy-stand lamps: a warm grey-brown, so the texture's measured
		// colour stands above the foot. Still 14: the flare reads some L units lighter than its
		// photograph, so the lowest half metre takes a darkening tint. It stays below the mid-trunk
		// and texture cameras' frames, so neither of their figures moves.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 0.5, blend: 0.3, tint: [0.62, 0.66, 0.72] },
			{ layer: 0, by: 'height', from: 0.5, to: 40, blend: 0, tint: [1, 1, 1] },
		],
		young: 0,
		// Still 16: the net fades to smooth grey-brown wood on branches thinner than about three
		// centimetres' radius, where still 28 shows the lenticels.
		youngRadius: 0.03,
		// Still 15: the ridges' cells stand wider on the thick bole than on the limbs.
		girthScale: [
			[0, 0.5],
			[1, 1],
		],
		// Still 15: deep furrows between corky ridges that cross and rejoin.
		displacement: 0.035,
		// Still 07: a limb meets the bole on a long, smooth curve under it.
		collar: { swell: 0.35, length: 1.5, ridge: 0.4 },
		// Still 08: the fork closes in a small knot, its arms part in a narrow V.
		fork: { bend: 2.5, knot: 0.3 },
		// Stills 07 and 14: a green film of moss over the buttresses' flanks and the fork's
		// shoulders, on every side of the foot.
		moss: { amount: 0.9, up: 1.2, north: 0.1, colour: [0.15, 0.2, 0.05] },
		// Still 16: grey-green lichen flecks the crests of the ridges on the great limbs.
		lichen: { amount: 0.4, from: 0.2, to: 0.8, colour: [0.38, 0.4, 0.36] },
	},
	base: {
		// Still 14: the foot flares on a few strong buttresses with deep furrows between them.
		flare: { amount: 0.32, height: 0.5 },
		buttress: {
			lobes: { mean: 5, spread: 1 },
			amount: 0.6,
			sharpness: 3,
			height: 0.6,
			round: 0.3,
		},
		// Still 14: the roots stand out of the litter as round-topped ridges that sink as they run.
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 1.8, spread: 0.3 },
			radius: 0.4,
			dive: 0.3,
			ridge: 0.95,
		},
		// The furrows between the buttress roots of still 14 come from the lobes; the flutes only
		// break the foot's regularity.
		flutes: { count: { mean: 7, spread: 1 }, depth: 0.05, height: 1 },
	},
	extras: [
		{
			// Still 19: dense bunches of flat, nearly round papery keys hang from the young shoots,
			// the seed body near the notched tip, borne before the leaves fill out.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.05,
			count: { mean: 20, spread: 5 },
			tipShare: 0.8,
			seasons: ['blossom', 'summer'],
			shape: {
				samara: {
					// Still 19: a key about 1.5 centimetres long and nearly as wide, on a seed body
					// about a third of that length.
					length: 0.012,
					width: 0.01,
					body: 0.3,
					twist: 20,
				},
				// Still 19: the bunch hangs from a short stalk below the twig, so its keys stand
				// clear of the leaves above them, on footstalks of their own.
				stalk: 0.012,
				pedicel: 0.004,
			},
			// Still 19: a pale yellow-green wing round a buff seed body.
			colour: [0.42, 0.44, 0.24],
			bandColour: [0.3, 0.22, 0.12],
			// Still 19: the pedicels and their shared stalk are green, so each body stands separate
			// on its own footstalk.
			stalkColour: [0.25, 0.3, 0.1],
			roughness: [0.6, 0.6],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.2, 0.16, 0.03], transmittance: [0.3, 0.2, 0.03] },
	},
	wind: {
		// The wind clip shows dense leaf clumps rocking on great still limbs: the trunk holds, and the
		// crown's top moves about as little as its base, so the stiffness rises with height rather
		// than falling.
		stiffness: [
			[0, 0.99],
			[0.5, 0.97],
			[1, 0.99],
		],
		// The clip's bands move by five to fifteen thousandths of the outline's height, so the sway
		// and the flutter stand below the record's first figures.
		sway: { frequency: 0.28, amplitude: 0.02 },
		flutter: { kind: 'blade', amplitude: 0.04, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// The cards stand seven tenths larger than the shoots they picture, so a gap between one
		// shoot's leaves falls on a neighbour's leaves rather than on sky, and the far crown closes
		// as stills 01 and 18 show it.
		cardGrow: 2.8,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit measures 3.39, 5.32, 9.13 and 16.57 MB at the four tiers, the cut shoot's own two
			// prototypes among them; each cap sits just above its figure.
			// its figure.
			// The largest of three variants measures 13.68, 13.80, 13.98 and 14.19 MB, the two years
			// of alternate leaves taking most of it; each cap sits just above.
			// The heaviest variant's first card level draws 58,843, 64,037, 71,732 and 81,547
			// triangles up the tiers, and its second 24,756, 25,374, 26,390 and 27,199.
			kitBytes: { low: 3_400_000, medium: 5_350_000, high: 9_150_000, ultra: 16_600_000 },
			variantBytes: { low: 13_700_000, medium: 13_850_000, high: 14_000_000, ultra: 14_200_000 },
			lod0Triangles: 2_500_000,
			lod1Triangles: 85_000,
			lod2Triangles: 28_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 20261108,
	roundBand,
	// The root-sucker thicket of still 20, the form the species spreads by.
	forms,
	cuttings: {
		// Stills 21 and 22: the branch and the sub-branch are cut pieces of a bare stem forking into
		// leafy shoots, so the close views draw the class the photographs do.
		branch: { shoot: 'cut' },
		subbranch: { shoot: 'long' },
		// Still 23: one young shoot with eight alternate leaves and a terminal bud, as the spur
		// draws it.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
