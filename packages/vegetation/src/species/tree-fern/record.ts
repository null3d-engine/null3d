// The soft tree fern: one stout fibrous trunk under a crown of arching, twice-divided fronds that
// spring from a single growing point, with coiled croziers at the centre and a skirt of dead fronds
// below the living crown. The trunk is a mat of roots and old frond bases, not wood.
//
// The numbers come from the reference set's whole views (01, 02, 17, 18), its crown views (03 to
// 07) and its studio stills (08 to 13, 21 to 23); the textures from slots 24 to 26. The frond is a
// rachis carrying pinnae, each pinna the species' leaf: the reference's leaf texture is one pinna,
// and the frond's second division is painted in that picture.
import type { Species } from '../../core/record';

/** The tree fern's record. */
export const record: Species = {
	id: 'tree-fern',
	name: 'Soft tree fern',
	latin: 'Dicksonia antarctica',
	form: 'single stout fibrous trunk under a crown of arching fronds from one point',
	// Still 01 and the silhouette 18: the crown is about as wide as the plant is tall, the trunk
	// about a seventh of the height across at breast height.
	size: { height: { mean: 3.4, spread: 0.35 }, dbh: 0.5, aspect: 1.05 },
	growth: {
		model: 'crown-rosette',
		stem: {
			// Stills 17 and 18: the trunk is about two thirds of the plant's height.
			height: { mean: 2.35, spread: 0.25 },
			// Still 17: the column runs nearly parallel-sided, a little narrower at the top.
			radius: [
				[0, 0.29],
				[0.1, 0.27],
				[0.6, 0.26],
				[1, 0.25],
			],
			// Still 01: the trunk stands upright, within a few degrees.
			lean: { mean: 2, spread: 2 },
			curve: { mean: 0, spread: 1.5 },
			surface: 'root-mat',
		},
		crown: {
			// Still 01 and the crown views: a dense living crown of about two dozen fronds.
			fronds: { mean: 25, spread: 2 },
			divergence: 137.5,
			// Still 01: the youngest fronds stand up in the centre and the oldest arch out and down.
			tilt: [
				[0, 14],
				[0.35, 46],
				[0.7, 80],
				[1, 98],
			],
			// Still 16, 17 and 20: the dead fronds hang against the trunk as a brown skirt.
			dead: { count: { mean: 12, spread: 2 }, hang: 80, skirt: 0.75 },
			// Still 06: coiled croziers fill the crown's centre.
			croziers: { mean: 7, spread: 2 },
		},
		frond: {
			// Stills 21 and 22: the frond is twice divided, the pinnae in near-opposite pairs.
			kind: 'bipinnate',
			length: { mean: 2.1, spread: 0.2 },
			// Still 07: a short red-brown stipe, densely hairy, no wider than the rachis.
			petiole: { length: 0.28, width: 0.055, teeth: 0 },
			// Still 21: the blade rises from the stipe and arches over, its tip drooping.
			droop: [
				[0, 3],
				[0.3, 24],
				[0.7, 40],
				[1, 54],
			],
			twist: 4,
			pinnae: {
				// Stills 08 to 11: about twenty-five pairs a side, longest near the middle of the blade.
				count: { mean: 26, spread: 2 },
				// Pinna length over the frond's length, by position along the rachis.
				length: [
					[0, 0.09],
					[0.15, 0.16],
					[0.4, 0.21],
					[0.8, 0.15],
					[1, 0.05],
				],
				angle: [
					[0, 80],
					[0.5, 72],
					[1, 50],
				],
				planes: 1,
				fold: 10,
				droop: 14,
				spines: 0,
			},
		},
	},
	foliage: {
		// The leaf is one pinna: the reference's texture source holds a whole pinna, with its
		// pinnules and lobes painted in.
		kind: 'blade',
		leaf: {
			length: { mean: 0.36, spread: 0.03 },
			outline: 'texture',
			petiole: { length: 0.012, radius: 0.0012, flat: 0, droop: 4 },
			fold: 8,
			curl: 6,
			crossCurl: 0,
			twist: 4,
			wave: [0.002, 3],
			optics: {
				reflectance: [0.055, 0.115, 0.028],
				reflectanceBack: [0.16, 0.22, 0.14],
				transmittance: [0.12, 0.24, 0.05],
				roughness: [0.55, 0.65],
			},
		},
	},
	bark: {
		// Stills 15 and 26: the whole trunk is packed roots and cut frond bases, one surface.
		zones: [{ layer: 0, by: 'height', from: -1, to: 4, blend: 0.2, tint: [1.45, 1.35, 1.3] }],
		young: 0,
		// The stipes, rachises and pinna midribs take the fine tile, so they read as hairy brown
		// stalks rather than as the trunk's coarse mat.
		youngRadius: 0.06,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		// The stumps of old frond bases stand a little proud of the root mat.
		displacement: 0.02,
		collar: { swell: 0, length: 1, ridge: 0 },
	},
	base: {
		// Stills 14 and 17: the foot flares into a low mound of roots over the litter.
		flare: { amount: 0.45, height: 0.35 },
	},
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		// The dead fronds' brown, which the foliage's browning mixes toward.
		autumn: { reflectance: [0.17, 0.09, 0.035], transmittance: [0.21, 0.12, 0.05] },
	},
	wind: {
		// The trunk stands rigid; the fronds swing from their stipes.
		stiffness: [
			[0, 1],
			[0.45, 0.5],
			[1, 0.18],
		],
		sway: { frequency: 0.35, amplitude: 0.05 },
		flutter: { kind: 'leaflet', amplitude: 0.25, frequency: 2.5 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [200, 30, 120],
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit holds one pinna at each tier; the crown's thousand pinnae are the variant's.
			kitBytes: { low: 40_000, medium: 50_000, high: 60_000, ultra: 70_000 },
			variantBytes: { low: 900_000, medium: 3_120_000, high: 3_120_000, ultra: 3_180_000 },
			lod0Triangles: 220_000,
			lod1Triangles: 12_000,
			lod2Triangles: 6_000,
			downloadBytes: 900_000,
			downloadHalfBytes: 300_000,
			growMilliseconds: 80,
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x7466726e,
	roundBand: 0.25,
	cuttings: {
		// Still 21: one whole frond, a stipe and its blade.
		branch: { order: 1, length: 2.4 },
		// Still 22: one pinna of the frond, about a third of a metre.
		subbranch: { order: 3, length: 0.33 },
		// Stills 12, 13 and 24: the pinna laid flat on its own.
		leaf: { pressed: true },
	},
};
