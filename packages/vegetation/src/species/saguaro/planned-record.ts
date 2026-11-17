// The saguaro's planned growth: the stem and the four arms from its frame, the areoles from the
// crest fill, and the column block the mesher's ribbed section and the fill's crests read. The
// numbers are the record's own, written here as the plan reads them.
//
// The plant has no crown of boughs, so it has no woody orders below the arms and no clumps: every
// socket is an areole on a crest, and the leaf area is the areole cards' own.
import type { Planned } from '../../core/record';
import { frame } from './directed';

/**
 * The height in metres by age share, for a full-grown plant of about 12 m. A saguaro grows slowly:
 * a seedling stands centimetres for years, a metre in a decade or two, and a 12 m plant is a
 * century and a half old.
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
	// The share of the areole cards that stays, by sparseness; the sparsest plant keeps a fifth, above
	// the species contract's floor.
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
	// One areole card is two triangles, the spur's card alone; there is no clump card to price.
	prices: { piece: 24, card: 2, clumpCard: 0, tubeSegment: 14 },
	// The mesher's ribbed section and the fill's crests: eighteen ribs round the stem, fourteen an
	// arm, grooves 0.17 of the radius deep, areoles 0.084 m apart along a crest, and a rounded top 1.3
	// stem widths tall.
	column: {
		ribs: { mean: 18, spread: 1 },
		armRibs: { mean: 14, spread: 1 },
		ribDepth: 0.17,
		areoles: 0.084,
		dome: 1.3,
	},
};
