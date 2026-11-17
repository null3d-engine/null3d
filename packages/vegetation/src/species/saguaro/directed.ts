// The saguaro as a directed frame: one stout stem from the foot to its rounded top, and four arms in
// two tiers, each out from a pinched joint through one elbow and up beside the stem. The ribs, the
// areoles on their crests and the rounded tops are the planned record's column block, not the
// frame's: the frame carries the axes, their widths and their bends. Shares are of the plant's
// height; the record states the lengths in metres at a 12 m plant.
import type { Curve } from '../../core/types';
import type { FrameBranchRule, FrameSide, FrameSpec } from '../../grow/frame';

/** The stem's width as a share of the height: twice the record's radius over 12 m. */
const STEM_WIDTH: Curve = [
	[0, 0.083],
	[0.05, 0.089],
	[0.44, 0.089],
	[0.56, 0.066],
	[0.85, 0.062],
	[1, 0.048],
];

/** The rounded top's width and depth as shares of the height: 1.3 stem widths. */
const DOME = 1.3 * 0.089;

/**
 * One arm tier: two arms out from the stem a few degrees below level, up through one elbow of about
 * two arm widths, and rising beside the stem to below its own top. The first variant stands its four
 * arms in one upright plane, the species' named exception; the plan turns them round the stem for
 * the other variants.
 */
const armTier = (
	along: number,
	length: number,
	radius: number,
	taper: number,
): FrameBranchRule => ({
	name: 'arm',
	role: 'limb',
	count: 2,
	along: [along, along],
	stagger: 0,
	around: [0, 180],
	jitter: 0,
	// The record's leave of five degrees below level, measured from plumb.
	angle: [
		[0, 95],
		[1, 95],
	],
	from: 'plumb',
	angleSpread: 3,
	length: {
		share: [
			[0, length],
			[1, length],
		],
	},
	radius: [
		[0, radius],
		[1, radius],
	],
	taper,
	// The elbow: out from the joint and up beside the stem, in about two arm widths.
	bends: [{ from: 0.08, to: 0.36, by: -95 }],
	sway: 1,
	elbows: 1,
	apart: 0.02,
	// The arm's rounded top, the stem's dome in smaller form.
	patch: {
		kind: 'clump',
		width: [
			[0, DOME],
			[1, DOME],
		],
		depth: [
			[0, DOME],
			[1, DOME],
		],
		offset: 0.5,
	},
});

/** The stem's own side: the column's line to the arms' plane, filled with areoles to the ground. */
const columnSide = (toward: number, armReach: number): FrameSide => ({
	toward,
	reach: [
		[0, 0.045],
		[0.35, 0.045],
		[0.4, armReach],
		[0.78, armReach],
		[0.82, 0.045],
		[1, 0.045],
	],
	under: [
		[0, 0],
		[1, 0],
	],
});

/** The saguaro's frame. */
export const frame: FrameSpec = {
	// Four sides: the arms' two directions reach out to the arm tips, and the two across them show
	// the stem alone. The first variant's arms stand in one plane, so its cross sides read the stem.
	outline: [
		columnSide(0, 0.16),
		columnSide(90, 0.045),
		columnSide(180, 0.16),
		columnSide(270, 0.045),
	],
	stems: {
		name: 'stem',
		count: 1,
		width: STEM_WIDTH,
		// The stem is the whole plant: the full height, a little lean and no elbow.
		length: {
			share: [
				[0, 1],
				[1, 1],
			],
		},
		sway: 1,
		elbows: 0,
		// The rounded top: the record's dome, 1.3 of a width tall, sitting on the stem's end.
		patch: {
			kind: 'clump',
			width: [
				[0, DOME],
				[1, DOME],
			],
			depth: [
				[0, DOME],
				[1, DOME],
			],
			offset: 0.5,
		},
		children: [
			// The lower pair leaves at 0.41 of the height and reaches 1.7 m out; the upper at 0.45 and
			// 0.97 m. Their girth is 0.61 and 0.57 of the stem's at the joint, their tips 0.78 and 0.79
			// of that.
			armTier(0.41, 0.42, 0.61, 0.78),
			armTier(0.45, 0.33, 0.57, 0.79),
		],
	},
};
