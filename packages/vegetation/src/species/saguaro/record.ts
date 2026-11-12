// The saguaro: one stout ribbed column that carries no crown, its whole height a stem. A few arms
// leave it in two tiers from pinched junctions, run out nearly level, bend at an elbow and rise
// parallel to the stem to rounded tips below its own. Every rib crest carries a line of
// areoles, and each areole carries a spine cluster: the species' only "leaf", a card with the
// cluster's own picture, standing with its longest spine down the stem. The skin is waxy grey-green
// on the column and fresher on the arms, corky and grey-brown at the foot.
//
// The envelope's aspect and the all-round band are measured from the reference turntable by the
// fitting tool (fit.ts); the column's ribs, arms and areole spacing from the whole-plant stills and
// the close views; the spine cluster from the two texture sources and the areole stills; the skin
// from the skin stills. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, roundBand } from './fit';

/** The saguaro's record. */
export const record: Species = {
	id: 'saguaro',
	name: 'Saguaro',
	latin: 'Carnegiea gigantea',
	form: 'ribbed column with candelabrum arms',
	// Stills 01, 02 and 17: the stem is a twentieth of the plant's height across at breast height,
	// and hardly tapers above its corky foot. The fact sheet's 30 to 75 cm is the width over the
	// whole plant's range.
	size: { height: { mean: 12, spread: 1 }, dbh: 0.7, aspect },
	growth: {
		model: 'column',
		height: { mean: 12, spread: 1 },
		// Still 17: a column that hardly tapers above the foot. Stills 01 and 18: the arms' span is
		// about a third of the height, so the widest ring of foliage stands at the arms.
		radius: [
			[0, 0.58],
			[0.12, 0.54],
			[0.5, 0.51],
			[0.85, 0.48],
			[1, 0.41],
		],
		// Stills 04, 09 and 13: twelve to twenty ribs on the stem, their crests five to eight
		// centimetres apart, and the cross-section's pleats a couple of centimetres deep.
		ribs: { mean: 14, spread: 1 },
		ribDepth: 0.02,
		// Stills 01, 02, 06 and 07: three to six arms leave the stem singly in two tiers, each from a
		// pinched junction; the lower tier leaves about a third of the way up and tips at half the
		// height, the upper leaves just above half and tips at five sixths. The lower tier turns up
		// inside the upper one's span, as the silhouette shows. Each arm runs out nearly level, bends
		// at an elbow and rises parallel to the stem to a tip below its top.
		arms: {
			count: { mean: 5, spread: 1 },
			from: [0.33, 0.56],
			elbow: [0.45, 0.85],
			// Still 18: an arm reads about three quarters of the trunk's width, so the radius takes
			// that share of the trunk's girth.
			radius: 0.26,
			rise: [
				{ mean: 1.6, spread: 0.35 },
				{ mean: 2.8, spread: 0.4 },
			],
		},
		// Stills 09, 10 and 15: areoles one to three centimetres apart along every crest, each an
		// oval pad about a centimetre long.
		areoles: 0.03,
	},
	shoots: {
		// The areole's spine cluster, in four sizes, so neighbouring clusters differ a little.
		prototypes: 4,
		classes: [
			{
				// Stills 10, 11 and 24: one areole's pad carries the cluster, and the cluster's card is
				// the species' leaf. The pad stands a few millimetres proud of the skin.
				name: 'spur',
				vigor: [0, 1],
				share: 1,
				length: { mean: 0.008, spread: 0.001 },
				nodes: { mean: 1, spread: 0 },
				internode: [
					[0, 1],
					[1, 1],
				],
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: [
					[0, 90],
					[1, 90],
				],
				// Still 24: the longest central spine points down the stem, so every cluster lies the same
				// way up its crest rather than turning a random face to the viewer. The card's midrib is
				// the leaf's line, so its azimuth points that line down the stem. The class keeps none
				// of the skyward turn, which leaves the card's face outward from the skin rather than
				// turning it up to the light.
				azimuth: 270,
				skyward: 0,
				droop: 0,
				stem: { radius: [0.007, 0.005] },
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 137.5 },
		orders: 1,
		years: 1,
		leafYears: 1,
		stem: { radius: [0.007, 0.005], zigzag: 0 },
		// Still 12: the areole's felt pad is the only bud the card carries, under the cluster.
		bud: { length: 0.002, width: 0.002, tipCluster: 0, colour: [0.42, 0.36, 0.29] },
		placement: {
			// One card at every areole: the grower sets the areoles' spacing, so the curve gives the
			// one shoot a metre of stretch that each bud's own stretch fills.
			perMetre: [
				[0, 40],
				[1, 40],
			],
			density: 1,
			shadePrune: 0,
			// The arms and stem are lit all over: no side of the column stands in a crown's shade.
			bareTrim: 0,
			lift: 0,
			skyward: 1,
			scale: { mean: 1, spread: 0.04 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 16 and 24: a cluster spans about six to eight centimetres across its spines on the
			// arm, where the areoles stand three centimetres apart and the picture's spines stay separate.
			length: { mean: 0.08, spread: 0.008 },
			outline: 'texture',
			// The card is the cluster's own picture: a flat, stiff card with no fold of its own.
			petiole: { length: 0.002, radius: 0.0012, flat: 0, droop: 0 },
			fold: 0,
			curl: 0,
			crossCurl: 0,
			twist: 0,
			wave: [0.002, 60],
			optics: {
				// Still 24's spines are pale grey-brown, their tips dark. The surface is matte.
				reflectance: [0.38, 0.35, 0.28],
				reflectanceBack: [0.32, 0.3, 0.24],
				transmittance: [0.02, 0.02, 0.015],
				roughness: [0.75, 0.9],
			},
		},
	},
	bark: {
		zones: [
			// Still 14: the foot is grey-brown, corky and scarred, its ribs worn, for the lowest metre
			// and a half of the stem.
			{ layer: 1, by: 'height', from: 0, to: 1.6, blend: 0.8, tint: [0.68, 0.68, 0.68] },
			// Still 14: the green above the corky foot reads paler and bluer than the photograph, so
			// the lowest band of green takes a tint that darkens it toward the picture's own tone.
			{ layer: 0, by: 'height', from: 1.6, to: 3.2, blend: 0.8, tint: [0.88, 0.83, 0.72] },
			// Stills 09 and 15: waxy grey-green skin on rounded ribs and deep pleated grooves up the
			// whole stem.
			{ layer: 0, by: 'height', from: 3.2, to: 40, blend: 0.5, tint: [1, 1, 1] },
		],
		// Still 16: an arm's skin is fresher green than the old stem's. The arms are the wood below the
		// stem's girth, so the young layer carries their skin.
		young: 2,
		youngRadius: 0.27,
		girthScale: [
			[0, 1],
			[1, 1],
		],
		// Still 15: the furrows between the ribs are shallow folds in the skin rather than the ribs
		// themselves, which are the stem's own shape.
		displacement: 0.006,
		// Still 07: the arm leaves the stem on a short pinched junction, with little collar.
		collar: { swell: 0, length: 1.4, ridge: 0.1 },
		fork: { bend: 3 },
	},
	extras: [
		{
			// Still 20: a woodpecker's nest hole is a round dark socket with a callused rim. The site
			// stands a little inside the skin, so the socket sits flush and reads as a hole.
			kind: 'berry',
			at: 'old-wood',
			share: 1,
			seasons: ['summer', 'autumn', 'winter', 'blossom'],
			shape: {
				lathe: [
					[0.001, 0],
					[0.028, 0],
					[0.031, 0.006],
					[0.024, 0.012],
					[0.001, 0.014],
				],
			},
			colour: [0.045, 0.03, 0.02],
			roughness: [0.95, 0.95],
			hang: 0,
		},
		{
			// Still 19: a ring of waxy white funnel flowers, yellow at the centre, stands round the
			// stem's crown in late spring.
			kind: 'flower',
			at: 'flower',
			share: 1,
			seasons: ['blossom'],
			shape: { petals: 12, radius: 0.055, cup: 0.25 },
			colour: [0.92, 0.9, 0.82],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		blossom: { extra: 0, leaves: 1 },
	},
	wind: {
		// The wind clip: the cactus stands completely rigid, and only the dust and grass at its foot
		// move. The stem takes almost no sway and the spine cards none.
		stiffness: [
			[0, 1],
			[1, 1],
		],
		sway: { frequency: 0.08, amplitude: 0.0015 },
		flutter: { kind: 'blade', amplitude: 0.01, frequency: 1.2 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		woodOrders: [1, 1],
		cardGrow: 1,
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// Four areole prototypes of one small card each, and the card atlas: the largest kit, at
			// the finest tier, measures 1.21 MB.
			kitBytes: { low: 1_250_000, medium: 1_250_000, high: 1_250_000, ultra: 1_250_000 },
			// Every areole stands as a shoot row; the largest variant measures 6.23 MB at the finest
			// tier, which the two card levels take.
			variantBytes: {
				low: 6_300_000,
				medium: 6_300_000,
				high: 6_300_000,
				ultra: 6_300_000,
			},
			// The nearest level draws the stem's and arms' wood; the areole cards are instanced rows.
			lod0Triangles: 60_000,
			// The first card level's areole cards measure 109,223 triangles at the finest tier; the
			// second, every other card of the first, 46,892.
			lod1Triangles: 112_000,
			lod2Triangles: 48_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 320_000,
			growMilliseconds: 550,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1916846534,
	roundBand,
	cuttings: {
		// Still 21: the whole arm, from the pinched junction through its run and elbow to upright.
		branch: { order: 1, length: 4.8 },
		// Still 22: a short section of stem, showing the ribs and the areole rows.
		subbranch: { order: 1, length: 0.35 },
	},
};
