// The Scots pine's frame, translated from its conifer record's measured numbers so the planned
// grower can read it. The translation keeps the conifer's shape and changes only the form: the
// record states bough levels, leave angles, ends and a shell reach, and the frame states the same
// as a stem, its whorl rules and their pads.
import { evenOutline, type FrameSpec } from '../../grow/frame';

/** Still 01, the crown's half width by height: the record's own reach, through the top plates. */
const REACH = [
	[0.46, 0.4],
	[0.52, 0.6],
	[0.61, 0.55],
	[0.69, 0.55],
	[0.755, 0.47],
	[0.81, 0.36],
	[0.9, 0.27],
	[0.95, 0.11],
	[1, 0.09],
] as const;

/** The turning video: the crown is round within 5 per cent, so the narrow side is 0.95 of the wide. */
const NARROW = 0.95;

/**
 * The trunk's taper through its line, in shares of the height. The species record states a breast
 * height diameter of 0.9 m at a 20 m tree, 0.045 of the height; the directed form's own still reads
 * 0.076 and so draws 1.5 m, so this curve is the record's size, scaled from the directed taper.
 */
const TRUNK = [
	[0, 0.05],
	[0.14, 0.042],
	[0.28, 0.038],
	[0.42, 0.032],
	[0.69, 0.024],
	[1, 0.02],
] as const;

/**
 * Still 02: the limbs cross a line beside the trunk at five heights, in whorls. Each level is its
 * own ring rule, with the record's counts summing to its 14 limbs. The record states the leave and
 * the end as degrees above level; the frame's leave is turned to plumb, 90 less the degrees, and
 * its bend states both in the record's own degrees, so the low pads' floors fall with their limbs.
 */
const LEVELS = [
	{ at: 0.43, count: 2, leave: 30, end: -28, pad: 0.23, band: [0.25, 0.75] },
	{ at: 0.52, count: 2, leave: 30.7, end: -28, pad: 0.25, band: [0.2, 0.65] },
	{ at: 0.61, count: 3, leave: 31.7, end: -55, pad: 0.28, band: [0.15, 0.5] },
	{ at: 0.69, count: 3, leave: 32.9, end: -55, pad: 0.31, band: [0.15, 0.5] },
	{ at: 0.755, count: 4, leave: 34, end: -28, pad: 0.35, band: [0.2, 0.65] },
] as const;

/** Still 01: four top limbs leave at 45 degrees and level out under the top plates. */
const TOP = { at: 0.81, count: 4, leave: 45, end: 0, pad: 0.32, band: [0.1, 0.6] } as const;

/**
 * The pad's dome as a share of its width: still 02 reads a dome 0.29 of its width deep, so the
 * depth follows the level's own width. Each level states its pad's width, 0.23 to 0.35.
 */
const PAD = {
	depth: [
		[0.46, 0.067],
		[0.755, 0.102],
		[1, 0.102],
	],
} as const;
const SHELL = { pitch: 0.021, reach: 0.029 } as const;

/**
 * The pads take the conifer family's clump class: a pine's bough carries side sprays along its
 * outer half, and each spray ends in a needle tuft, so one pad is many small clumps and never one
 * mass. Still 08's fork stands as two arms with no foliage of their own, as the record's arms
 * spread under the pad.
 */
const CLUMP = 0.1;
const TUFT = { width: CLUMP, depth: CLUMP * 0.29 } as const;

const tuft = (pad: number) => ({
	name: 'tuft',
	role: 'branch' as const,
	count: 1,
	along: [0.85, 1] as const,
	stagger: 0,
	around: 'ring' as const,
	angle: 20,
	from: 'parent' as const,
	angleSpread: 8,
	length: { share: 0.05 },
	vary: 0.2,
	radius: 0.7,
	taper: 0.7,
	sway: 4,
	elbows: 1,
	patch: { kind: 'clump', width: pad, depth: TUFT.depth, fill: SHELL },
});

const arm = () => ({
	name: 'arm',
	role: 'branch' as const,
	count: 2,
	along: [0.55, 0.8] as const,
	stagger: 0.4,
	around: 'ring' as const,
	angle: 39,
	from: 'parent' as const,
	angleSpread: 10,
	length: { share: 0.08 },
	vary: 0.2,
	radius: 0.7,
	taper: 0.6,
	sway: 8,
	elbows: 1,
});

const tip = (pad: number) => ({
	name: 'tip',
	role: 'branch' as const,
	count: 1,
	along: [0.96, 1] as const,
	stagger: 0,
	around: 'ring' as const,
	angle: 8,
	from: 'parent' as const,
	angleSpread: 6,
	length: { share: 0.02 },
	vary: 0.1,
	radius: 0.8,
	taper: 0.8,
	sway: 4,
	elbows: 1,
	patch: { kind: 'clump', width: pad, depth: TUFT.depth, fill: SHELL },
});

const spray = (band: readonly [number, number], pad: number) => ({
	name: 'spray',
	role: 'branch' as const,
	count: 5,
	along: band,
	stagger: 0.5,
	around: 'spiral' as const,
	angle: 20,
	from: 'parent' as const,
	angleSpread: 12,
	length: { share: 0.02 },
	vary: 0.25,
	radius: 0.35,
	taper: 0.6,
	sway: 8,
	elbows: 1,
	children: [tuft(pad)],
});

const rule = (
	level: {
		readonly at: number;
		readonly count: number;
		readonly leave: number;
		readonly end: number;
		readonly pad: number;
		readonly band: readonly [number, number];
		readonly lowPad?: number;
	},
	stubs = true,
) => ({
	name: 'bough',
	role: 'branch' as const,
	count: level.count,
	along: [level.at - 0.004, level.at + 0.004] as const,
	stagger: 0.2,
	around: 'ring' as const,
	angle: 90 - level.leave,
	from: 'plumb' as const,
	angleSpread: 4,
	// The crown's own outline is the foliage's edge, so the wood stops a pad's radius inside it.
	length: { outline: 1 },
	vary: 0.05,
	// Still 01, at the measured place outside the collar: the limb is 0.20 of the trunk's radius
	// and keeps 0.85 of it along the run. The collar's swell to 0.58 at the joint is the form's
	// limit, since a frame radius holds one value along a limb.
	radius: 0.2,
	taper: 0.85,
	bends: [{ from: 0.3, to: 1, level: [[0, level.leave] as const, [1, level.end] as const] }],
	sway: 6,
	elbows: 3,
	apart: 0.01,
	...(stubs
		? { children: [arm(), spray(level.band, level.pad * 0.33), tip(level.pad * 0.3)] }
		: {}),
});

/** The Scots pine's frame. */
export const frame: FrameSpec = {
	outline: evenOutline(REACH as unknown as (readonly [number, number])[], NARROW),
	stems: {
		name: 'trunk',
		count: 1,
		width: TRUNK as unknown as (readonly [number, number])[],
		length: { share: 1 },
		sway: 3,
		elbows: 3,
		crook: 0.2,
		children: [...LEVELS.map((level) => rule(level)), rule(TOP, false)],
		// Still 01: one pad stands on top over the trunk's line, and the leader ends inside it.
		patch: { kind: 'clump', width: 0.12, depth: 0.035, fill: SHELL },
	},
};
