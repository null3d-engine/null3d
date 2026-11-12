// The holm oak, in its multi-stem clump form: about eight slender, dark, sinuous stems leave one
// swollen stool at narrow angles, then divide into a fine twig web under a broad dense evergreen
// dome that is wider than tall. The leaves are narrow ovals with entire margins and a few spine
// teeth near the tip; the upper face is dark and glossy, the lower face is dense grey-white felt,
// which is why the crown flashes silver in wind.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the
// shoot classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from
// the texture sources and the single-leaf stills; the bark from the bark stills. The record is
// plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a growth unit: the leaves crowd toward the tip round the bud cluster. */
const SHOOT: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.4, 0.6],
	[1, 0.35],
];

/** The holm oak's record. */
export const record: Species = {
	id: 'holm-oak',
	name: 'Holm oak',
	latin: 'Quercus ilex',
	form: 'multi-stem clump under a broad, dense evergreen dome',
	size: { height: { mean: 8, spread: 1.2 }, dbh: 0.24, aspect },
	growth: {
		model: 'self-organizing',
		years: 38,
		macroOrders: 4,
		internode: { length: 0.25, ageFactor: 0.99 },
		stems: {
			count: { mean: 8, spread: 2 },
			lean: { mean: 26, spread: 6 },
			stool: 0.45,
			fused: 0.95,
		},
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0.25, 55],
				[1, 60],
			],
			angleSpread: 10,
			extinction: [0.005, 0.008],
		},
		apical: {
			control: [
				[0, 0.38],
				[1, 0.42],
			],
			dominance: [0.4, 0.5, 0.95],
			wander: 16,
		},
		divide: { at: 0.46, count: 2, angle: 45, lean: 6 },
		light: { apical: 1, lateral: 1.5, shadow: [5, 0.15, 2], cells: 96 },
		tropism: {
			photo: 0.08,
			gravi: [
				[0, 0.25],
				[0.25, 0.06],
				[0.5, 0],
				[0.75, 0],
				[1, 0.02],
			],
		},
		// The stool's limbs pass round one another rather than through, and the thick wood keeps the
		// clear air; the fine twigs keep their own layout. A stool's stems stand closer than a single
		// bole's limbs, so the clear air is narrower than a lone trunk's.
		clearance: 0.1,
		clearanceThickness: 0.35,
		turning: 30,
		shedding: { threshold: 0.06, cleanBole: 0.35, stubs: 0.12 },
		bending: { strength: 0.05, upturn: 0.25 },
		forkRule: true,
		kinks: true,
		pipe: { exponent: 2.3, tipRadius: 0.004 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// This year's shoot of still 23: a short twig whose alternate leaves crowd toward
				// the tip round the bud cluster, the oldest opens widest and hangs lowest.
				name: 'short',
				vigor: [0, 0.04],
				share: 0.3,
				years: 1,
				length: { mean: 0.13, spread: 0.02 },
				nodes: { mean: 8, spread: 0.5 },
				internode: SHOOT,
				leafScale: [
					[0, 1.28],
					[1, 1.58],
				],
				leafAngle: [
					[0, 150],
					[0.5, 95],
					[1, 40],
				],
				// The rosette crowds its leaves at one point, so the curve alone gives them all one
				// angle and the cluster stands flat. The spread opens them over a range instead.
				leafAngleSpread: 30,
				droop: 4,
			},
			{
				// The twig of stills 10 and 22: last year's shoot, whose end cluster put out this
				// year's shoots.
				name: 'long',
				vigor: [0.04, 0.2],
				share: 0.35,
				years: 2,
				length: { mean: 0.38, spread: 0.06 },
				nodes: { mean: 7, spread: 1 },
				internode: SHOOT,
				stem: { radius: [0.014, 0.008] },
				leafScale: [
					[0, 1.2],
					[1, 1.5],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 6,
			},
			{
				// The branch of still 21: three years of twigs, short and wide-angled, with a
				// cluster of shoots at each end.
				name: 'spray',
				vigor: [0.2, 1],
				share: 0.35,
				years: 3,
				length: { mean: 1, spread: 0.15 },
				nodes: { mean: 9, spread: 1 },
				internode: SHOOT,
				stem: { radius: [0.026, 0.012] },
				lateral: 72,
				leafScale: [
					[0, 1.2],
					[1, 1.5],
				],
				leafAngle: [
					[0, 120],
					[0.5, 90],
					[1, 60],
				],
				droop: 7,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 1,
		stem: { radius: [0.01, 0.006], zigzag: 14 },
		// The leaf photographs' terminal cluster: seven buds about 1.4 cm long, where the drawn
		// 1 cm buds read as one speck at the studio cluster's scale. The size moves no kit byte.
		bud: { length: 0.014, width: 0.01, tipCluster: 7, colour: [0.28, 0.2, 0.12] },
		placement: {
			perMetre: [
				[0, 4],
				[0.55, 8],
				[1, 64],
			],
			density: 0.7,
			// A twig that carries no shoot is trimmed past its last one, so no bare tip stands
			// outside the foliage at a whole view.
			bareTrim: 0.03,
			shadePrune: 0.1,
			skyward: 0.0,
			scale: { mean: 1.3, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.08, spread: 0.012 },
			outline: 'texture',
			petiole: { length: 0.004, radius: 0.0008, flat: 0, droop: 12 },
			fold: 16,
			curl: 18,
			crossCurl: -6,
			twist: 6,
			wave: [0, 0],
			optics: {
				reflectance: [0.0271, 0.0546, 0.009],
				reflectanceBack: [0.365, 0.368, 0.3],
				transmittance: [0.04, 0.08, 0.012],
				roughness: [0.32, 0.72],
				sheen: 0.6,
			},
		},
	},
	bark: {
		zones: [
			// The stool: the photograph's bark reads light and yellow-green where the algae sit, and
			// the moss over the foot pulls the drawn mean dark, so the foot takes its own tint.
			{ layer: 0, by: 'height', from: 0, to: 1, blend: 0.3, tint: [1.75, 1.8, 1.15] },
			// The trunk keeps the texture's measured colour, since the flat-lit texture view draws the
			// same material: the mid-stem view takes its own light instead.
			{ layer: 0, by: 'height', from: 1, to: 3.6, blend: 0.4, tint: [1, 1, 1] },
			// The great limbs stand above the texture view's own height and carry the yellow that
			// their photograph shows over the bark and its lichen.
			{ layer: 0, by: 'height', from: 3.6, to: 40, blend: 0.5, tint: [1.14, 1.22, 0.6] },
		],
		young: 0,
		youngRadius: 0.06,
		girthScale: [
			[0, 0.55],
			[1, 1],
		],
		displacement: 0.012,
		collar: { swell: 0.4, length: 1.8, ridge: 0.5 },
		moss: { amount: 0.25, up: 0.5, north: 0, colour: [0.3, 0.36, 0.16] },
		lichen: { amount: 0.9, from: 3, colour: [0.48, 0.56, 0.06] },
	},
	base: {
		flare: { amount: 0.6, height: 0.4 },
		buttress: { lobes: { mean: 5, spread: 1 }, amount: 0.6, sharpness: 2, height: 0.6 },
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 0.9, spread: 0.25 },
			radius: 0.1,
			dive: 0.2,
		},
		flutes: { count: { mean: 5, spread: 1 }, depth: 0.1, height: 1.5 },
	},
	extras: [
		{
			// The acorn of still 19: the pedunculate oak's nut, about two centimetres long, in a deep
			// cup of scale rows over its top third, one to three on a short forking stalk.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.06,
			count: { mean: 3, spread: 0 },
			tipShare: 0.8,
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.0012, 0],
					[0.0034, 0.0016],
					[0.0064, 0.0042],
					[0.0075, 0.0068],
					[0.0064, 0.0078],
					[0.0072, 0.0108],
					[0.0066, 0.014],
					[0.005, 0.018],
					[0.0024, 0.0205],
					[0.001, 0.0215],
					[0, 0.022],
				],
				sides: 24,
				scales: 3,
				scaled: [0, 0.0068],
				stalk: 0.032,
				pedicel: 0.012,
			},
			colour: [0.24, 0.1, 0.03],
			hang: 180,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
	},
	wind: {
		stiffness: [
			[0, 0.995],
			[0.5, 0.96],
			[1, 0.94],
		],
		sway: { frequency: 0.32, amplitude: 0.015 },
		flutter: { kind: 'blade', amplitude: 0.14, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		// The cards stand a quarter larger than the shoots they picture, so a gap between one
		// shoot's leaves falls on a neighbour's leaves rather than on sky.
		cardGrow: 1.25,
		// A card draws its twig at least three pixels across, from the parent's end to the leaves'
		// centre, so a spray over a fine twig does not read as a piece in air.
		cardStalk: 3,
		cardStalkToFoliage: true,
		switchPixels: [500, 12, 160],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The lead merge grew the ultra kit to 9,894,888 from the 9.5 MB the record held; the
			// measured figure plus about three per cent, and still under the owner's 13 MB tree cap.
			kitBytes: { low: 2_000_000, medium: 2_900_000, high: 5_300_000, ultra: 10_200_000 },
			// The densest variant sets each cap: variant 4 measures 10.18, 10.29, 10.50 and 10.85 MB
			// at the four tiers. Each cap sits just above its figure. The crown's foliage stands in
			// fewer, larger leaves, which carries the cover at fewer triangles.
			variantBytes: { low: 10_300_000, medium: 10_400_000, high: 10_600_000, ultra: 10_900_000 },
			// The near band measures 2,728,516 triangles; the cap sits just above it, under the
			// owner's 2.9 million.
			lod0Triangles: 2_750_000,
			lod1Triangles: 150_000,
			// The second card level measures 33,854 triangles with the clearance; the cap sits just
			// above it.
			lod2Triangles: 34_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1477281293,
	// A first pass at the floors a phone's lighter form keeps, set from the species' form and to
	// be measured on the phone set before they are trusted.
	sparse: { limbs: 0.4, leaves: 0.5, coarseness: 0.55 },
	roundBand,
	cuttings: {
		branch: { shoot: 'spray' },
		subbranch: { shoot: 'long' },
		cluster: { shoot: 'short' },
	},
};
