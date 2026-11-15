// The hosta: a clump of broad, deeply ribbed leaves rising from one crown at the soil. Each leaf is
// carried on a long channelled stalk that leaves the crown near upright and arches out and down, so
// the plant reads as a low mound about one and three-quarter times as wide as it is tall, widest
// below its middle and closing to a point at its top. The youngest leaves stand upright and still rolled at
// the heart of each shoot. The blade is heart-shaped at the base and short-pointed, with the veins
// standing proud as pleats of green rather than as a marking on a flat surface.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth curves are fitted to the same turntable and to the
// rosette's studio stills; the leaf from the texture sources and the single-leaf stills; the flower
// from the flower stills. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** The hosta's record. */
export const record: Species = {
	id: 'hosta',
	name: 'Hosta',
	latin: 'Hosta ventricosa',
	form: 'low mound of broad ribbed leaves on long stalks from one crown',
	size: { height: { mean: 0.55, spread: 0.05 }, aspect },
	growth: {
		model: 'rosette',
		// Still 04 from above: the crown has divided into several eyes, each a golden-angle spiral
		// of leaves, the outermost of each eye its oldest and lowest. About forty leaves show from
		// above, and still 17's dome is closed to the soil, so the plant carries about a hundred and
		// twenty: nine eyes of twelve, where six of nine drew half the photograph's leaves and the
		// stalks showing in the middle.
		shoots: { mean: 9, spread: 1 },
		crown: 0.04,
		leaves: { mean: 12, spread: 1 },
		divergence: 137.5,
		// Still 21: the youngest leaves stand nearly upright at the shoot's heart, the oldest lean
		// out over the mound.
		tilt: [
			[0, 4],
			[0.4, 20],
			[0.8, 40],
			[1, 58],
		],
		// Still 02: a stalk leaves upright, then arches out and down, the oldest bending furthest.
		// Still 17: the stalks of the middle and outer leaves arch well over into the dome.
		arch: [
			[0, 3],
			[0.5, 18],
			[1, 36],
		],
		// Still 22: the stalks are long against the blade, the oldest nearly as long as the leaf.
		stalk: [
			[0, 0.26],
			[0.4, 0.36],
			[1, 0.28],
		],
		// Stills 02 and 23: a young centre-leaf is about three fifths the size of the oldest.
		size: [
			[0, 0.6],
			[0.3, 0.95],
			[1, 1],
		],
		// Still 02: the blade turns down from its stalk's line, the oldest hanging furthest. Still
		// 17: only the youngest open leaves point up at the heart; from middle age the blades hang
		// tips down in layers under the dome, the oldest about sixty degrees below level, where
		// lesser figures held the middle leaves level like plates.
		pitch: [
			[0, 12],
			[0.4, 55],
			[1, 62],
		],
		// Still 23: about a sixth of a shoot's leaves are still rolled at the crown's heart.
		rolled: 0.17,
		// Still 20: in autumn the leaves collapse toward the ground and brown.
		collapse: 35,
		// Still 18: bare scapes rise above the leaves in mid to late summer, carrying a one-sided
		// row of nodding flowers over the top third.
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
	envelope,
	foliage: {
		kind: 'thick',
		leaf: {
			// The fact sheet: a blade 20 to 30 cm long, widest below its middle (still 11).
			length: { mean: 0.25, spread: 0.03 },
			outline: 'texture',
			// Stills 08 and 09: eight to ten pairs of veins, sunk into the blade, between them the
			// blade puffs up, the innermost pair leaving the midrib past its middle.
			ribs: { count: 8, depth: 0.32, start: 0.55, sweep: 0.3 },
			// Still 11: the two halves rise from the midrib into a shallow cup.
			cup: 22,
			// Still 02: the blade curls toward its lower face along its length.
			curl: 30,
			// Still 10: the margin is entire and a little wavy.
			wave: [0.003, 2.5],
			// Still 14: the stalk is a crescent with a groove on its upper face.
			stalk: { radius: 0.0055, channel: 0.45 },
			optics: {
				// Stills 11 and 24: the upper face's measured colour, bright and slightly glossy;
				// stills 12 and 25: the lower face's, paler and matt.
				reflectance: [0.0813, 0.1883, 0.0174],
				reflectanceBack: [0.3376, 0.4265, 0.1436],
				transmittance: [0.08, 0.2, 0.02],
				roughness: [0.35, 0.6],
			},
		},
	},
	extras: [
		{
			// Still 19: narrow funnels of six pale lilac petals hanging on one side of the scape.
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
		// Still 20: the collapsed leaves turn butter yellow, some to papery brown.
		autumn: { reflectance: [0.76, 0.5, 0.1], transmittance: [0.8, 0.54, 0.08] },
		blossom: { extra: 0, leaves: 1 },
	},
	wind: {
		// The wind clip: the blades lift and bounce on their stalks while the crown stays still.
		stiffness: [
			[0, 0.99],
			[1, 0.93],
		],
		sway: { frequency: 0.9, amplitude: 0.004 },
		flutter: { kind: 'blade', amplitude: 0.006, frequency: 0.8 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// Measured over the four variants at seed 11, in summer and in blossom, with the nine
			// eyes of twelve leaves of stills 04 and 17: the kit reads 39,504, 63,172, 61,648 and
			// 80,200 bytes at the four tiers; the largest variant 1,068,630, 2,724,037, 2,614,396
			// and 3,924,478; its nearest level 23,260, 118,124, 111,348 and 187,336 triangles, the
			// last under the ground class's 200,000 by the ultra tier's own leaf grid; and the card
			// levels 18,278 and 5,302. Each cap keeps a twentieth above its read, the nearest level's
			// above the ultra tier's, as the lead ruled.
			kitBytes: { low: 41_480, medium: 66_340, high: 64_740, ultra: 84_210 },
			variantBytes: { low: 1_122_070, medium: 2_860_240, high: 2_745_120, ultra: 4_120_710 },
			lod0Triangles: 196_710,
			lod1Triangles: 19_200,
			lod2Triangles: 5_570,
			downloadBytes: 350_000,
			downloadHalfBytes: 120_000,
			growMilliseconds: 150,
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x4057a,
	roundBand,
	cuttings: {
		// Stills 21 to 23: a lifted piece is one eye of the crown, and the photographs show six or
		// seven leaves on it, against the twelve each eye of the crown carries.
		leaves: { mean: 8, spread: 1 },
		// Still 21: one eye lifted from the crown, its leaves on their long stalks, its blades a
		// seventh smaller than the crown's so the piece's gaps match the photograph's.
		branch: { order: 1, length: 0.62, scale: 0.85 },
		// Still 22: a shorter shoot on a piece of crown, a few leaves on it.
		subbranch: { order: 1, length: 0.4 },
		// Stills 11 and 12: one leaf laid flat as its picture lays it, on a short piece of stalk.
		leaf: { pressed: true, petiole: 0.04 },
	},
	forms: {
		young: {
			// Still 16: a small open ring of leaves on short stalks, the soil showing between them.
			form: 'young hosta: an open upright ring of leaves on short stalks, the soil between them',
			size: { height: { mean: 0.22, spread: 0.03 }, aspect: 1.6 },
			growth: {
				shoots: { mean: 2, spread: 1 },
				leaves: { mean: 4, spread: 1 },
				tilt: [
					[0, 6],
					[0.5, 22],
					[1, 34],
				],
				arch: [
					[0, 3],
					[0.5, 12],
					[1, 30],
				],
				stalk: [
					[0, 0.06],
					[0.4, 0.14],
					[1, 0.16],
				],
				size: [
					[0, 0.5],
					[0.3, 0.85],
					[1, 1],
				],
			},
			// The young plant is a small open ring, so its crown is a shallow cap rather than a mound.
			envelope: {
				kind: 'radial',
				heights: [0, 0.2, 0.4, 0.6, 0.8, 1],
				radii: [0.55, 0.7, 0.72, 0.62, 0.4, 0],
				source: { method: 'profile', from: '16-young-hosta-plant.png', views: 1 },
			},
			// No turning video shows this form, so the all-round check takes the form's own band.
			roundBand: null,
		},
	},
};
