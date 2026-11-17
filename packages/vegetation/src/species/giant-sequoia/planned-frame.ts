// The giant sequoia's frame, translated from its conifer record's measured numbers so the planned
// grower can read it. Every figure here is the conifer record's or the fit's; the comments name the
// still each was read on. The translation keeps the conifer's shape and changes only the form the
// numbers take: the record states bough levels, leave angles and a shell reach, and the frame states
// the same as a stem, its bough rules and their patches.
import { evenOutline, type FrameSpec } from '../../grow/frame';

/**
 * Still 01, the crown's half width by height: the conifer record's own reach, which is the outline
 * the frame's boughs run to. The crown stands from 0.34 of the height to a rounded top at 0.98.
 */
const REACH = [
	[0.34, 0.115],
	[0.38, 0.135],
	[0.46, 0.153],
	[0.54, 0.152],
	[0.62, 0.14],
	[0.7, 0.128],
	[0.78, 0.114],
	[0.86, 0.093],
	[0.94, 0.063],
	[0.98, 0.039],
] as const;

/** The turning video: the crown is round within 5 per cent, so the narrow side is 0.95 of the wide. */
const NARROW = 0.95;

/**
 * Still 01, the trunk's taper through its line, in shares of the height: the conifer record's own
 * width. The foot's widening below 0.06 is the stem base's own.
 */
const TRUNK = [
	[0, 0.19],
	[0.06, 0.173],
	[0.1, 0.138],
	[0.14, 0.121],
	[0.22, 0.103],
	[0.3, 0.092],
	[0.44, 0.087],
	[1, 0.012],
] as const;

/**
 * Still 01: twelve limb levels show between the crown's base and its top. The record states them
 * and the conifer fills 54 limbs across them; here each level is its own rule, four or five boughs
 * turned evenly round the trunk, so the crown keeps the rings the pictures show rather than filling
 * evenly. The angle at each level is the record's leave angle turned to plumb: 90 less the degrees
 * it leaves above level, so 115 at the lowest level and 36 at the highest. The two lowest levels stand less steeply than the conifer's own
 * measurement, so their tips do not droop below the fit's crown base.
 */
const LEVELS = [
	{ at: 0.385, count: 5, angle: 97, leave: -7 },
	{ at: 0.42, count: 4, angle: 100, leave: -10 },
	{ at: 0.44, count: 4, angle: 108, leave: -18 },
	{ at: 0.495, count: 5, angle: 100, leave: -10 },
	{ at: 0.55, count: 4, angle: 94, leave: -4 },
	{ at: 0.605, count: 5, angle: 90, leave: 0 },
	{ at: 0.66, count: 4, angle: 82, leave: 8 },
	{ at: 0.715, count: 5, angle: 70, leave: 20 },
	{ at: 0.77, count: 4, angle: 60, leave: 30 },
	{ at: 0.825, count: 5, angle: 52, leave: 38 },
	{ at: 0.88, count: 4, angle: 45, leave: 45 },
	{ at: 0.935, count: 5, angle: 36, leave: 54 },
] as const;

/**
 * Still 01: separate rounded clumps 0.04 to 0.06 of the height across, one on each limb's end. A
 * spray piece is about 0.8 m on a 56 m tree, so a clump of 0.05 carries about four of them across;
 * the pitch stands them closer than a piece's width, as the alder's and the olive's masses do.
 */
const CLUMP = 0.05;
const SPRAYS = { pitch: 0.01, reach: 0.014 } as const;

/** The giant sequoia's frame. */
export const frame: FrameSpec = {
	outline: evenOutline(REACH as unknown as (readonly [number, number])[], NARROW),
	stems: {
		name: 'trunk',
		count: 1,
		width: TRUNK as unknown as (readonly [number, number])[],
		// Stills 01 and 18: the trunk runs to the top as one leader, under a rounded crown.
		length: { share: 1 },
		sway: 6,
		elbows: 2,
		children: LEVELS.map((level) => ({
			name: 'bough',
			role: 'branch' as const,
			count: level.count,
			// A narrow stretch of the trunk makes one whorl; the smallest share keeps the frame's
			// places distinct without spreading the level along the stem.
			along: [level.at - 0.004, level.at + 0.004] as const,
			stagger: 0.2,
			around: 'ring' as const,
			angle: level.angle,
			from: 'plumb' as const,
			angleSpread: 4,
			// Every bough runs to the shell, so its tip stands on the outline at its own height.
			length: { outline: 1 },
			vary: 0.05,
			// Still 01: a limb is 0.10 of the trunk's width at its base; stills 05 and 06 show it
			// dip along its run and hook up at its end.
			radius: 0.12,
			taper: 0.4,
			bends: [{ from: 0.3, to: 1, level: [[0, level.leave] as const, [1, 55] as const] }],
			sway: 6,
			elbows: 3,
			apart: 0.01,
			patch: { kind: 'clump', width: CLUMP, depth: CLUMP, fill: SPRAYS },
		})),
	},
};
