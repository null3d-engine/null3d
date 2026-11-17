// The silver birch as a directed frame: one plumb leader to the tip, twelve thin limbs that leave it
// one at a time, and the side branches whose ends arch over and hang. Each figure names the
// reference picture it was read on. Shares are of the tree's height, measured from the true foot of
// each picture. Still 01 and the whole-tree turning video are the one tree the frame follows.

import type { ExtraSpec } from '../../core/record';
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * A strand of still 21, 0.5 m long on a tree 21 m tall, as a share of the height: the length the
 * sockets are spaced by. Each socket carries a spray, a short branch with strands hanging along it.
 */
const STRAND = 0.5 / 21;
/** Sockets down a fall, so its sprays hang with a little overlap. */
const DOWN_A_FALL = { every: STRAND * 0.6, angle: 10 } as const;
/**
 * Sockets along a branch: four fifths of a strand apart, the spacing at which the crown's sky at
 * stills 01, 02 and 18 stands inside the standard's band at the first card level.
 */
const ALONG_AN_END = { every: STRAND * 0.8, angle: 60 } as const;

/**
 * The fine arms a side branch carries. Stills 21 and 22: arms leave the branch on both sides every
 * few decimetres, rise a little, arch over and hang, each clothed with strands along its run.
 */
const twigs: FrameBranchRule = {
	name: 'twig',
	role: 'branch',
	count: { every: 0.008, least: 3, most: 14 },
	along: [0.15, 0.95],
	stagger: 0.25,
	around: 'sides',
	jitter: 20,
	angle: 35,
	from: 'parent',
	angleSpread: 8,
	length: {
		parent: [
			[0, 0.45],
			[1, 0.3],
		],
	},
	vary: 0.15,
	radius: 0.5,
	taper: 0.3,
	bends: [{ from: 0.1, to: 1, level: -35 }],
	sway: 10,
	elbows: 3,
	patch: {
		kind: 'hang',
		width: 0.05,
		depth: 0.04,
		offset: -0.5,
		along: 0.1,
		sockets: ALONG_AN_END,
	},
};

/** The silver birch's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in 24 bands from the top down, each at its own height.
	outline: evenOutline(
		[
			[0.243, 0.084],
			[0.282, 0.149],
			[0.32, 0.182],
			[0.359, 0.228],
			[0.398, 0.247],
			[0.437, 0.261],
			[0.515, 0.256],
			[0.592, 0.27],
			[0.631, 0.238],
			[0.709, 0.228],
			[0.786, 0.191],
			[0.864, 0.168],
			[0.903, 0.13],
			[0.942, 0.075],
			[0.981, 0.037],
			[1, 0],
		],
		// The crown is built nearly round. Still 01 looks across the wide side.
		0.8,
	),
	stems: {
		name: 'leader',
		count: 1,
		// Stills 01 and 02, counted on the full-size pictures: the collar is 0.05 at the ground, the
		// bole 0.025 at a twentieth of the height and 0.024 at a fifth. Still 01: white bark shows on
		// the leader to 0.80 of the height, where it is a third of the bole.
		width: [
			[0, 0.05],
			[0.02, 0.03],
			[0.07, 0.025],
			[0.2, 0.024],
			[0.39, 0.022],
			[0.8, 0.008],
			[1, 0.0015],
		],
		// The leader's own tip carries a branch end, whose top is the tree's.
		length: { height: 0.975 },
		// Still 17: the bole is straight over its whole run.
		sway: 0.6,
		elbows: 4,
		patch: { kind: 'hang', width: 0.05, depth: 0.05, sockets: ALONG_AN_END },
		children: [
			{
				name: 'limb',
				role: 'limb',
				// Stills 01 and 18: 11 to 12 limbs show in outline, leaving from 0.39 to 0.85 of the height
				// at even steps of about 0.04. The shares here are of the leader's own length.
				count: 18,
				along: [0.28, 0.88],
				stagger: 0.25,
				// Stills 06 and 07: single, alternate, turning round the leader.
				around: 'spiral',
				jitter: 8,
				// Still 01: the lowest limb runs 155 px out for 160 px up, an upper limb 100 px out for
				// 160 px up.
				angle: [
					[0, 45],
					[1, 32],
				],
				from: 'plumb',
				angleSpread: 3,
				// Still 01: the wood shows to 250 px of a 355 px half width; the low limbs reach nearer the
				// crown's widest row, so their strands fill its lower half.
				length: {
					outline: [
						[0, 0.88],
						[0.4, 0.78],
						[1, 0.7],
					],
				},
				vary: 0.08,
				// Still 07: a limb is 0.3 to 0.4 of the trunk's width at the join.
				radius: 0.35,
				taper: 0.22,
				// Stills 01, 18 and 04: nearly straight for two thirds, then it arches over. Still 18: the
				// lowest limbs' ends hang, the middle limbs end level and the top limbs' ends still rise.
				bends: [
					{
						from: 0.6,
						to: 1,
						level: [
							[0, -55],
							[0.5, -15],
							[1, 12],
						],
					},
				],
				// Still 06: a limb's line shifts a little to one side and the other along its run.
				sway: 10,
				elbows: 6,
				// Still 19: a limb end hangs 9 strands, the longest a metre. Still 01: the hanging twigs
				// stand out past the wood's end by 0.3 of the crown's half width, and the fringe under
				// the lowest limbs is a tenth of the height deep.
				patch: {
					kind: 'hang',
					width: 0.16,
					depth: [
						[0, 0.1],
						[1, 0.05],
					],
					offset: -0.5,
					// Still 01: strands hang along most of a limb's run, hugging it from near the trunk.
					along: 0.2,
					sockets: ALONG_AN_END,
				},
				children: [
					{
						name: 'fall',
						role: 'whip',
						// Stills 01 and 18: the outer part of a limb ends in hanging wood, a tenth of the
						// height long and more under the lowest limbs, which carries the fringe down to a
						// quarter of the height.
						count: { every: 0.02, least: 2, most: 6 },
						along: [0.5, 1],
						around: 'spiral',
						angle: 165,
						from: 'plumb',
						angleSpread: 6,
						length: {
							share: [
								[0, 0.22],
								[0.5, 0.1],
								[1, 0.04],
							],
						},
						vary: 0.15,
						radius: 0.12,
						taper: 0.3,
						bends: [{ from: 0, to: 0.15, level: -90 }],
						sway: 0,
						elbows: 1,
						patch: { kind: 'hang', width: 0.07, depth: 0.05, along: 0, sockets: DOWN_A_FALL },
					},
					{
						name: 'side',
						role: 'branch',
						// Still 05: one limb with six side branches in view, alternate, on its outer two
						// thirds.
						count: { every: 0.015, least: 4, most: 16 },
						along: [0.15, 0.93],
						stagger: 0.2,
						around: 'sides',
						jitter: 14,
						// Stills 21 and 08: an arm leaves at 25 to 35 degrees from its axis; still 05: a
						// side branch leaves its limb at about 50.
						angle: [
							[0, 52],
							[1, 40],
						],
						from: 'parent',
						angleSpread: 6,
						// Still 05: the side branches shorten toward the limb's end.
						length: {
							parent: [
								[0, 0.45],
								[1, 0.32],
							],
						},
						vary: 0.12,
						radius: 0.45,
						taper: 0.3,
						// Stills 21 and 22: an arm rises, arches over and ends pointing down.
						bends: [{ from: 0.12, to: 1, level: -40 }],
						sway: 9,
						elbows: 4,
						// Still 09: a side branch carries strands 17 to 28 cm long along its run, and still 19
						// up to a metre at its end.
						patch: {
							kind: 'hang',
							width: 0.08,
							depth: 0.06,
							offset: -0.5,
							along: 0.05,
							sockets: ALONG_AN_END,
						},
						children: [twigs],
					},
				],
			},
			{
				name: 'top',
				role: 'branch',
				// The leader's top 0.15 of the height carries branch ends directly, at a limb's spacing.
				count: 8,
				along: [0.9, 0.99],
				stagger: 0.2,
				around: 'spiral',
				jitter: 8,
				angle: [
					[0, 34],
					[1, 26],
				],
				from: 'plumb',
				angleSpread: 3,
				// Still 01: the crown is 0.13 of the height in half width at 0.90 and 0.04 at 0.98.
				length: { outline: 0.7 },
				vary: 0.08,
				// Still 19: a branch end is half a metre long at the least.
				least: 0.025,
				radius: 0.4,
				taper: 0.3,
				bends: [{ from: 0.5, to: 1, level: -30 }],
				sway: 8,
				elbows: 5,
				patch: {
					kind: 'hang',
					width: 0.05,
					depth: 0.05,
					offset: -0.5,
					along: 0.2,
					sockets: ALONG_AN_END,
				},
			},
		],
	},
};

/**
 * The share of the rows that bear catkins: the record's 0.08 of the old grower's 6,174 rows at seed 11
 * over the frame's 4,457, so the tree hangs the catkins the record means.
 */
const CATKIN_SHARE = (0.08 * 6174) / 4457;

/** The record's catkins, hung at the frame's share of its rows. */
const catkins = (extra: ExtraSpec): ExtraSpec =>
	extra.kind === 'fruit' && extra.at === 'shoot-tip' ? { ...extra, share: CATKIN_SHARE } : extra;

/**
 * The silver birch's record with the frame as its growth and a spray at each socket. The shoot
 * rows are working figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45, piece: 'spray' }),
	// The frame's trunk already flares to still 01's foot, so the stem base adds no flare of its own
	// and keeps still 14's low lobes and roots.
	base: { ...record.base, flare: { amount: 0, height: 0.4 } },
	extras: record.extras?.map(catkins),
	pieces: PIECES.filter((piece) => piece.name === 'spray'),
};
