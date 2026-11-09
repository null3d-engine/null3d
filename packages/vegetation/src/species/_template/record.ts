// The record to copy for a new species: a small round-crowned broadleaf grown by the
// self-organizing model. Copy this folder to species/<id>/, rename the id, and replace each number
// with the species' own, from its references. The envelope comes from the reference turntable's
// silhouettes, the leaf and bark figures from the texture manifest, and the budget from the
// species' own measured growth. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';

/** The template species' record. */
export const record: Species = {
	id: 'template-species',
	name: 'Template species',
	latin: 'Arbor exemplaris',
	form: 'small round-crowned broadleaf',
	size: { height: { mean: 8, spread: 1 }, dbh: 0.25, aspect: 0.8 },
	growth: {
		model: 'self-organizing',
		years: 12,
		macroOrders: 3,
		internode: { length: 0.5, ageFactor: 0.9 },
		stems: { count: 1, lean: { mean: 2, spread: 2 }, stool: 0, fused: 0 },
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			angle: [
				[0, 45],
				[1, 60],
			],
			angleSpread: 10,
			extinction: [0.02, 0.1],
		},
		apical: {
			control: [
				[0, 0.6],
				[1, 0.45],
			],
			dominance: [1, 0.5, 0.9],
			wander: 5,
		},
		light: { apical: 1.2, lateral: 1.5, shadow: [6, 0.5, 2], cells: 48 },
		tropism: {
			photo: 0.2,
			gravi: [
				[0, 0.3],
				[1, 0.05],
			],
		},
		shedding: { threshold: 0.15, cleanBole: 0.3, stubs: 0.2 },
		bending: { strength: 0.3, upturn: 0.2 },
		pipe: { exponent: 2.5, tipRadius: 0.004 },
	},
	envelope: {
		kind: 'radial',
		heights: [0.3, 0.45, 0.6, 0.75, 0.9, 1],
		radii: [0.2, 0.38, 0.42, 0.38, 0.25, 0.02],
		source: { method: 'hand', from: 'none: the template draws no reference' },
	},
	shoots: {
		prototypes: 6,
		classes: [
			{
				name: 'long',
				vigor: [0.5, 1],
				share: 0.5,
				length: { mean: 0.35, spread: 0.08 },
				nodes: { mean: 6, spread: 1 },
				internode: 1,
				leafScale: [
					[0, 0.7],
					[0.6, 1],
					[1, 0.8],
				],
				leafAngle: 50,
				droop: 5,
			},
			{
				name: 'short',
				vigor: [0, 0.5],
				share: 0.5,
				length: { mean: 0.12, spread: 0.03 },
				nodes: { mean: 4, spread: 1 },
				internode: 1,
				leafScale: 0.9,
				leafAngle: 55,
				droop: 0,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 137.5 },
		orders: 1,
		years: 2,
		leafYears: 1,
		stem: { radius: [0.003, 0.0015], zigzag: 0 },
		bud: { length: 0.006, width: 0.003, tipCluster: 1 },
		placement: {
			perMetre: 6,
			shadePrune: 0.1,
			tipPrune: 0.05,
			skyward: 0.3,
			scale: { mean: 1, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			length: { mean: 0.08, spread: 0.015 },
			outline: { width: 0.3, tip: 'acute', base: 'rounded' },
			petiole: { length: 0.02, radius: 0.001, flat: 0, droop: 10 },
			fold: 10,
			curl: 10,
			crossCurl: 0,
			twist: 5,
			wave: [0, 0],
			optics: {
				reflectance: [0.06, 0.12, 0.03],
				reflectanceBack: [0.09, 0.15, 0.05],
				transmittance: [0.08, 0.16, 0.02],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		zones: [{ layer: 0, by: 'height', from: 0, to: 20, blend: 0 }],
		young: 0,
		youngRadius: 0.02,
		girthScale: 1,
		displacement: 0.01,
		collar: { swell: 0.15, length: 1.5, ridge: 0.5 },
	},
	seasons: { default: 'summer', deciduous: true, winter: 'bare' },
	wind: {
		stiffness: [
			[0, 0.9],
			[1, 0.2],
		],
		sway: { frequency: 0.4, amplitude: 0.05 },
		flutter: { kind: 'blade', amplitude: 0.3, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [24, 12, 160],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 2_000_000, medium: 2_000_000, high: 2_000_000, ultra: 2_000_000 },
			variantBytes: { low: 1_500_000, medium: 1_500_000, high: 1_500_000, ultra: 1_500_000 },
			lod0Triangles: 800_000,
			lod1Triangles: 60_000,
			lod2Triangles: 15_000,
			downloadBytes: 800_000,
			downloadHalfBytes: 300_000,
			growMilliseconds: 400,
		},
	},
	textures: 'own',
	variants: 3,
	seedSalt: 0x7e3a1,
};
