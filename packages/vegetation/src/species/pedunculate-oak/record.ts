// The pedunculate oak, open-grown: a broad low dome about one and a half times as wide as tall, on
// a short massive bole that forks low into several huge limbs. Limbs leave at wide angles, run out
// almost level and kink between joints. Twigs are short and stiff, with buds crowded at their
// ends, and each year's shoot ends in one rosette of about six lobed leaves round its bud cluster.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot classes from
// the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the texture
// source's contour and the single-leaf stills; the bark from the bark stills. The record is plain
// data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';
import { forms } from './forms';

/** Internodes along a growth unit: one long first internode, then the leaves crowd at its tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/**
 * Internodes along a spray's growth unit: the leaves crowd into the unit's last tenth, so a rosette
 * holds together at its twig's end.
 */
const TIGHT_ROSETTE: readonly (readonly [number, number])[] = [
	[0, 40],
	[0.12, 0.5],
	[1, 0.25],
];

/** The pedunculate oak's record. */
export const record: Species = {
	id: 'pedunculate-oak',
	name: 'Pedunculate oak',
	latin: 'Quercus robur',
	form: 'broad low dome on a short, low-forking bole',
	// The whole-tree stills stand the bole about an eighth of the tree's height across at breast
	// height (0.115 in 02, 0.126 in 18, 0.168 in 01). The fact sheet's 1.5 to 2 m is its width at the
	// flare, which these stills draw about 1.8 times the breast-height width a quarter metre up.
	size: { height: { mean: 20, spread: 2 }, dbh: 2.9, aspect },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 01, 02 and 18 show sky under the crown down to the fork: the outline's lowest
		// fitted row, the drooping limb ends at the rim, stays out of the room the crown fills.
		floor: 0.175,
		// Stills 06, 07 and 08: great limbs pass round one another rather than through. The clearance
		// falls with each limb's order and applies only above a share of the trunk's girth, so the
		// crown's fine wood keeps its own layout while its great limbs keep apart.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.6, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.25, 50],
				[1, 55],
			],
			angleSpread: 8,
			extinction: [0.02, 0.03],
		},
		apical: {
			control: [
				[0, 0.55],
				[1, 0.55],
			],
			dominance: [0.7, 0.6, 0.98],
			wander: 16,
		},
		// Still 17: the bole runs straight from its flare to the fork, leaning no more than the
		// stem's own lean (2 degrees, give or take 2).
		divide: { at: 0.25, count: 5, angle: 64, lean: 35, plumb: 4 },
		// Stills 01 and 02: the crown's top and rim carry its fullest shoots, not its weakest.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.3],
				[0.25, 0],
				[0.5, 0],
				[0.75, 0],
				[1, 0.03],
			],
		},
		// Stills 01, 02, 17 and 18 show sky under the crown's base: a shoot the righting carried below
		// it stands in the crown's shade and dies back.
		shedding: { threshold: 0.1, cleanBole: 0.2, stubs: 0.2, underCrown: 1 },
		// The crown's sag was fitted with the wood weighed at a 3.5 m bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.5, upturn: 0.2, girth: 3.5 },
		forkRule: true,
		kinks: true,
		// Stills 02 and 18: the foliage meets the wood at every twig. A finer tip leaves leaf groups
		// hanging off the crown as pieces of their own, since a twig under the far view's pixel draws
		// nothing for them to stand on.
		pipe: { exponent: 2.3, tipRadius: 0.012 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// This year's shoot of still 23: a straight twig ending in one rosette of about six
				// leaves round its bud cluster. The oldest leaf of the rosette opens widest and hangs
				// the lowest, the newest stands most upright, so the cluster is round from every side.
				name: 'short',
				vigor: [0, 0.04],
				share: 0.3,
				years: 1,
				length: { mean: 0.14, spread: 0.02 },
				nodes: { mean: 7, spread: 0.5 },
				internode: ROSETTE,
				leafScale: [
					[0, 0.85],
					[1, 1.05],
				],
				leafAngle: [
					[0, 150],
					[0.5, 95],
					[1, 40],
				],
				// The rosette crowds its leaves at one point, so the curve alone gives them all one
				// angle and the cluster stands flat. A spread opens them over a range instead.
				leafAngleSpread: 30,
				droop: 3,
			},
			{
				// The twig of stills 10 and 22: last year's shoot, whose end cluster put out this
				// year's rosettes.
				name: 'long',
				// Stills 21 and 22: most of a limb's shoots are twigs of a few rosettes, so the long
				// shoot takes the buds up to middling vigor and the spray only the strong ones.
				vigor: [0.04, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.4, spread: 0.06 },
				// Rosettes of nine leaves, as still 22's hold six to ten and the crown's far views need
				// its cover. An odd count turns the twig's zigzag back across its line at every joint,
				// where an even count leans each year one way.
				nodes: { mean: 9, spread: 0.4 },
				leafYears: 1,
				internode: ROSETTE,
				stem: { radius: [0.006, 0.0035] },
				// Still 22's sub-branch: its side shoots leave the stem one at a time, a few centimetres
				// apart, not as a fan from one point.
				laterals: 3,
				lateralGap: 0.45,
				// The winter cut branch's twigs run stiff and angular between their nodes, not as one rod,
				// kinking every 6 cm or so as its reference's twigs do.
				bend: { length: 0.06, angle: 34 },
				// Stills 21 and 22: every blade at the record's own leaf, none shrunk, so the close views'
				// rosettes read as the photographs' few large blades.
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 5,
			},
			{
				// The branch of still 21: three years of twigs, stiff and angular, with a cluster of
				// rosettes at each end.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 3,
				length: { mean: 1.15, spread: 0.15 },
				// Rosettes of nine leaves, as stills 09 and 21 hold six to ten: fewer twigs carry the
				// spray's leaves. An odd count keeps the zigzag from leaning every year one way.
				nodes: { mean: 9, spread: 0.4 },
				// Stills 09 and 21's rosettes hold together at their twig ends, so the crown's rim shows
				// clumps, not loose single leaves.
				internode: TIGHT_ROSETTE,
				stem: { radius: [0.018, 0.007] },
				lateral: 60,
				// Still 21's branch and the winter cut branch: side twigs leave the stem one at a time,
				// alternating along it, where the bud cluster alone gave a fan of two or three at a point.
				laterals: { mean: 1.6, spread: 0.4 },
				lateralGap: 0.3,
				// The winter cut branch's twigs run stiff and angular between their nodes, not as one rod,
				// kinking every 6 cm or so as its reference's twigs do.
				bend: { length: 0.06, angle: 34 },
				leafScale: [
					[0, 0.8],
					[1, 1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 6,
			},
		],
		// Stills 10, 20, 21 and 22: a cut twig forks at last year's joint into two shoots, each ending
		// in a rosette with the stem between the joints bare, and its twigs stay stiff and kinked. The
		// crown cannot carry shoots this bare, so the cuttings draw this class and the crown never
		// does. Its two prototypes differ in length, so the branch takes the long one and the
		// sub-branch the short.
		cuttingClasses: [
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 0.88, spread: 0.3 },
				nodes: { mean: 6, spread: 0.5 },
				internode: ROSETTE,
				stem: { radius: [0.007, 0.003] },
				lateral: 60,
				laterals: 2,
				lateralGap: 0.45,
				bend: { length: 0.05, angle: 34 },
				leafScale: [
					[0, 0.9],
					[1, 1.1],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 5,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 2,
		stem: { radius: [0.0035, 0.0025], zigzag: 22 },
		// Stills 10, 20 and 23 show the tip clusters' buds near a centimetre long and a chestnut
		// red-brown, gathered in a round bunch at the twig's end. The fact sheet's 3 to 6 mm reads as
		// specks at the review's scale, so the record follows the pictures.
		bud: {
			length: 0.012,
			width: 0.0085,
			tipCluster: 7,
			cluster: { step: 0.15, lean: 50 },
			colour: [0.3, 0.13, 0.075],
		},
		placement: {
			perMetre: [
				[0, 0.5],
				[0.55, 0.9],
				[1, 7],
			],
			// The reference's crown is denser than the curve alone gives: this is the dial, not a
			// change of reach or part size. The low limbs now keep the foliage they carry below the
			// bole's line, so the dial sits lower than it did when that foliage was missing.
			density: 1,
			// No shade line and no starved-tip line: the sky prune below takes the same wood, so one rule
			// that can be read stands where three stood. A shade line is still there for a species that
			// cannot prune by the sky its own leaves block.
			shadePrune: 0,
			// Stills 01, 03 and 05: sky through the crown's middle and under it, where its own leaves
			// leave a shoot under this share of the sky; the lit outer masses stay.
			skyPrune: 0.43,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang under the crown; a thin branch left with no shoot
			// has died and goes.
			bareTrim: 0.03,
			// Stills 02 and 03: the shoots stand up off their wood, so the foliage rides on the limbs
			// rather than hanging under them.
			lift: 15,
			skyward: 0.65,
			scale: { mean: 1.4, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.12, spread: 0.02 },
			outline: 'texture',
			petiole: { length: 0.005, radius: 0.0009, flat: 0, droop: 15 },
			fold: 16,
			curl: 18,
			crossCurl: -6,
			twist: 6,
			wave: [0.003, 5],
			optics: {
				reflectance: [0.0429, 0.0864, 0.0194],
				reflectanceBack: [0.2344, 0.2975, 0.212],
				transmittance: [0.091, 0.195, 0.0195],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		zones: [
			// The foot stands in shade under the crown, where the bark's own albedo is a small part of
			// what the picture shows, so its tint deepens the bark a little. It changes over the
			// longest blend the foot allows, so the flare's colour never steps.
			{ layer: 0, by: 'height', from: 0, to: 1.2, blend: 0.8, tint: [0.78, 0.71, 0.38] },
			// The bole's bark is dark: the mid-trunk photograph shows its own tone under the page's
			// daylight, so this tint scales the sampled colour to match it. The flat-lit texture source
			// drawing the same wood sits a little dark beside its photograph, but a texture source
			// sets no row.
			{ layer: 0, by: 'height', from: 1.2, to: 3.6, blend: 1, tint: [0.69, 0.67, 0.62] },
			// The great limbs stand in brighter light than the bole and read a little lighter and
			// warmer than still 16. Their tint stays close to the bole's and changes over a long blend,
			// so a limb that crosses the zone's height keeps one colour along its length.
			{ layer: 0, by: 'height', from: 3.6, to: 40, blend: 2, tint: [0.52, 0.56, 0.18] },
		],
		young: 0,
		// The young bark is the smooth grey-green of a young shoot, and the photographs of it are
		// pale. Only truly thin wood keeps it, so a sub-branch the size of a sapling's stem reads as
		// the same wood as the limb it leaves, a shade lighter, rather than turning pale grey.
		youngRadius: 0.05,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		displacement: 0.04,
		collar: { swell: 0.45, length: 1.8, ridge: 0.6 },
		// Still 07's limb leaves the trunk on a long, smooth curve under it, not a tight corner.
		fork: { bend: 3 },
		moss: { amount: 0.35, up: 1.2, north: 0.3, colour: [0.18, 0.22, 0.06] },
		// Still 16's limb carries pale sage rosettes on its crests, so the lichen reaches the great
		// limbs as well as the bole, in the fine flecks the bark shows through.
		lichen: { amount: 0.3, from: 0.6, colour: [0.36, 0.38, 0.26] },
	},
	base: {
		// Stills 01, 02, 17 and 18 flare the foot to about 1.8 times the bole a quarter metre up, 1.5
		// at half a metre and 1.2 at 0.85 m. Still 14 carries that spread on a few buttresses with
		// deep furrows between them, each running out over the leaf litter as a root, so the lobes
		// and the roots take it between them and the round flare stays small.
		flare: { amount: 0.3, height: 0.5 },
		buttress: {
			lobes: { mean: 9, spread: 1.5 },
			amount: 0.55,
			sharpness: 5,
			height: 0.6,
			round: 0.15,
		},
		// Still 14's roots stand out of the litter as round-topped ridges that sink as they run out;
		// more, narrower toes carry the flare, so the foot reads as legs rather than a skirt.
		roots: {
			count: { mean: 8, spread: 1.5 },
			length: { mean: 1.6, spread: 0.3 },
			radius: 0.32,
			dive: 0.3,
			ridge: 1,
		},
		// The furrows between the buttress roots of still 14 come from the lobes; the flutes only
		// break the foot's regularity.
		flutes: { count: { mean: 7, spread: 1 }, depth: 0.06, height: 1 },
	},
	extras: [
		{
			// The acorn on its long stalk, the peduncle that tells this oak from the sessile oak: three
			// plump nuts on one stalk that forks into short footstalks, each nut in a deep cup of scale
			// rows that holds its top third, the nut swelling smooth below the cup to a small point.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.0475,
			count: { mean: 3, spread: 0 },
			// The acorns stand on the internode below the leaves' rosette, where the twig shows, as
			// the reference's peduncle does, not at the leafy tip.
			tipShare: 0.8,
			seasons: ['summer', 'autumn'],
			shape: {
				// The cup's scale rows cover two fifths, its rim stands proud of the nut and is the
				// widest point. Below the rim the nut swells to its widest a fifth of the way down and
				// closes in an egg's taper past a shoulder to a fine point, as still 19's nuts do, with
				// its rings closer where the taper turns fastest.
				lathe: [
					[0.0014, 0],
					[0.0044, 0.0016],
					[0.0072, 0.0034],
					[0.0084, 0.0052],
					[0.0088, 0.0068],
					[0.0086, 0.008],
					[0.0074, 0.0086],
					[0.0072, 0.0106],
					[0.0071, 0.0134],
					[0.0066, 0.0159],
					[0.0058, 0.0179],
					[0.0048, 0.0194],
					[0.0036, 0.0205],
					[0.0022, 0.0214],
					[0.0009, 0.0224],
					[0.0004, 0.0234],
					[0, 0.0242],
				],
				// Sixteen faces read round on a nut that fills a close view, now that its normals follow
				// the profile; the rings the taper gains are paid for by the faces it loses.
				sides: 16,
				scales: 6,
				scaled: [0, 0.008],
				// Still 19's peduncle hangs the acorns about twice their own length below the twig, within
				// the fact sheet's 3 to 8 cm.
				stalk: 0.05,
				pedicel: 0.012,
				// Still 19's peduncles fill a few pixels across, where four faces read as a square rod.
				stalkSides: 5,
				// Still 19's cups are rows of small grey-brown scales with darker crevices between
				// them. The shader draws the bed from the cup's own coordinates, so the band keeps a
				// single shade here and no second treatment turns the scales into speckle.
			},
			colour: [0.24, 0.1, 0.03],
			// Still 19's cups are a pale grey-brown against the chestnut nut.
			bandColour: [0.3, 0.23, 0.15],
			// Still 19's peduncle is young wood, a yellow-brown close to the twig it hangs from, not
			// the cup's grey.
			stalkColour: [0.26, 0.2, 0.1],
			// Still 19's nuts are polished, with a highlight on each; their cups are matte.
			roughness: [0.35, 0.85],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.2, 0.12, 0.03], transmittance: [0.3, 0.16, 0.02] },
	},
	wind: {
		stiffness: [
			[0, 0.99],
			[0.5, 0.95],
			[1, 0.8],
		],
		sway: { frequency: 0.25, amplitude: 0.03 },
		flutter: { kind: 'blade', amplitude: 0.25, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// Leaves stand on two years of a shoot's run, which puts a second year's cards into every
			// prototype, and the cuttings draw a short dense shoot the crown never does. The two
			// together measure 2.47, 3.66, 6.32 and 11.45 MB; each cap sits above its figure, at the
			// raised ceiling the owner set to hold the cutting class at every tier.
			kitBytes: { low: 2_700_000, medium: 4_000_000, high: 7_100_000, ultra: 13_000_000 },
			// The fitted envelope widens the crown, and the wider crown grows about a seventh more
			// leaf card; the thicker bole adds a little more. Each cap sits just above the first
			// variant's measured figure at its tier: 7.94, 8.13, 8.34 and 8.56 MB.
			// The two-year foliage also adds a second year's leaf card to each variant, which takes the
			// largest of the first three to 9.73 MB at ultra; each cap sits just above its figure.
			variantBytes: { low: 9_400_000, medium: 10_200_000, high: 11_300_000, ultra: 11_600_000 },
			lod0Triangles: 2_500_000,
			lod1Triangles: 150_000,
			lod2Triangles: 30_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1121298234,
	// A phone grows this oak lighter than a desktop: below about half the record's wood and leaf the
	// open-grown dome closes into a ball, and past this coarsening the twigs it hangs its leaves on
	// start to break. These floors are a first pass and are measured against the phone set.
	sparse: { limbs: 0.35, leaves: 0.42, coarseness: 0.6 },
	roundBand,
	// The woodland oak of stills 30 and 31 and the young oak of still 32.
	forms,
	cuttings: {
		// Stills 20, 21 and 22: the branch keeps the spray, whose length stills 20 and 21 ask for. The
		// sub-branch takes the short dense class, which draws the photographs' tighter twigs.
		branch: { shoot: 'spray' },
		subbranch: { shoot: 'cut' },
		// Stills 11 and 23 hold one rosette round its buds at the end of this year's shoot, as the
		// short shoot draws it; the long shoot draws a sprig of two or three rosettes.
		cluster: { shoot: 'short' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
