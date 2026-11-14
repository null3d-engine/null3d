// A bracken test record for the frond-colony grower and the frond builder: a free-standing stand of
// separate fronds, each on its own bare stipe about as long as its blade, black at the soil, the
// broad triangular bipinnate blade bent out near level, the lowest pinna pair longest. The numbers
// are read from the reference set's whole-colony, profile and single-frond pictures (01-b, 02-b,
// 12-b, 21) and its fact sheet; the species package refines them against its textures.
import type { Species } from '../core/record';

/** The bracken test record. */
export const brackenRecord: Species = {
	id: 'bracken',
	name: 'Bracken',
	latin: 'Pteridium aquilinum',
	form: 'colony of separate fronds on bare stipes from buried rhizomes',
	size: { height: { mean: 1.1, spread: 0.3 }, aspect: 1.8 },
	growth: {
		model: 'frond-colony',
		fronds: { mean: 16, spread: 4 },
		rhizome: { length: 1, branches: { mean: 3, spread: 1 }, spacing: { mean: 0.28, spread: 0.08 } },
		stipe: { length: { mean: 0.85, spread: 0.25 }, lean: { mean: 6, spread: 5 } },
		frond: {
			kind: 'bipinnate',
			length: { mean: 0.66, spread: 0.14 },
			petiole: { length: 0, width: 0.009, teeth: 0 },
			droop: [
				[0, 0],
				[0.12, 52],
				[0.4, 80],
				[1, 102],
			],
			twist: 8,
			pinnae: {
				count: 12,
				length: [
					[0, 0.55],
					[0.15, 0.5],
					[0.6, 0.27],
					[1, 0.04],
				],
				angle: [
					[0, 78],
					[0.5, 62],
					[1, 50],
				],
				planes: 1,
				fold: 14,
				droop: 28,
				spines: 0,
				sub: {
					count: 18,
					length: [
						[0, 0.12],
						[1, 0.03],
					],
					angle: 72,
					planes: 1,
					fold: 8,
					droop: 10,
					spines: 0,
				},
			},
		},
		croziers: { mean: 1.5, spread: 1 },
	},
	foliage: {
		kind: 'frond',
		optics: {
			reflectance: [0.09, 0.2, 0.05],
			reflectanceBack: [0.13, 0.25, 0.08],
			transmittance: [0.1, 0.24, 0.04],
			roughness: [0.55, 0.65],
		},
	},
	bark: {
		zones: [
			{ layer: 0, by: 'height', from: -1, to: 0.07, blend: 0.06, tint: [0.03, 0.025, 0.02] },
			{ layer: 1, by: 'height', from: 0.07, to: 4, blend: 0.06 },
		],
		young: 0,
		youngRadius: 0,
		girthScale: 1,
		displacement: 0,
		collar: { swell: 0, length: 1, ridge: 0 },
	},
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'marcescent',
		autumn: { reflectance: [0.3, 0.14, 0.04], transmittance: [0.35, 0.15, 0.03] },
	},
	wind: {
		stiffness: [
			[0, 0.6],
			[1, 0.2],
		],
		sway: { frequency: 0.6, amplitude: 0.08 },
		flutter: { kind: 'leaflet', amplitude: 0.2, frequency: 4 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [40, 16, 120],
		woodOrders: [1, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 1_000_000, medium: 1_000_000, high: 1_000_000, ultra: 1_000_000 },
			variantBytes: { low: 1_500_000, medium: 1_500_000, high: 1_500_000, ultra: 1_500_000 },
			lod0Triangles: 200_000,
			lod1Triangles: 30_000,
			lod2Triangles: 8_000,
			downloadBytes: 350_000,
			downloadHalfBytes: 120_000,
			growMilliseconds: 150,
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x6272616b,
};
