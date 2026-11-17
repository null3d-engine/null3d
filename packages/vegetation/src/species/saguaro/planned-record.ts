// The saguaro's planned growth: the stem and the four arms from its frame, the areoles from the
// crest fill, and the column block the mesher's ribbed section and the fill's crests read. The
// numbers are the record's own, written here as the plan reads them.
//
// The plant has no crown of boughs, so it has no woody orders below the arms and no clumps: every
// socket is an areole on a crest, and the leaf area is the areole cards' own. The plan therefore
// prices the leaves explicitly, an areole card's two triangles a place, because the tree's price
// counts foliage at order-4 sockets and a column has none.
//
// The skin's density is measured with the crest fill: the plant carries 5,632 areoles at full cover,
// 2,816 at half sparseness and 1,126 at full, and its first card level draws 35,863 triangles. The
// record's budget for that level is 112,000 and its comment states 109,223 areole-card triangles;
// the shipped tree's own first card level measures 49,081, so the planned skin reads 0.73 of the
// tree it replaces. The gap is the price: one spine-cluster card, two triangles, at each areole,
// where the record's 109,223 counts several planes or tiles an areole. 35,863 is the figure the eye
// reads. The nest holes are the old column grower's own number, 30 in the 0.5 to 0.85 band, not the
// record's: the record's extra is the berry at old-wood, and a planned extras site for them is still
// open.
import type { Planned } from '../../core/record';
import { frame } from './directed';

/**
 * The height in metres by age share, for a full-grown plant of about 12 m. A saguaro grows slowly:
 * a seedling stands centimetres for years, a metre in a decade or two, and a 12 m plant is a
 * century and a half old. The drawn adult stands 13.12 m, the frame's own plan height, 0.12 m above
 * the record's 12 m mean plus its 1 m spread; the plan scales the frame's shares to the adult, so
 * the figure is the frame's plan and the pictures read it.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 0.4],
	[0.1, 1.6],
	[0.3, 4.6],
	[0.6, 8.6],
	[0.85, 11],
	[1, 12],
];

/**
 * The plant's spread as a share of its height, by age share: the stem's own radius until the arms
 * come, then the arm tips' reach, 1.92 m out on a 12 m plant.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.02],
	[0.2, 0.045],
	[0.45, 0.09],
	[0.79, 0.16],
	[1, 0.16],
];

/** The saguaro's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// A century and a half to the 12 m adult.
	fullAge: 150,
	height: HEIGHT,
	spread: SPREAD,
	// The stem and the four arms are the frame's own axes; there is no finer wood to fill.
	adult: 'frame',
	frame,
	// The sockets hold shoot rows, the areole's spine-cluster card, so no piece is named.
	orders: [],
	// The stem and the arms never thin: sparseness thins the areoles, not the axes.
	thin: [0, 0],
	// The share of the areole cards that stays, by sparseness: 5,571 areoles at none, 2,786 at a half
	// and 1,114 at full sparseness, while the four arms stand at every setting. The sparsest plant
	// keeps a fifth, above the species contract's floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.5],
		[1, 0.2],
	],
	// The plant first flowers and fruits at about half its adult age, and the ring fills over a fifth.
	fruitFrom: 0.5,
	fruitBand: 0.2,
	flowers: { season: 'blossom', from: 0.5, band: 0.2 },
	// A capped crown's cards stand at the middle of the wood that draws them, so a hard cap keeps the
	// areoles on the drawn column rather than reshaping the plant.
	capCards: 'wood',
	// One areole card is two triangles, the spur's card alone, and the plan prices the areoles at that
	// figure: with no order-4 sockets a clump card would price no leaves at all. There is no clump.
	prices: { piece: 24, card: 2, clumpCard: 0, tubeSegment: 14 },
	// The mesher's ribbed section and the fill's crests: eighteen ribs round the stem, fourteen an
	// arm, grooves 0.17 of the radius deep, areoles 0.084 m apart along a crest, and a rounded top 1.3
	// radii of the wood below it tall.
	column: {
		ribs: { mean: 18, spread: 1 },
		armRibs: { mean: 14, spread: 1 },
		ribDepth: 0.17,
		areoles: 0.084,
		dome: 1.3,
	},
};
