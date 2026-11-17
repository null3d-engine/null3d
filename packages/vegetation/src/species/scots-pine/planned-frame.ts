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

/** Still 01, the trunk's taper through its line, in shares of the height: the record's own width. */
const TRUNK = [
	[0, 0.084],
	[0.14, 0.07],
	[0.28, 0.064],
	[0.42, 0.054],
	[0.69, 0.04],
	[1, 0.034],
] as const;

/**
 * Still 02: the limbs cross a line beside the trunk at five heights, in whorls. Each level is its
 * own ring rule, with the record's counts summing to its 14 limbs. The record states the leave and
 * the end as degrees above level; the frame's leave is turned to plumb, 90 less the degrees, and
 * its bend states both in the record's own degrees, so the low pads' floors fall with their limbs.
 */
const LEVELS = [
	{ at: 0.46, count: 2, leave: 30, end: -28, pad: 0.23 },
	{ at: 0.52, count: 2, leave: 30.7, end: -28, pad: 0.25 },
	{ at: 0.61, count: 3, leave: 31.7, end: -55, pad: 0.28 },
	{ at: 0.69, count: 3, leave: 32.9, end: -55, pad: 0.31 },
	{ at: 0.755, count: 4, leave: 34, end: -28, pad: 0.35 },
] as const;

/** Still 01: four top limbs leave at 45 degrees and level out under the top plates. */
const TOP = { at: 0.81, count: 4, leave: 45, end: 0, pad: 0.32 } as const;

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
 * Still 08: a limb forks in its outer half, two arms at 39 degrees, each about 0.7 of its parent's
 * width. The frame gives a bough one fork of two arms; the record's two or three forks repeat the
 * pair along the limb. Each arm carries a small pad, so a limb's foliage reads as layered plates
 * rather than one mass.
 */
const STUB = {
	width: [
		[0, 0.035],
		[1, 0.05],
	],
	depth: [
		[0, 0.01],
		[1, 0.015],
	],
} as const;

const stub = () => ({
	name: 'arm',
	role: 'branch' as const,
	count: 2,
	along: [0.55, 0.8] as const,
	stagger: 0.4,
	around: 'ring' as const,
	angle: 39,
	from: 'parent' as const,
	angleSpread: 10,
	length: { share: 0.2 },
	vary: 0.2,
	radius: 0.7,
	taper: 0.6,
	sway: 8,
	elbows: 1,
	patch: { kind: 'clump', width: STUB.width, depth: STUB.depth, fill: SHELL },
});

const rule = (
	level: {
		readonly at: number;
		readonly count: number;
		readonly leave: number;
		readonly end: number;
		readonly pad: number;
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
	length: { outline: 0.85 },
	vary: 0.05,
	// Still 01: the limb leaves the trunk at 0.58 of its radius, the collar at the joint, and keeps
	// 0.85 of its radius along the run. The frame reads one radius at the joint, so the collar's
	// value stands and no swell fades behind it.
	radius: 0.58,
	taper: 0.85,
	bends: [{ from: 0.3, to: 1, level: [[0, level.leave] as const, [1, level.end] as const] }],
	sway: 6,
	elbows: 3,
	apart: 0.01,
	...(stubs ? { children: [stub()] } : {}),
	patch: { kind: 'clump', width: level.pad, depth: PAD.depth, fill: SHELL },
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
	},
};
