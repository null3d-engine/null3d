// The ground plants' test records: hosta, pendulous sedge and meadow grass, grown end to end by the
// rosette and tuft growers. Their numbers are read from each reference set's fact sheet and stills
// (sizes, leaf counts and shapes, the stems and their heads); each species package copies its own
// record's growth, foliage, extras and size into its folder and fits them to its references and
// textures. They name no texture files, so their leaves map onto the parametric frame.
import type { Species } from '../core/record';
import { noTextureFiles, type SpeciesTextureFiles } from '../core/textures';

/** The budget the three test records share, under the owner's caps for ground plants; each gives
 * its own bytes a variant at each tier, its largest measured variant with about 15 per cent spare. */
const BUDGET = {
	kitBytes: { low: 600_000, medium: 600_000, high: 600_000, ultra: 600_000 },
	lod0Triangles: 200_000,
	lod1Triangles: 30_000,
	lod2Triangles: 8_000,
	downloadBytes: 350_000,
	downloadHalfBytes: 120_000,
	growMilliseconds: 150,
} as const;

/**
 * Hosta: a mound 0.5 to 0.6 m tall and about twice as wide, of broad heart-shaped ribbed leaves on
 * long grooved stalks from one crown, with lavender flowers on tall bare scapes when in flower.
 */
export const hostaRecord: Species = {
	id: 'hosta',
	name: 'Hosta',
	latin: 'Hosta',
	form: 'low mound of broad ribbed leaves on long stalks',
	size: { height: { mean: 0.55, spread: 0.05 }, aspect: 1.9 },
	growth: {
		model: 'rosette',
		shoots: { mean: 5, spread: 1 },
		crown: 0.06,
		leaves: { mean: 7, spread: 1 },
		divergence: 137.5,
		tilt: [
			[0, 4],
			[0.4, 18],
			[0.8, 38],
			[1, 48],
		],
		arch: [
			[0, 3],
			[0.5, 18],
			[1, 55],
		],
		stalk: [
			[0, 0.18],
			[0.4, 0.36],
			[1, 0.36],
		],
		size: [
			[0, 0.45],
			[0.3, 0.9],
			[1, 1],
		],
		pitch: [
			[0, 8],
			[0.5, 30],
			[1, 40],
		],
		rolled: 0.17,
		collapse: 35,
		scapes: {
			count: { mean: 4, spread: 1 },
			height: { mean: 0.85, spread: 0.12 },
			radius: 0.0045,
			lean: { mean: 8, spread: 6 },
			raceme: 0.32,
			flowers: { mean: 13, spread: 3 },
			seasons: ['blossom'],
		},
	},
	foliage: {
		kind: 'thick',
		leaf: {
			length: { mean: 0.25, spread: 0.03 },
			outline: {
				width: [
					[0, 0.3],
					[0.25, 0.39],
					[0.5, 0.35],
					[0.75, 0.24],
					[1, 0.04],
				],
				tip: 'acuminate',
				base: 'cordate',
			},
			ribs: { count: 9, depth: 0.32, start: 0.55, sweep: 0.3 },
			cup: 22,
			curl: 30,
			wave: [0.003, 2.5],
			stalk: { radius: 0.0055, channel: 0.45 },
			optics: {
				reflectance: [0.07, 0.2, 0.035],
				reflectanceBack: [0.12, 0.24, 0.07],
				transmittance: [0.08, 0.2, 0.02],
				roughness: [0.35, 0.6],
			},
		},
	},
	extras: [
		{
			kind: 'flower',
			at: 'flower',
			share: 1,
			seasons: ['blossom'],
			shape: { petals: 6, radius: 0.022, cup: 0.8 },
			colour: [0.55, 0.45, 0.78],
			hang: 55,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		autumn: { reflectance: [0.35, 0.3, 0.05], transmittance: [0.4, 0.33, 0.04] },
		blossom: { extra: 0, leaves: 1 },
	},
	wind: {
		stiffness: [
			[0, 0.9],
			[1, 0.45],
		],
		sway: { frequency: 0.8, amplitude: 0.03 },
		flutter: { kind: 'blade', amplitude: 0.08, frequency: 1.4 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			...BUDGET,
			variantBytes: { low: 510_000, medium: 1_230_000, high: 1_660_000, ultra: 3_800_000 },
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x4057a,
	cuttings: {
		branch: { order: 1, length: 0.6 },
		subbranch: { order: 1, length: 0.35 },
	},
};

/**
 * Pendulous sedge: a wide fountain of broad keeled leaves 0.5 to 1 m long, under three-angled
 * stems 1 to 2 m tall that bow over and hang long spikes one below another, a brown one at the tip.
 */
export const sedgeRecord: Species = {
	id: 'pendulous-sedge',
	name: 'Pendulous sedge',
	latin: 'Carex pendula',
	form: 'wide fountain of broad leaves under tall bowed stems with hanging spikes',
	size: { height: { mean: 1.5, spread: 0.25 }, aspect: 0.85 },
	growth: {
		model: 'tuft',
		shoots: { mean: 30, spread: 4 },
		base: 0.12,
		lean: [
			[0, 3],
			[1, 16],
		],
		blades: { mean: 5, spread: 1 },
		ranks: 3,
		sheath: { mean: 0.1, spread: 0.03 },
		sheathRadius: 0.006,
		spread: [
			[0, 4],
			[1, 30],
		],
		size: [
			[0, 0.6],
			[0.5, 1],
			[1, 0.95],
		],
		heads: {
			count: { mean: 10, spread: 3 },
			kind: 'spike',
			height: { mean: 1.25, spread: 0.2 },
			radius: 0.0035,
			sides: 3,
			bow: { mean: 95, spread: 20 },
			seasons: ['blossom', 'summer', 'autumn'],
			spikes: {
				count: { mean: 4, spread: 1 },
				spacing: { mean: 0.1, spread: 0.03 },
				stalk: { mean: 0.04, spread: 0.015 },
			},
		},
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			length: { mean: 0.75, spread: 0.12 },
			width: 0.017,
			profile: [
				[0, 0.7],
				[0.08, 1],
				[0.6, 0.85],
				[1, 0.55],
			],
			tip: 'pointed',
			tipLength: 0.3,
			fold: 22,
			twist: 40,
			arch: { mean: 95, spread: 25 },
			dryTip: 0.06,
			optics: {
				reflectance: [0.09, 0.17, 0.035],
				reflectanceBack: [0.1, 0.16, 0.12],
				transmittance: [0.07, 0.15, 0.02],
				roughness: [0.3, 0.65],
			},
		},
	},
	extras: [
		{
			kind: 'catkin',
			at: 'flower',
			share: 1,
			seasons: ['blossom', 'summer'],
			shape: { catkin: { length: 0.11, radius: 0.0028 } },
			colour: [0.12, 0.17, 0.06],
			hang: 180,
		},
		{
			kind: 'catkin',
			at: 'flower',
			share: 1,
			seasons: ['autumn', 'winter'],
			shape: { catkin: { length: 0.11, radius: 0.0028 } },
			colour: [0.16, 0.1, 0.05],
			hang: 180,
		},
		{
			kind: 'spike',
			at: 'stem-tip',
			share: 1,
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			shape: { catkin: { length: 0.05, radius: 0.0022 } },
			colour: [0.2, 0.12, 0.06],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		autumn: { reflectance: [0.2, 0.15, 0.05], transmittance: [0.22, 0.16, 0.04] },
	},
	wind: {
		stiffness: [
			[0, 0.8],
			[1, 0.2],
		],
		sway: { frequency: 0.5, amplitude: 0.08 },
		flutter: { kind: 'grass', amplitude: 0.2, frequency: 2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			...BUDGET,
			variantBytes: { low: 470_000, medium: 520_000, high: 570_000, ultra: 790_000 },
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x5ed6e,
	cuttings: {
		branch: { order: 1, length: 1 },
		subbranch: { order: 1, length: 0.4 },
	},
};

/**
 * Meadow grass: a loose tuft of flat blades 2 to 4 mm wide, even in width to a blunt hooded tip,
 * with slender stems at about twice the leaf height carrying open pyramid panicles.
 */
export const meadowGrassRecord: Species = {
	id: 'meadow-grass',
	name: 'Meadow grass',
	latin: 'Poa pratensis',
	form: 'loose tuft of flat blades under slender stems with open panicles',
	size: { height: { mean: 0.5, spread: 0.08 }, aspect: 0.75 },
	growth: {
		model: 'tuft',
		shoots: { mean: 34, spread: 5 },
		base: 0.045,
		lean: [
			[0, 3],
			[1, 14],
		],
		blades: { mean: 3, spread: 1 },
		ranks: 2,
		sheath: { mean: 0.035, spread: 0.01 },
		sheathRadius: 0.0018,
		spread: [
			[0, 4],
			[1, 26],
		],
		size: [
			[0, 0.6],
			[0.5, 1],
			[1, 0.85],
		],
		heads: {
			count: { mean: 12, spread: 3 },
			kind: 'panicle',
			height: { mean: 0.48, spread: 0.08 },
			radius: 0.0011,
			sides: 5,
			bow: { mean: 12, spread: 8 },
			seasons: ['blossom', 'summer'],
			panicle: {
				length: { mean: 0.14, spread: 0.03 },
				whorls: 6,
				branches: { mean: 3, spread: 1 },
				angle: [
					[0, 42],
					[1, 26],
				],
				droop: 10,
				flowers: { mean: 3, spread: 1 },
			},
		},
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			length: { mean: 0.26, spread: 0.05 },
			width: 0.0035,
			profile: [
				[0, 0.85],
				[0.1, 1],
				[1, 1],
			],
			tip: 'hooded',
			tipLength: 0.04,
			fold: 18,
			twist: 30,
			arch: { mean: 50, spread: 20 },
			dryTip: 0.03,
			optics: {
				reflectance: [0.08, 0.19, 0.035],
				reflectanceBack: [0.09, 0.18, 0.05],
				transmittance: [0.07, 0.17, 0.02],
				roughness: [0.45, 0.4],
			},
		},
	},
	extras: [
		{
			kind: 'spike',
			at: 'flower',
			share: 1,
			seasons: ['blossom', 'summer'],
			shape: {
				lathe: [
					[0.0005, 0],
					[0.0018, 0.002],
					[0, 0.005],
				],
			},
			colour: [0.13, 0.13, 0.09],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		autumn: { reflectance: [0.2, 0.17, 0.06], transmittance: [0.22, 0.18, 0.05] },
	},
	wind: {
		stiffness: [
			[0, 0.7],
			[1, 0.15],
		],
		sway: { frequency: 0.7, amplitude: 0.06 },
		flutter: { kind: 'grass', amplitude: 0.25, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			...BUDGET,
			variantBytes: { low: 1_560_000, medium: 1_600_000, high: 1_640_000, ultra: 1_790_000 },
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x9ea55,
	cuttings: {
		branch: { order: 1, length: 0.5 },
		subbranch: { order: 1, length: 0.35 },
	},
};

/** The three test records with no texture files, as a species module gives them. */
export const GROUND_TEST_SPECIES: readonly {
	readonly record: Species;
	readonly textures: SpeciesTextureFiles;
}[] = [hostaRecord, sedgeRecord, meadowGrassRecord].map((record) => ({
	record,
	textures: noTextureFiles(record.id),
}));
