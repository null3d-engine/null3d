// The date palm: one stout column crowned by a spiral of pinnate fronds, with a skirt of dead
// fronds below the living ones and a ring of offshoots at the foot. The trunk is a diamond lattice
// of cut leaf bases; the leaflets are long, narrow, V-folded and grey-green; the dates hang in
// heavy bunches among the lower fronds.
//
// The record is plain data: no code runs in it. The whole-plant stills give the proportions (a
// trunk about two thirds of the height, a crown about three quarters as wide as tall, a sky gap
// near a fifth); the crown's own box spread sets the all-round band. The leaflet figures come from
// the leaf pictures and the texture sources, the bark from the trunk pictures, and the fronds'
// numbers from the frond and leaf-cluster stills.
import type { Species } from '../../core/record';
import { roundBand } from './fit';
import { forms } from './forms';

/** The date palm's record. */
export const record: Species = {
	id: 'date-palm',
	name: 'Date palm',
	latin: 'Phoenix dactylifera',
	form: 'one stout column crowned by arching pinnate fronds, with basal offshoots',
	size: { height: { mean: 20, spread: 1.5 }, dbh: 1.0, aspect: 0.74 },
	growth: {
		model: 'crown-rosette',
		stem: {
			// The whole-plant stills put the frond bases about two thirds of the way up the height,
			// the clear trunk below them.
			height: { mean: 13.4, spread: 1.2 },
			// The trunk is a column that narrows only a little over its height, a little wider at
			// the flared foot: stills 01, 02 and 17.
			radius: [
				[0, 0.66],
				[0.03, 0.58],
				[0.3, 0.52],
				[0.7, 0.47],
				[1, 0.44],
			],
			lean: { mean: 0.5, spread: 0.5 },
			curve: { mean: 0.3, spread: 0.3 },
			// Stills 14 and 18: a ring of young palms grows from the foot.
			suckers: { mean: 2.5, spread: 0.5 },
			surface: 'leaf-bases',
		},
		crown: {
			// About twenty living fronds, in the golden-angle spiral the crown shows from below.
			fronds: { mean: 22, spread: 2 },
			divergence: 137.5,
			// The centre's youngest fronds stand upright, the oldest arch out and hang.
			tilt: [
				[0, 8],
				[0.3, 45],
				[0.65, 82],
				[1, 118],
			],
			// Still 20: a skirt of dead fronds hangs below the crown, over the top of the trunk.
			dead: { count: { mean: 14, spread: 2 }, hang: 126, skirt: 0.35 },
		},
		frond: {
			kind: 'pinnate',
			length: { mean: 6, spread: 0.6 },
			petiole: { length: 0.4, width: 0.1, teeth: 0 },
			// Stills 02, 09 and 21: the rachis leaves the crown near level and arches over, its tip
			// hanging below the middle of the frond.
			droop: [
				[0, 0],
				[0.15, 8],
				[0.45, 22],
				[0.75, 36],
				[1, 46],
			],
			twist: 6,
			pinnae: {
				// Still 09: a hundred leaflets a side, in groups, the longest near the middle of the
				// rachis and shortest at the tip. The count gives the places; each place carries a
				// group, so the frond holds twice this many.
				count: { mean: 50, spread: 4 },
				length: [
					[0, 0.05],
					[0.3, 0.052],
					[0.65, 0.045],
					[1, 0.022],
				],
				angle: [
					[0, 50],
					[0.5, 58],
					[1, 52],
				],
				// Still 09: the leaflets leave the rachis in several planes, not one flat comb.
				planes: 3,
				fold: 32,
				droop: 10,
				// Still 07: the base of the frond carries stiff yellow spines.
				spines: 8,
			},
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Still 12 and the leaflet texture: a long narrow blade a few times longer than wide.
			length: { mean: 0.3, spread: 0.03 },
			outline: 'texture',
			petiole: { length: 0.015, radius: 0.0015, flat: 0, droop: 10 },
			fold: 32,
			curl: 8,
			crossCurl: 0,
			twist: 4,
			wave: [0.002, 4],
			optics: {
				reflectance: [0.1005, 0.1459, 0.0874],
				reflectanceBack: [0.2132, 0.2716, 0.2079],
				transmittance: [0.09, 0.13, 0.06],
				roughness: [0.55, 0.7],
			},
		},
	},
	bark: {
		zones: [
			// Stills 15, 17 and 26: one lattice of cut leaf bases over the whole trunk, warmer than
			// the texture's own grey.
			{ layer: 0, by: 'height', from: 0, to: 40, blend: 0.6, tint: [1.15, 1.15, 1.1] },
		],
		young: 0,
		youngRadius: 0.06,
		girthScale: 1,
		displacement: 0.02,
		// The rachis clasps the stem in a dry sheath, so the join is smooth and barely ridged.
		collar: { swell: 0.15, length: 4, ridge: 0.05 },
	},
	base: {
		// Still 14: the foot flares a little over its own flare and runs out on short roots.
		flare: { amount: 0.18, height: 0.5 },
		roots: {
			count: { mean: 5, spread: 1 },
			length: { mean: 0.7, spread: 0.15 },
			radius: 0.13,
			dive: 0.4,
			ridge: 0.7,
		},
	},
	extras: [
		{
			// Still 19: heavy bunches of oblong dates on long orange stalks that hang among the
			// lower fronds. Each date is widest just above its middle and closes to a small point.
			kind: 'fruit',
			at: 'flower',
			share: 1,
			count: { mean: 14, spread: 3 },
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.002, 0],
					[0.007, 0.004],
					[0.0095, 0.012],
					[0.0095, 0.028],
					[0.0085, 0.04],
					[0.006, 0.05],
					[0.003, 0.058],
					[0.0008, 0.063],
					[0, 0.066],
				],
				sides: 10,
				stalk: 0.35,
				pedicel: 0.02,
				stalkSides: 5,
			},
			colour: [0.42, 0.16, 0.03],
			// The stalk is the orange of the picture's bunch stems.
			stalkColour: [0.5, 0.28, 0.05],
			roughness: [0.45, 0.6],
			hang: 180,
		},
	],
	// The palm keeps its leaves all year, so the season never turns them. The record's autumn
	// colours are the dry straw grey-brown that the shader mixes a browning frond toward: the dead
	// skirt of stills 05 and 20, not a different season's hue.
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		autumn: { reflectance: [0.36, 0.31, 0.22], transmittance: [0.2, 0.17, 0.11] },
	},
	wind: {
		// The trunk stays still while the fronds toss, as the wind clip shows.
		stiffness: [
			[0, 0.98],
			[0.6, 0.92],
			[1, 0.6],
		],
		sway: { frequency: 0.35, amplitude: 0.15 },
		flutter: { kind: 'leaflet', amplitude: 0.1, frequency: 2.2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [220, 50, 260],
		woodOrders: [1, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 0,
		budget: {
			kitBytes: { low: 1_500_000, medium: 1_500_000, high: 1_500_000, ultra: 1_500_000 },
			variantBytes: { low: 4_000_000, medium: 4_000_000, high: 4_000_000, ultra: 4_000_000 },
			lod0Triangles: 550_000,
			lod1Triangles: 60_000,
			lod2Triangles: 15_000,
			downloadBytes: 900_000,
			downloadHalfBytes: 300_000,
			growMilliseconds: 250,
		},
	},
	textures: 'own',
	variants: 3,
	seedSalt: 0x0da7e5a1,
	roundBand,
	forms,
	cuttings: {
		// Still 21: the whole cut frond, spines at its base and leaflets along the rachis.
		branch: { order: 1, length: 6 },
		// Still 22: a length of rachis from the middle of the frond, with its leaflets.
		subbranch: { order: 1, length: 0.5, from: 1.6, span: 0.5 },
		// Still 23: a shorter length of rachis, with the leaflets' own arrangement at close range.
		cluster: { order: 1, length: 0.18, from: 2, span: 0.18 },
		// Stills 12, 13, 24 and 25 lay the leaflet flat on a copy stand.
		leaf: { pressed: true },
	},
};
