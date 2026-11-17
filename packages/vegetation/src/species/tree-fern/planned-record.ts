// The soft tree fern's planned growth: one stout trunk from the root mound to the growing point,
// and a rosette of fronds at that point. The rosette block lays one socket a frond and the dead
// skirt, each rank carrying its own piece; the plan takes the crown's box from the fronds' reach.
//
// Scale: the fact sheet gives a trunk 2 to 5 m and a crown 4 to 6 m wide. The plant is 4.4 m, where
// picture 01's proportions put the frond at 0.6 of the height (2.64 m against 1.5 to 3 m) and the
// growing point at 0.72. Every other number is the pictures' measured share of that height.
import type { Planned, Species } from '../../core/record';
import { PIECES } from './pieces';
import { frame } from './planned-frame';
import { record } from './record';

/** The record's pinna, the leaf the fronds wear. */
const pinna = record.foliage.kind === 'blade' ? record.foliage.leaf : undefined;
if (!pinna) throw new Error("@null3d/vegetation: the tree fern's record lost its blade pinna");

/** The fern's height, and the trunk's, which the plan's height curve reads. */
const HEIGHT = 4.4;
const TRUNK = 0.72 * HEIGHT;

/**
 * The trunk's height in metres by age share. A tree fern builds its trunk slowly from a ground
 * rosette: a metre takes a decade, and a four-metre plant is old. The curve states the trunk's
 * height; the crown's fronds stand above it.
 */
const HEIGHT_CURVE: Planned['height'] = [
	[0, 0],
	[0.05, 0.3],
	[0.2, 1.1],
	[0.5, 2.2],
	[0.8, 2.85],
	[1, TRUNK],
];

/** The crown's radius as a share of the plant's height by age: a young rosette is wide. */
const SPREAD: Planned['spread'] = [
	[0, 0.32],
	[0.2, 0.4],
	[0.5, 0.46],
	[1, 0.495],
];

/** The soft tree fern's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// A tree fern of this size is decades old.
	fullAge: 80,
	height: HEIGHT_CURVE,
	spread: SPREAD,
	// The trunk and the growing point come from the frame; the fronds are the rosette's.
	adult: 'frame',
	frame,
	// The fronds carry the record's pieces, one by rank, so no single piece is named here.
	orders: [],
	// The axes never thin: the rosette's own rank ladder keeps whole fronds.
	thin: [0, 0, 0, 0, 0],
	// The share of fronds kept by sparseness: the specification's sparsest fern keeps 0.39.
	leavesAt: [
		[0, 1],
		[0.5, 0.7],
		[1, 0.4],
	],
	// The sori are painted in the underside texture, so the plant carries no fruit or flower.
	fruitFrom: 1,
	fruitBand: 0,
	// A capped crown's fronds stand at their own places and sizes, one card a frond.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
	rosette: {
		// Picture 01 at full size: about 20 living fronds from one side, and the turning video 18 to
		// 24 a frame; the dome hides those behind it, so about 32 in all.
		fronds: { count: { mean: 32, spread: 4 }, divergence: 137.5, layout: 'rings', clasp: 0.15 },
		// Picture 01: inner fronds leave at 60 degrees, middle at 35, outer at 5, one even fountain.
		ranks: [
			{ share: 0.25, piece: 'frond-inner', leave: 60 },
			{ share: 0.4, piece: 'frond-arched', leave: 35 },
			{ share: 0.35, piece: 'frond-arched', leave: 5 },
		],
		// Pictures 01, 16 and 20: 14 to 16 dead fronds hang in a dense bell from 0.68 of the height
		// down to about 0.29; each is 0.65 of a living frond.
		dead: {
			count: { mean: 16, spread: 2 },
			piece: 'frond-dead',
			hang: { mean: 70, spread: 4 },
			from: 0.03,
			to: 0.07,
			length: 0.65,
		},
		// Pictures 05 and 06: four to six croziers at the centre, each a hairy stalk 0.12 of the
		// height tall ending in a coil about 0.035 m across.
		croziers: {
			count: { mean: 5, spread: 1 },
			length: { mean: 0.12, spread: 0.01 },
			coil: 540,
			radius: 0.035,
			lean: 15,
		},
	},
};

/** The soft tree fern on the planned model. */
export const planned: Species = {
	...record,
	size: { height: { mean: HEIGHT, spread: 0.4 }, dbh: 0.16 * HEIGHT, aspect: 1 },
	growth: plannedGrowth,
	pieces: PIECES,
	// The pieces read their bud and leaf-turn figures here; no shoot class grows on this plant.
	shoots: {
		prototypes: 4,
		classes: [
			{
				name: 'long',
				vigor: [0, 1],
				share: 1,
				length: { mean: 0.6 * HEIGHT, spread: 0 },
				nodes: { mean: 2, spread: 0 },
				internode: 1,
				leafScale: 1,
				leafAngle: 75,
				droop: 0,
			},
		],
		phyllotaxis: { kind: 'opposite', decussate: false },
		orders: 1,
		years: 1,
		leafYears: 1,
		stem: { radius: [0.016, 0.002], zigzag: 0 },
		bud: { length: 0, width: 0, tipCluster: 0 },
		placement: { perMetre: 0, shadePrune: 0, skyward: 0.5, scale: 1 },
	},
	// The leaf is one pinna (pieces.ts), one lacy card a pinna at every tier.
	foliage: {
		kind: 'blade',
		leaf: {
			...pinna,
			narrow: true,
			// The faces as the plant's own pictures show them (green pixels' means, in sRGB): the upper
			// face on 04, 08, 09, 11, 12, 21 and 22, mean 80 / 100 / 51; the lower face on 13, 25 and
			// 05, mean 145 / 158 / 97. The texture's source, picture 24, is darker (56 / 71 / 30).
			optics: {
				...pinna.optics,
				reflectance: [0.079, 0.127, 0.033],
				reflectanceBack: [0.283, 0.341, 0.119],
			},
		},
	},
	base: {
		// Picture 01: the foot widens to 0.175 of the height just above a low root mound 0.53 of the
		// height wide at the ground and 0.08 tall (the turning video: 0.45 and 0.09). A flare of 2.5
		// times the trunk's radius fading over 0.13 m draws that mound.
		flare: { amount: 2.5, height: 0.13 },
		...(record.base?.roots ? { roots: record.base.roots } : {}),
	},
	lod: {
		...record.lod,
		nearFoliage: 'instanced',
		// A frond's pinnae need the texels across it, so each stretch of its cut card takes a whole
		// cell.
		cardCuts: { cells: 'full' },
		budget: {
			...record.lod.budget,
			// The fronds are pieces in the kit, shared by every plant, where the grown fern drew them
			// in each plant's own mesh: 2.00, 2.07, 2.19 and 2.31 MB at the four tiers.
			kitBytes: { low: 2_000_000, medium: 2_000_000, high: 2_000_000, ultra: 2_000_000 },
			variantBytes: { low: 150_000, medium: 150_000, high: 150_000, ultra: 150_000 },
		},
	},
	cuttings: { leaf: { pressed: true } },
};
