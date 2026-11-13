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
	size: { height: { mean: 1.01, spread: 0.08 }, aspect: 0.85 },
	growth: {
		model: 'tuft',
		mound: 0.59,
		shoots: { mean: 56, spread: 8 },
		stool: 0.76,
		sheath: { height: 0.35, width: 0.096 },
		sheathColour: { foot: [0.21, 0.123, 0.079], collar: [0.21, 0.107, 0.062], reach: 0.85 },
		blades: { mean: 5.5, spread: 0.5 },
		ranks: 3,
		poses: [
			{ share: 0.25, leave: 85, apex: 0.88, drop: 0.04, reach: 0.16 },
			{ share: 0.4, leave: 85, apex: 0.78, drop: 0.78, reach: 0.38, tip: 90 },
			{ share: 0.35, leave: 75, apex: 0.62, drop: 0.62, reach: 1.05, tip: 75 },
		],
		bladeSpread: 0.25,
		stalks: {
			count: { mean: 22, spread: 2 },
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			top: [1, 1.69],
			lean: [0, 35],
			bow: { from: 0.7, turn: [100, 150] },
			width: 0.025,
			sides: 3,
			head: { kind: 'spike', count: 3, length: 0.33, width: 0.028, thread: 0.07, tip: 0.13 },
		},
		least: { shoots: 8, blades: 3, stalks: 5 },
		soil: {
			rhizome: { mean: 0.04, spread: 0.01 },
			rhizomeRadius: 0.011,
			roots: { mean: 32, spread: 5 },
			rootLength: { mean: 0.18, spread: 0.05 },
			rootRadius: 0.0045,
			droop: { mean: 40, spread: 15 },
		},
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			length: { mean: 0.9, spread: 0.22 },
			width: 0.038,
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
		nearFoliage: 'instanced',
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
		mound: 0.5,
		shoots: { mean: 16, spread: 3 },
		stool: 0.36,
		sheath: { height: 0.14, width: 0.035 },
		sheathColour: { foot: [0.366, 0.38, 0.309], collar: [0.366, 0.38, 0.309], reach: 0.85 },
		blades: { mean: 3.2, spread: 0.6 },
		ranks: 2,
		poses: [
			{ share: 0.4, leave: 85, apex: 0.95, drop: 0, reach: 0.08 },
			{ share: 0.35, leave: 65, apex: 0.72, drop: 0.02, reach: 0.4 },
			{ share: 0.25, leave: 38, apex: 0.45, drop: 0.23, reach: 0.75 },
		],
		bladeSpread: 0.12,
		stalks: {
			count: { mean: 12, spread: 1 },
			seasons: ['blossom', 'summer'],
			top: [1.45, 2],
			lean: [0, 35],
			bow: { from: 0.5, turn: [4, 12] },
			width: 0.012,
			sides: 5,
			head: {
				kind: 'panicle',
				length: 0.44,
				width: 0.3,
				whorls: 4,
				branches: 4,
				angle: 45,
				spikelets: 5,
				spikelet: 0.03,
			},
		},
		least: { shoots: 7, blades: 2, stalks: 4 },
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			length: { mean: 0.26, spread: 0.03 },
			width: 0.0085,
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
		nearFoliage: 'instanced',
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
