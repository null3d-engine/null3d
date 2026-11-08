// The pendulous sedge: a dense wide tussock of broad keeled leaves rising from one crown of brown
// sheaths, under slender three-angled flowering stems that bow over and hang long narrow spikes one
// below another along their upper part, with one brown male spike at the tip. A sedge is a grass-like
// plant, so its "trunk" is the bundle of leaf sheaths and its "bark" is the sheath surface; the
// leaves stand in three ranks from every shoot, and the solid three-angled stem tells it from a grass.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts). The leaves, shoots, sheaths and spikes come from the stills of the
// whole tuft, the basal crown, one shoot, the leaf faces, the stem's cut end and the studio pieces.
// The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** The pendulous sedge's record. */
export const record: Species = {
	id: 'sedge',
	name: 'Pendulous sedge',
	latin: 'Carex pendula',
	form: 'wide fountain of broad keeled leaves under tall bowed stems with hanging spikes',
	// Stills 01, 02 and 18 span about one and a half leaf-mound widths for the plant's height to the
	// top of the bowed stems; the fit measures 1.42 over the turn.
	size: { height: { mean: 1.45, spread: 0.18 }, aspect },
	growth: {
		model: 'tuft',
		// Still 04's overhead view and still 07's crown show a dense tussock of many shoots.
		shoots: { mean: 46, spread: 6 },
		// Still 07 and 09: the shoots rise from one short thick crown, a little over 20 cm across.
		base: 0.11,
		// Still 02: the outer shoots lean away from the crown while the middle ones stand upright.
		lean: [
			[0, 2],
			[1, 20],
		],
		// Still 11: one shoot carries six or seven blades.
		blades: { mean: 6, spread: 1 },
		// Stills 08 and 23: a sedge's leaves leave their shoot in three ranks.
		ranks: 3,
		// Still 07: the brown sheaths stand 8 to 12 cm under the lowest blades.
		sheath: { mean: 0.05, spread: 0.012 },
		// Still 07: each shoot's sheath bundle is about 1.5 cm across.
		sheathRadius: 0.008,
		// Still 02: the youngest blades stand nearly upright and the oldest arch out and over.
		spread: [
			[0, 3],
			[0.5, 18],
			[1, 32],
		],
		// Still 11: the innermost young blade is shorter than the outer ones.
		size: [
			[0, 0.55],
			[0.35, 0.95],
			[1, 1],
		],
		heads: {
			// Stills 01 and 02: a big tussock rises about eighteen flowering stems.
			count: { mean: 18, spread: 4 },
			kind: 'spike',
			// Still 17: the stems stand about 30 cm above the leaf mound at their highest point.
			height: { mean: 1.8, spread: 0.2 },
			// Still 16: the solid three-angled stem is about 5 mm across.
			radius: 0.0026,
			sides: 3,
			// Still 02: each stem bows over through a quarter turn at the top.
			bow: { mean: 95, spread: 15 },
			// Stills 19 and 20: the spikes stand in flower through summer and stay brown into winter.
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			spikes: {
				// Still 19: four or five female spikes hang one below another.
				count: { mean: 4, spread: 0.8 },
				// Still 19: 7 to 16 cm between spikes along the bowed upper stem.
				spacing: { mean: 0.11, spread: 0.02 },
				// Still 19: the spikes hang on short stalks of 2 to 5 cm.
				stalk: { mean: 0.035, spread: 0.01 },
			},
		},
	},
	envelope,
	foliage: {
		kind: 'grass-blade',
		blade: {
			// The fact sheet's 0.5 to 1 m blade, as stills 11 and 21 show it.
			length: { mean: 0.92, spread: 0.08 },
			// The fact sheet's 1.5 to 2 cm width.
			width: 0.018,
			// Still 12: the blade is widest in its lower third and narrows toward the long tip.
			profile: [
				[0, 0.5],
				[0.1, 0.95],
				[0.5, 1],
				[0.85, 0.75],
				[1, 0.45],
			],
			// Still 12: the blade ends in a long fine point.
			tip: 'pointed',
			tipLength: 0.28,
			// Still 16: the blade is a keeled V across its width.
			fold: 24,
			// Still 12: the upper face twists part way along the blade.
			twist: 35,
			// Still 02: each blade arches from upright to hanging at its tip.
			arch: { mean: 95, spread: 15 },
			// Still 10: a few tips brown at the edge of the tuft.
			dryTip: 0.05,
			optics: {
				// Still 12's glossy yellow-green upper face.
				reflectance: [0.1, 0.21, 0.035],
				// Still 13's matt glaucous blue-green underside.
				reflectanceBack: [0.14, 0.2, 0.15],
				transmittance: [0.07, 0.15, 0.03],
				roughness: [0.3, 0.7],
			},
		},
	},
	extras: [
		{
			// Still 19: the long green female spikes hang on their stalks in flower and summer.
			kind: 'catkin',
			at: 'flower',
			share: 1,
			seasons: ['blossom', 'summer'],
			shape: { catkin: { length: 0.12, radius: 0.0025 } },
			colour: [0.13, 0.2, 0.06],
			hang: 180,
		},
		{
			// The fact sheet: the spikes stay on the plant brown through autumn and winter.
			kind: 'catkin',
			at: 'flower',
			share: 1,
			seasons: ['autumn', 'winter'],
			shape: { catkin: { length: 0.12, radius: 0.0025 } },
			colour: [0.17, 0.11, 0.05],
			hang: 180,
		},
		{
			// Still 19: one short brown male spike at the stem's tip.
			kind: 'spike',
			at: 'stem-tip',
			share: 1,
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			shape: { catkin: { length: 0.04, radius: 0.0022 } },
			colour: [0.23, 0.14, 0.07],
			hang: 0,
		},
	],
	seasons: {
		// The reference set shows the plant in summer, in flower.
		default: 'summer',
		// The fact sheet: a sedge keeps its green leaves through the winter.
		deciduous: false,
		winter: 'evergreen',
	},
	wind: {
		// The wind clip: the leaves and bowed stems sway while the crown stays still.
		stiffness: [
			[0, 0.85],
			[1, 0.15],
		],
		sway: { frequency: 0.5, amplitude: 0.06 },
		flutter: { kind: 'grass', amplitude: 0.22, frequency: 2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The measured kit and variant figures, with room above them under the ground plants' caps.
			kitBytes: { low: 1_200_000, medium: 1_200_000, high: 1_200_000, ultra: 1_200_000 },
			variantBytes: { low: 700_000, medium: 750_000, high: 800_000, ultra: 1_000_000 },
			lod0Triangles: 200_000,
			lod1Triangles: 30_000,
			lod2Triangles: 8_000,
			downloadBytes: 350_000,
			downloadHalfBytes: 120_000,
			growMilliseconds: 150,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 0x5ed6e,
	roundBand,
	cuttings: {
		// Stills 21 and 22: one shoot lifted with its leaves.
		branch: { order: 1, length: 1 },
		subbranch: { order: 1, length: 0.4 },
	},
};
