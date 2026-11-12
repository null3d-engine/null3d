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
		shoots: { mean: 170, spread: 14 },
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
		// Still 07: the brown sheaths stand about 10 to 13 cm under the lowest blades.
		sheath: { mean: 0.06, spread: 0.012 },
		// Still 07: each shoot's sheath bundle is about 1.5 cm across.
		sheathRadius: 0.008,
		// Stills 07, 08 and 14: the sheaths are red-brown at the crown's foot and paler where the
		// blades leave. The ends are the 07 carrier's measured bands as linear reflectance: foot
		// Lab (44.0, 8.5, 15.1), collar Lab (42.1, 11.2, 17.9), the collar taking over at its top.
		sheathColour: { foot: [0.21, 0.123, 0.079], collar: [0.21, 0.107, 0.062], reach: 0.85 },
		// Stills 07, 08 and 14: the basal sheaths are red-brown, and the leaf's own sheath reads a
		// paler straw-brown, so the sheath draws a warm brown between the two. The colour belongs
		// to the shoot's sheath column, so it moves the basal-crown pictures (07 and 14) from green
		// toward the photographs' brown and leaves a picture that frames the leaf's own sheath at
		// its collar, or the stem, where it is; the row 8 colour differences fall toward 3 only
		// where the shoot's column stands in frame.
		// Still 02: the youngest blades stand nearly upright and the oldest arch out and over.
		spread: [
			[0, 2],
			[0.5, 14],
			[1, 26],
		],
		// Still 11: the innermost young blade is shorter than the outer ones.
		size: [
			[0, 0.55],
			[0.35, 0.95],
			[1, 1],
		],
		heads: {
			// Stills 01 and 02: a big tussock rises about twenty-two flowering stems.
			count: { mean: 22, spread: 4 },

			kind: 'spike',
			// Still 17: the stems stand about 30 cm above the leaf mound at their highest point.
			height: { mean: 1.6, spread: 0.18 },
			// Still 16: the solid three-angled stem; the photographs' stems read a centimetre to a
			// centimetre and a half across, and a thinner one falls under a pixel at the far view.
			radius: 0.007,
			sides: 3,
			// Still 02: each stem bows over through a quarter turn at the top.
			bow: { mean: 100, spread: 15 },
			// Still 19: the photographs' spike stalks read a few millimetres; at a pixel's width they
			// drop from the silhouette's matte, so the spikes stand apart from their stems.
			stalkShare: 0.6,
			// Stills 19 and 20: the spikes stand in flower through summer and stay brown into winter.
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			spikes: {
				// Still 19: four or five female spikes hang one below another.
				count: { mean: 4, spread: 0.8 },
				// Still 19: the spikes hang in a drooping cluster near the stem's tip.
				spacing: { mean: 0.045, spread: 0.01 },
				// Still 19: the spikes hang on short stalks of 2 to 5 cm.
				stalk: { mean: 0.04, spread: 0.008 },
			},
		},
		soil: {
			// Still 09: a short stout rhizome runs either side of the crown, about 8 cm in all.
			rhizome: { mean: 0.04, spread: 0.01 },
			// Still 09: the rhizome reads 2 to 2.5 cm thick.
			rhizomeRadius: 0.011,
			// Still 14: dense brown roots, about fifteen of them, spread round the crown.
			// Still 14 and the lifted studio piece: a dense brown root ball, not a sparse fringe.
			roots: { mean: 32, spread: 5 },
			rootLength: { mean: 0.18, spread: 0.05 },
			rootRadius: 0.0045,
			// Still 14: the roots dip below the rhizome as they leave it.
			droop: { mean: 40, spread: 15 },
		},
	},
	envelope,
	foliage: {
		kind: 'grass-blade',
		blade: {
			// The fact sheet's 0.5 to 1 m blade, as stills 11 and 21 show it.
			length: { mean: 1, spread: 0.08 },
			// The fact sheet's 1.5 to 2 cm width, at its upper end.
			width: 0.02,
			// Still 12: the blade is widest in its lower third and narrows toward the long tip.
			profile: [
				[0, 0.7],
				[0.1, 1],
				[0.7, 0.95],
				[1, 0.5],
			],
			// Stills 10 and 12: the blade ends in a fine point whose taper runs about four times the
			// blade's width, so a metre of blade closes over a short last share of it.
			tip: 'pointed',
			tipLength: 0.08,
			// Stills 08 and 12: the blade is a deep keeled V across its width.
			fold: 40,
			// Still 12: the upper face twists part way along the blade.
			twist: 60,
			// Still 02: each blade arches from upright to hanging at its tip.
			arch: { mean: 70, spread: 15 },
			// Still 10: a few tips brown at the edge of the tuft.
			dryTip: 0.05,
			// Stills 08 and 15: a pale line marks the collar where the blade leaves its sheath, in
			// the lower fiftieth of the blade. It should move the leaf-base pictures 08 and 15 and
			// the pressed leaves' bases toward the photographs, and leave the whole views nearly
			// where they are.
			collar: { colour: [0.4, 0.4, 0.32], share: 0.02 },
			// Stills 08 and 15: a pale papery ligule stands in the V where the blade leaves its
			// sheath, about a centimetre and a half long, in the collar's colour. It draws at the near
			// detail only; it should move the leaf-base
			// pictures 08 and 15 toward the photographs.
			ligule: {
				length: { mean: 0.015, spread: 0.004 },
				width: 0.008,
				share: 0.4,
			},
			optics: {
				// The upper face's linear colour, read from stills 12 and 24 through the copy stand's
				// measured light: a deep green at the photograph's own luminance.
				reflectance: [0.042, 0.076, 0.006],
				// The underside's linear colour, read the same way from stills 13 and 25: the render's
				// remaining difference is its missing blue, so the value takes the photographs' own
				// measured ratio on that face.
				reflectanceBack: [0.083, 0.114, 0.133],
				transmittance: [0.04, 0.077, 0.01],
				roughness: [0.45, 0.7],
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
			// Still 19: each spike is a dense cluster of short spikelets, so its silhouette carries
			// the rows' swellings rather than a smooth pendant. The photograph's heads run about a
			// third of the visible stem, so the body is longer than a catkin and its rows follow.
			shape: { catkin: { length: 0.17, radius: 0.0036, spikelets: { count: 12, bulge: 0.28 } } },
			colour: [0.13, 0.2, 0.06],
			// The body keeps its stalk's outward droop rather than being forced straight down, so
			// the heads splay as the photographs show them.
			hang: 5,
		},
		{
			// The fact sheet: the spikes stay on the plant brown through autumn and winter.
			kind: 'catkin',
			at: 'flower',
			share: 1,
			seasons: ['autumn', 'winter'],
			shape: { catkin: { length: 0.17, radius: 0.0036, spikelets: { count: 12, bulge: 0.28 } } },
			colour: [0.17, 0.11, 0.05],
			hang: 5,
		},
		{
			// Still 19: one short brown male spike at the stem's tip.
			kind: 'spike',
			at: 'stem-tip',
			share: 1,
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			shape: { catkin: { length: 0.03, radius: 0.0018, spikelets: { count: 4, bulge: 0.15 } } },
			colour: [0.19, 0.11, 0.05],
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
		// The clip's upper three bands over-move (0.350, 0.481, 0.496 against 0.164, 0.299, 0.392)
		// while the lower three hold, so the bowed upper stems stiffen toward the top.
		stiffness: [
			[0, 0.9],
			[1, 0.85],
		],
		sway: { frequency: 0.5, amplitude: 0.03 },
		flutter: { kind: 'grass', amplitude: 0.06, frequency: 2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The owner's ruling of 12 November 2026: the sedge keeps its spikelet rows, its ligule and
			// its 170 shoots, and its caps are raised to what the newer grower costs rather than the
			// plant being cut. Measured at seed 11, variant 0, high detail it draws 3,042,793 variant
			// bytes and 35,843 and 19,505 triangles at the two card levels; the caps take a stated
			// margin above each. The medium, low and ultra byte caps were measured before the newer
			// grower; the read below re-records them. The kit holds 33 to 37 KB.
			kitBytes: { low: 100_000, medium: 100_000, high: 100_000, ultra: 100_000 },
			// The owner's 12 November 2026 ruling, after the standing authority: the sedge draws the
			// photographs' twenty-two flowering stems, measured at 3,375,625 variant bytes and
			// 78,833, 40,987 and 23,409 triangles, and the caps take a stated margin above each.
			// 13 November 2026: the caps govern every variant the species shows, all six at seed 11,
			// not one drawn variant. The largest is variant 3, which reads 3,327,959, 3,658,322,
			// 4,099,334 and 5,611,850 bytes at the four tiers (old caps 1,673,928, 2,300,000,
			// 3,600,000 and 3,800,000), so each new cap keeps the class's 15 per cent spare at
			// 3,830,000, 4,210,000, 4,710,000 and 6,450,000. The far tier was coarsened so that same
			// variant clears the 25,000-triangle second card level: its extras draw three faces rather
			// than four, and a flower stalk two rings rather than four. The stalks add 618 triangles
			// there (1,854 at the old ring count), and the level reads 24,317 against the cap, 29,811
			// before the stalks joined it and 31,665 with them at the old cost. That variant's three
			// levels read 98,819, 51,409 and 24,317 at the high tier against 140,000, 80,000 and
			// 25,000.
			// The same calibration's merged scale gives the high tier a read of 3,227,419 variant
			// bytes, which the lead line re-recorded from 3,100,000 to 3,300,000. It is a byte read,
			// not a triangle one, and it sits inside the every-variant cap above; the near band's
			// triangle cap stays lod0Triangles at 140,000 against a read of 83,326.
			variantBytes: { low: 3_830_000, medium: 4_210_000, high: 4_710_000, ultra: 6_450_000 },
			lod0Triangles: 140_000,
			lod1Triangles: 80_000,
			lod2Triangles: 25_000,
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
		// Stills 21 and 22: the whole young plant lifted with its leaves, sheath and roots.
		branch: { order: 0, length: 1 },
		subbranch: { order: 1, length: 0.4 },
		// Stills 12, 13, 24 and 25: a picked blade lies on the copy stand, so its fold and twist
		// straighten and the pictures show the blade's own width rather than its edge-on projection.
		// Stills 12 and 13 measure a young blade: about 0.2 m long at the record's 2 cm width, an
		// aspect of 0.1 where the mature metre-long blade stands at 0.02. The piece draws that
		// length with the width unchanged.
		leaf: { pressed: true, length: 0.2 },
	},
};
