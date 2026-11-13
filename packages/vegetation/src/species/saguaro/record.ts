// The saguaro: one stout ribbed column that carries no crown, its whole height a stem. Four arms
// leave it a little below and a little above the middle, each out from a pinched joint, through one
// smooth elbow and up beside the stem to a rounded tip below its own. Every rib crest carries a
// line of areoles, and each areole carries a spine cluster: the species' only "leaf", a card with
// the cluster's own picture, standing with its longest spine down the stem. The skin is waxy
// grey-green on the column and the arms, corky and grey-brown at the foot.
//
// The height is the fact sheet's. Every other length is a share of the height measured on still 01,
// the first frame of the turning video, written here in metres at that height with the share beside
// it. The ribs and the areole spacing come from the close views, the spine cluster from the two
// texture sources and the areole stills, the skin from the skin stills. The envelope's aspect and
// the all-round band are the fitting tool's (fit.ts). The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, roundBand } from './fit';

/** The saguaro's record. */
export const record: Species = {
	id: 'saguaro',
	name: 'Saguaro',
	latin: 'Carnegiea gigantea',
	form: 'ribbed column with candelabrum arms',
	// The fact sheet: a mature plant stands 10 to 15 m tall. Still 01: the stem is 0.089 of the
	// height across below the arms.
	size: { height: { mean: 12, spread: 1 }, dbh: 1.07, aspect },
	growth: {
		model: 'column',
		height: { mean: 12, spread: 1 },
		// Still 01, the stem's width as a share of the height from its true foot: 0.083 at the foot,
		// 0.089 from just above it to the arms, 0.063 at 0.7 and 0.053 at 0.95, under the rounded top.
		radius: [
			[0, 0.5],
			[0.05, 0.534],
			[0.44, 0.534],
			[0.56, 0.396],
			[0.85, 0.372],
			[1, 0.29],
		],
		// Still 04: the stem and each arm end in a rounded top 0.65 of a width tall.
		dome: 1.3,
		// Stills 09 and 13: eighteen ribs round the stem, and a groove 0.17 of the radius deep.
		ribs: { mean: 18, spread: 1 },
		ribDepth: 0.17,
		// Still 01 and the turning video: four arms in two tiers. On still 01 read from its true foot
		// the arms' lowest point stands at 0.40 to 0.44 of the height, so the lower pair leaves at
		// 0.42 and stands 0.145 of the height out from the stem's axis, and the upper pair leaves
		// at 0.47 and stands 0.081 out, close beside the stem. All four tips end at 0.78. An arm is
		// 0.054 of the height across above its bend and 0.042 at its tip (0.0485 and 0.038 on the
		// upper pair) and 0.063 across in the bend. Where it meets the stem it is 0.65 of its girth
		// on stills 07 and 21 and nearly its full girth on still 08, so the joint takes a value
		// between them. Its underside sags a little below its joint (stills 01 and 05), so it
		// leaves a few degrees below level, and its elbow turns on a radius of one and a half arm
		// widths at the centre line (stills 01, 08 and 21) where its reach leaves room.
		// The turning video and still 01 show the primary plant's four arms in one upright plane: the
		// arms close up edge on twice in the turn. That plant is the first variant, and it is the
		// species' named exception to the rule that a plant is balanced round its stem. The other
		// variants spread their arms round the stem.
		arms: {
			count: { mean: 4, spread: 1 },
			tiers: [
				{
					at: { mean: 0.42, spread: 0.03 },
					reach: { mean: 1.74, spread: 0.12 },
					top: { mean: 0.78, spread: 0.03 },
					radius: [0.324, 0.252],
				},
				{
					at: { mean: 0.47, spread: 0.03 },
					reach: { mean: 0.97, spread: 0.08 },
					top: { mean: 0.78, spread: 0.03 },
					radius: [0.304, 0.239],
				},
			],
			plane: 1,
			// Stills 04 and 16: fourteen ribs round an arm.
			ribs: { mean: 14, spread: 1 },
			leave: -5,
			elbow: 1.5,
			pinch: 0.75,
			swell: 1.17,
		},
		// Still 15: the areoles stand 0.45 of the gap between two crests apart along a crest.
		areoles: 0.084,
	},
	shoots: {
		// The areole's spine cluster, in four sizes, so neighbouring clusters differ a little.
		prototypes: 4,
		classes: [
			{
				// Stills 10, 11 and 24: one areole's pad carries the cluster, and the cluster's card is
				// the species' leaf. The pad stands a few millimetres proud of the skin. A plant carries
				// thousands, so each draws as its card alone, two triangles, and the card's picture
				// carries the pad and the spines.
				name: 'spur',
				cards: true,
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
		// Every wood above the corky foot takes the stem's skin. The arm's own picture (still 16) is a
		// crop of a lit arm whose seams and waxy highlight repeat as tiles and a white stripe when
		// tiled, and an arm is as thick as the stem's top, so no radius parts the two: the young
		// layer is not drawn. The arm's fresher green of still 16 is not drawn either.
		young: 2,
		youngRadius: 0,
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
		// Still 21: the whole arm, from the pinched junction through its run and elbow to upright,
		// standing as it grew, its upright part plumb.
		branch: { order: 1, length: 4.8, stands: 'as-grown' },
		// Still 22: a short section of stem, showing the ribs and the areole rows.
		subbranch: { order: 1, length: 0.35 },
	},
};
