// The common ash's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the ash's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { type FrameBranchRule, type FrameSpec, evenOutline } from '../../grow/frame';
import { crownOutline, frame as ashFrame } from './directed';

/**
 * The planned ash's crown outline: the still's measured bands taken out to the widest reach the
 * turning video's hull shows, 0.55 of the height at the crown's middle. The plan reads this outline
 * for the reach of every limb and bough, and on the still's own bands the drawn crown stood about
 * four fifths of the pictures' width.
 */
const plannedOutline = evenOutline(
	crownOutline.map(([at, reach]) => [at, reach * 1.18] as const),
	0.78,
);

/**
 * The planned ash's limbs: its first, lowest pair leaves the trunk a little lower than the still
 * states, so the crown's foliage reaches down toward the pictures' crown base, which stands at about
 * 0.37 of the plant's height against the still's higher fork.
 */
const lowerFirstLimbs = (rule: FrameBranchRule): FrameBranchRule =>
	rule.name === 'limb' ? { ...rule, along: [0.4, 0.81] } : rule;

/** The planned ash's frame: the ash's own axes, with its measured width and its first limbs lower. */
const plannedFrame: FrameSpec = {
	...ashFrame,
	outline: plannedOutline,
	stems: {
		...ashFrame.stems,
		children: ashFrame.stems.children?.map(lowerFirstLimbs),
	},
};

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 22 m. The
 * plan scales it to the adult frame's own height, so a seed that grows taller keeps its own
 * proportions. The ash is a fast young tree: a seedling's pole climbs several metres in a handful
 * of years, and the open dome forms on top as the climb slows.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 2.5],
	[0.08, 7],
	[0.16, 12],
	[0.3, 16],
	[0.5, 19],
	[0.75, 21],
	[1, 22],
];

/**
 * The crown's radius as a share of its height, by age share. The fit measures the crown's width at
 * 0.9 of the plant's height (fit.ts), so the radius runs to about 0.45: a broad open dome a little
 * taller than wide, wider than the alder's or the birch's crown.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.05],
	[0.05, 0.13],
	[0.15, 0.24],
	[0.35, 0.34],
	[0.7, 0.42],
	[1, 0.45],
];

/** The common ash's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. An open-grown common ash lives about a hundred years.
	fullAge: 100,
	height: HEIGHT,
	spread: SPREAD,
	// The bole, the steep limbs and the branches with the bunches they end in are the frame's stated
	// axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: plannedFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the branches: the branches themselves are stated by the frame; these describe
	// the woody twigs the keyed fill grows inside each bunch. Stills 04 and 05: pinnate leaves stand
	// in bunches at the upturned shoot tips with sky between the bunches, so the bunches stay open.
	orders: [
		{ density: 8, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 12, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The bole and the great limbs never thin; at
	// sparseness 1 about two thirds of the branches and a third of the twigs stay.
	thin: [0, 0, 0.34, 0.67, 0.72],
	// The share of each kept clump's sockets that stays, by sparseness, never under the contract's
	// 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// Still 19: the hanging bunches of keys come on a mature tree, and the ash first bears them in
	// the open at about twenty-five years. The crop fills over a tenth of the age.
	fruitFrom: 0.25,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the ash's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the alder's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
