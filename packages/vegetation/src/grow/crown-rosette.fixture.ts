// A crown-rosette test record: one stem under a living crown and a dead frond skirt, whose pinnae
// are the species' leaves. The numbers are a palm-like plant, chosen so the grower's checks read
// easily; the tree fern's own record fits them to its references.
import type { Species } from '../core/record';

/** A small crown-rosette record for the grower's tests. */
export const palmRecord: Species = {
	id: 'crown-rosette-test',
	name: 'Crown rosette test',
	latin: 'Testus rosetta',
	form: 'one stem under a crown of fronds',
	size: { height: { mean: 3, spread: 0.2 }, dbh: 0.3, aspect: 1 },
	growth: {
		model: 'crown-rosette',
		stem: {
			height: { mean: 2, spread: 0.1 },
			radius: [
				[0, 0.2],
				[1, 0.15],
			],
			lean: { mean: 2, spread: 1 },
			curve: { mean: 0, spread: 0 },
			surface: 'smooth',
		},
		crown: {
			fronds: { mean: 12, spread: 1 },
			divergence: 137.5,
			tilt: [
				[0, 20],
				[0.5, 60],
				[1, 90],
			],
			dead: { count: { mean: 4, spread: 0 }, hang: 75, skirt: 0.7 },
			croziers: { mean: 2, spread: 0 },
		},
		frond: {
			kind: 'bipinnate',
			length: { mean: 1.6, spread: 0.1 },
			petiole: { length: 0.2, width: 0.04, teeth: 0 },
			droop: [
				[0, 2],
				[0.5, 40],
				[1, 60],
			],
			twist: 0,
			pinnae: {
				count: { mean: 8, spread: 0 },
				length: [
					[0, 0.1],
					[0.4, 0.16],
					[1, 0.03],
				],
				angle: [
					[0, 75],
					[1, 45],
				],
				planes: 1,
				fold: 8,
				droop: 10,
				spines: 0,
			},
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.25, spread: 0.01 },
			outline: {
				width: [
					[0, 0.04],
					[0.3, 0.12],
					[0.7, 0.1],
					[1, 0.01],
				],
				tip: 'acute',
				base: 'cuneate',
			},
			petiole: { length: 0.01, radius: 0.001, flat: 0, droop: 4 },
			fold: 8,
			curl: 6,
			crossCurl: 0,
			twist: 4,
			wave: [0, 0],
			optics: {
				reflectance: [0.05, 0.11, 0.03],
				reflectanceBack: [0.16, 0.22, 0.14],
				transmittance: [0.12, 0.24, 0.05],
				roughness: [0.55, 0.65],
			},
		},
	},
	bark: {
		zones: [{ layer: 0, by: 'height', from: -1, to: 4, blend: 0.2 }],
		young: 0,
		youngRadius: 0.05,
		girthScale: 1,
		displacement: 0,
		collar: { swell: 0, length: 1, ridge: 0 },
	},
	base: { flare: { amount: 0.4, height: 0.4 } },
	seasons: { default: 'summer', deciduous: false, winter: 'evergreen' },
	wind: {
		stiffness: [
			[0, 1],
			[1, 0.2],
		],
		sway: { frequency: 0.4, amplitude: 0.05 },
		flutter: { kind: 'leaflet', amplitude: 0.2, frequency: 2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [100, 20, 100],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 200_000, medium: 200_000, high: 200_000, ultra: 200_000 },
			variantBytes: { low: 500_000, medium: 500_000, high: 500_000, ultra: 500_000 },
			lod0Triangles: 200_000,
			lod1Triangles: 40_000,
			lod2Triangles: 10_000,
			downloadBytes: 100_000,
			downloadHalfBytes: 100_000,
			growMilliseconds: 100,
		},
	},
	textures: 'own',
	variants: 2,
	seedSalt: 0x74657374,
};
