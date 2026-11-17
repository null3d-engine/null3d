// The Italian cypress as a frame: the conifer record's own stated numbers read as a frame spec, so
// a planned adult can be grown from it the way the nine broadleaves' adults are.
//
// What is carried over, and from where:
// - the outline, picture 01's measured half width by height in `directed.ts`, with the quarter turn
//   at the turning video's 0.94 of the wide side;
// - one plumb trunk to the tip, its taper the conifer's own width curve;
// - 120 boughs spread along the trunk at many heights and no whorl (pictures 05 and 06), leaving at
//   the record's leave angles and running out to the shell;
// - each bough carries its foliage as one patch at its outer end, the shell width the conifer states.
// The conifer record's inner body has no frame counterpart: the frame's patches stand at the bough
// ends and the planned fill clothes them, so the column's closure comes from the patches' own
// cover rather than from a body behind them. The recipe in `build/cypress/RECIPE.md` records this.
import type { Curve } from '../../core/types';
import { evenOutline, type FrameBranchRule, type FrameSpec } from '../../grow/frame';
import { OUTLINE } from './directed';

/**
 * The boughs: every bough runs to the shell, so the crown's width is the outline's. Their leave
 * angles are the record's: 10 degrees at the foliage's foot, 40 by 0.06 of the height, 67 by 0.12,
 * and 70 above.
 */
const boughs: FrameBranchRule = {
	name: 'bough',
	role: 'branch',
	count: 120,
	along: [0.011, 0.92],
	around: 'spiral',
	jitter: 20,
	angle: [
		[0, 10],
		[0.06, 40],
		[0.12, 67],
		[1, 70],
	],
	from: 'parent',
	angleSpread: 8,
	// The clump at the bough's end is a sphere of half its patch width, standing past the tip, so the
	// tip is drawn in to four fifths of the outline: the clump's own reach then meets it.
	length: { outline: 0.8 },
	vary: 0.06,
	least: 0.015,
	most: 0.5,
	radius: 0.11,
	taper: 0.6,
	// Pictures 05, 06 and 03: a bough leaves steep and runs up inside the column. The conifer's own
	// run turns from 25 to nearly 78 degrees within a tenth of the height, so the shallow boughs near
	// the foot turn up at once and their foliage stays at the foot.
	bends: [
		{ from: 0, to: 0.2, by: 50 },
		{ from: 0.2, to: 0.6, by: 15 },
	],
	sway: 4,
	elbows: 2,
	// The patch is the bough's outer part where its fans stand, the shell width the record states:
	// 0.02 of the height at the lowest bough, 0.03 at the highest.
	patch: {
		kind: 'clump',
		width: [
			[0, 0.02],
			[1, 0.03],
		],
		depth: [
			[0, 0.02],
			[1, 0.03],
		],
		fill: { pitch: 0.0045, reach: 0.5 / 17 },
	},
};

/** The Italian cypress's frame. */
export const frame: FrameSpec = {
	// Picture 01's outline through the turning video's narrow side: 0.94 of the wide side.
	outline: evenOutline(OUTLINE as Curve, 0.94),
	stems: {
		name: 'trunk',
		count: 1,
		// The conifer's trunk: 0.031 of the height at the foot, a slim leader at the tip.
		width: [
			[0, 0.031],
			[0.05, 0.026],
			[0.3, 0.02],
			[0.6, 0.013],
			[0.9, 0.006],
			[1, 0.002],
		],
		// One plumb stem to the tip (the conifer's divide at 1).
		length: { share: 1 },
		sway: 1.5,
		elbows: 2,
		children: [boughs],
	},
};
