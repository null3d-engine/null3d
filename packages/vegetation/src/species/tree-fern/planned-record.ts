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
		// 24 a frame; the dome hides those behind it, so about 32 in all. The record's own 34 is the
		// full count from the same pictures; the directed drawing's 32 was judged near them, and this
		// record takes 32, whose spread 4 still reaches the record's 34.
		fronds: {
			count: { mean: 32, spread: 4 },
			divergence: 137.5,
			layout: 'rings',
			// The record's crown.depth: the metres of stem over which the frond bases stand. Pictures
			// 06 and 07 show them clustered at one point, so the bases spread over the top 0.2 m
			// rather than clasping a palm's length.
			clasp: 0.2,
			// The crown's fronds at 0.85 of the rule's size: at the rule's own size the pieces' tips
			// reach 1.11 of the height wide, past the still's crown box at 0.99. At 0.85 the box is
			// 0.99 of the height, the growing point 0.73 and the rise 0.28. The cut pieces keep the
			// rule's size, and a 2.24 m frond stays inside the fact sheet's 1.5 to 3 m.
			scale: 0.85,
		},
		// Picture 01: the inner fronds leave at 60 to 70 degrees above level, the middle at 30 to 40
		// and the outer at 0 to 15; the ranks take 60, 35 and 5. The base record's crown.tilt, 24, 38,
		// 70 and 95 degrees from vertical by age, gives 61, 42 and 7 above level at the 25/40/35
		// shares' midpoints. The picture reading and the tilt agree within the ranks' measured bands;
		// the middle's 35 sits between the bands' 30 to 40 and the tilt's 42, and the first round reads
		// the fountain against picture 01.
		ranks: [
			{ share: 0.25, piece: 'frond-inner', leave: 60 },
			{ share: 0.4, piece: 'frond-arched', leave: 35 },
			{ share: 0.35, piece: 'frond-arched', leave: 5 },
		],
		// Pictures 01, 16 and 20: 14 to 16 dead fronds hang in a dense bell. The record's crown.dead
		// states 20 with a skirt 0.1 of the height, 0.44 m; the bell's 14 to 16 is taken, and the
		// picture 20 band, 0.68 of the height down to 0.29, is 0.12 to 0.30 m below the growing point,
		// or 0.027 to 0.068 of the height. Each dead frond is the record's 0.72 of a living one; the
		// directed record's 0.65 was its own reading, and the record's fuller skirt governs so the
		// bell reaches the picture's crown base. The record's hang 160 from up is 70 degrees below
		// level, and the block's 70 states that.
		dead: {
			count: { mean: 16, spread: 2 },
			piece: 'frond-dead',
			hang: { mean: 70, spread: 4 },
			from: 0.03,
			to: 0.07,
			length: 0.72,
		},
		// Pictures 05 and 06: six croziers, spread 1, at the centre. The record states each a hairy
		// stalk 0.55 m tall with a head 0.06 m across; 0.55 m is 0.125 of the 4.4 m height.
		croziers: {
			count: { mean: 6, spread: 1 },
			length: { mean: 0.125, spread: 0.011 },
			coil: 540,
			radius: 0.06,
			lean: 15,
		},
	},
};

/**
 * The soft tree fern on the planned model. Its record changes from the base crown-rosette record in
 * three places. The height moves from 3.6 to 4.4 m, because 3.6 m puts the crown at 3.56 m, under
 * the fact sheet's 4 to 6 m. The dbh moves from 0.5 to 0.70 m, the still's 0.1606 of the height.
 * The living and dead fronds move from 34 and 20 to 32 and 16, the counted fountain and bell.
 */
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
		// height wide at the ground and 0.08 tall (the turning video: 0.45 and 0.09). The still's
		// flare is 2.23 times the trunk and the video's 2.35, so a flare of 2.3 fading over 0.13 m
		// draws that mound.
		flare: { amount: 2.3, height: 0.13 },
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
