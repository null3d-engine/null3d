// The saguaro as a directed frame: one stout stem from the foot to its rounded top, and four arms in
// two tiers, each out from a pinched joint through one elbow and up beside the stem. The ribs, the
// areoles on their crests and the rounded tops are the planned record's column block, not the
// frame's: the frame carries the axes, their widths and their bends. Shares are of the plant's
// height; the record states the lengths in metres at a 12 m plant.
import type { Curve } from '../../core/types';
import type { FrameBranchRule, FrameSide, FrameSpec } from '../../grow/frame';

/**
 * The stem's width as a share of the height: twice the record's radius over 12 m. The record reads
 * 0.534 m from just above the foot to the arms (0.089 of the height across), 0.396 at 0.56, 0.372 at
 * 0.85 and 0.29 at the rounded top (0.048).
 */
const STEM_WIDTH: Curve = [
	[0, 0.083],
	[0.05, 0.089],
	[0.44, 0.089],
	[0.56, 0.066],
	[0.85, 0.062],
	[1, 0.048],
];

/**
 * A rounded top as shares of the height: the record's dome is its height in radii of the wood below
 * it, 1.3, so the top of a stem of radius 0.29 m is 0.377 m tall and 0.58 m across. Each axis states
 * its own, from its own tip's radius.
 */
const domeOf = (radius: number): { readonly width: number; readonly depth: number } => ({
	width: (2 * radius) / 12,
	depth: (1.3 * radius) / 12,
});

/**
 * One arm tier: two arms out from the stem a few degrees below level, up through one elbow of about
 * two arm widths, and rising beside the stem to below its own top. The first variant stands its four
 * arms in one upright plane, the species' named exception; the plan turns them round the stem for
 * the other variants. The girth is stated as the record states it: the radius where the arm leaves
 * as a share of the stem's there, and its tip as a share of its own girth.
 */
const armTier = (
	along: number,
	length: number,
	radius: number,
	taper: number,
	tipRadius: number,
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
	// The arm's rounded top, its own dome from its own tip's radius.
	patch: {
		kind: 'clump',
		width: [
			[0, domeOf(tipRadius).width],
			[1, domeOf(tipRadius).width],
		],
		depth: [
			[0, domeOf(tipRadius).depth],
			[1, domeOf(tipRadius).depth],
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

/** The stem's rounded top, from the record's top radius of 0.29 m. */
const STEM_DOME = domeOf(0.29);

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
		// The rounded top: the record's dome, 1.3 radii of the wood below it, on the stem's end.
		patch: {
			kind: 'clump',
			width: [
				[0, STEM_DOME.width],
				[1, STEM_DOME.width],
			],
			depth: [
				[0, STEM_DOME.depth],
				[1, STEM_DOME.depth],
			],
			offset: 0.5,
		},
		children: [
			// The lower pair leaves at 0.41 of the height and reaches 1.7 m out; the upper at 0.45 and
			// 0.97 m. Their girth where each leaves is 0.61 and 0.57 of the stem's there, and each tip
			// 0.78 and 0.79 of its own girth, which is 0.47 and 0.45 of the stem's. Their tip radii are
			// 0.252 and 0.239 m, each rounding off in its own dome.
			armTier(0.41, 0.42, 0.61, 0.78, 0.252),
			armTier(0.45, 0.33, 0.57, 0.79, 0.239),
		],
	},
};
