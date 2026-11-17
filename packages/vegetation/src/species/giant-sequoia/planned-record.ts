// The giant sequoia's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the sequoia's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as sequoiaFrame } from './planned-frame';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 56 m, the
 * record's own mean. The plan scales it to the adult frame's own height, so a seed that grows
 * taller keeps its own proportions. A sequoia is slow for its first centuries and then climbs
 * steadily: a young plant is a dense pointed cone, and the great trunk comes late.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.05, 1],
	[0.15, 5],
	[0.35, 18],
	[0.6, 35],
	[0.85, 50],
	[1, 56],
];

/**
 * The crown's radius as a share of its height, by age share. The fit measures the crown width over
 * the height at 0.31, so the mature radius runs to a little over a sixth of the height; the widest
 * band stands at the crown's lower third, as picture 01 shows, and the cone narrows above it.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.1],
	[0.1, 0.13],
	[0.3, 0.15],
	[0.6, 0.16],
	[1, 0.155],
];

/** The giant sequoia's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// A sequoia lives for millennia; the model's life is long enough that the slow young cone and
	// the long bare trunk both stand on the curve.
	fullAge: 400,
	height: HEIGHT,
	spread: SPREAD,
	// The trunk, the bough whorls and the clumps at their ends are the frame's stated axes.
	adult: 'frame',
	frame: sequoiaFrame,
	// The spray of rope-like shoots each socket carries.
	piece: 'spray',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the boughs: the twigs the fill grows inside each clump. The crown's clumps are
	// dense with scale shoots, so the fill carries more twigs a clump than an open broadleaf's.
	orders: [
		{ density: 12, angle: 50, length: 0.3, birth: 0, kink: 18 },
		{ density: 16, angle: 45, length: 0.25, birth: 0, kink: 15 },
	],
	// The share of each order kept at full sparseness. The bole and the great boughs never thin, and
	// the boughs' share starts at order 1: a ladder that begins at order 2 leaves the boughs whole
	// and the sparseness inert, as the cypress found.
	thin: [0, 0.25, 0.45, 0.65, 0.75],
	// The share of each kept clump's sockets that stays, by sparseness, never under the contract's
	// 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.45],
		[1, 0.22],
	],
	// Still 19: cones hang green on the tree for years; a mature tree first bears well into its
	// life, and the crop fills over a tenth of the age.
	fruitFrom: 0.3,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the sequoia's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the alder's and the olive's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
