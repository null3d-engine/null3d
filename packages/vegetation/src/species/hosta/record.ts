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
		// of leaves, the outermost of each eye its oldest and lowest.
		shoots: { mean: 6, spread: 1 },
		crown: 0.04,
		leaves: { mean: 9, spread: 1 },
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
		arch: [
			[0, 2],
			[0.5, 10],
			[1, 30],
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
		// Still 02: the blade turns down from its stalk's line, the oldest hanging furthest.
		pitch: [
			[0, 10],
			[0.5, 38],
			[1, 56],
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
			// Still 11: a blade near its largest size, widest below its middle.
			length: { mean: 0.32, spread: 0.03 },
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
			kitBytes: { low: 40_000, medium: 65_000, high: 65_000, ultra: 100_000 },
			// The densest variant's season sets each tier: 0.60, 1.46, 1.41 and 2.77 MB with its
			// flower scapes standing. Each cap sits just above its figure, under the owner's.
			variantBytes: { low: 600_000, medium: 1_470_000, high: 1_420_000, ultra: 2_780_000 },
			// The densest variant's nearest level measures 57,456 triangles.
			lod0Triangles: 60_000,
			// The first card level measures 9,810 triangles and the second 3,060.
			lod1Triangles: 9_900,
			lod2Triangles: 3_100,
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
		// seven leaves on it, against the nine each eye of the crown carries.
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
