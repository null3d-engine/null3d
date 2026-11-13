// The European beech as a directed frame: a thick short trunk that carries on as a centre column,
// four great limbs that leave it singly below the column's top and three that divide from the top,
// each limb's boughs, and the level tiers of foliage the boughs and their sprays carry. Each figure
// names the reference picture it was read on. Shares are of the tree's height. Still 01 and the
// whole-tree turning video are the one tree the frame follows; still 18 shows the limbs' course.
import {
	evenOutline,
	type FrameBend,
	type FrameBranchRule,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { record } from './record';

/**
 * A level tier of foliage. Still 01: seven or eight tiers can be counted down each side, each 0.07
 * to 0.10 of the height thick, parted by shade.
 */
const tier = (width: number) => ({ kind: 'tier', width, depth: 0.08 }) as const;

/**
 * The boughs of a great limb and their sprays. Stills 05 and 06: foliage sits on the outer half of
 * every limb and on all its branches, and the inner half is bare. A bough leaves its limb, turns
 * level and ends at the crown's edge under a tier; its sprays lie beside it in the same tier.
 */
function boughs(ends: readonly FrameBend[]): FrameBranchRule {
	return {
		name: 'bough',
		role: 'branch',
		count: { every: 0.045, least: 4, most: 9 },
		along: [0.3, 0.94],
		stagger: 0.25,
		// Still 05: boughs leave a limb on every side, and each turns level.
		around: 'spiral',
		jitter: 15,
		// Still 08: a fork opens about 40 degrees; a bough stands wider off its limb.
		angle: [
			[0, 55],
			[1, 40],
		],
		from: 'parent',
		angleSpread: 6,
		// Still 01: the tiers' ends are the outline's scallops.
		length: { outline: 0.95 },
		vary: 0.05,
		least: 0.08,
		most: 0.48,
		radius: 0.5,
		taper: 0.3,
		bends: [{ from: 0.1, to: 0.55, level: 2 }, ...ends],
		sway: 14,
		elbows: 4,
		patch: tier(0.22),
		children: [
			{
				name: 'spray',
				role: 'branch',
				count: { every: 0.07, least: 1, most: 4 },
				along: [0.35, 0.9],
				stagger: 0.25,
				around: 'sides',
				jitter: 12,
				angle: 50,
				from: 'parent',
				angleSpread: 6,
				length: {
					parent: [
						[0, 0.4],
						[1, 0.25],
					],
				},
				vary: 0.1,
				radius: 0.5,
				taper: 0.3,
				bends: [{ from: 0.1, to: 0.6, level: 0 }],
				sway: 14,
				elbows: 3,
				patch: tier(0.16),
			},
		],
	};
}

/** The European beech's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in 24 bands from the top down, each at its own height.
	outline: evenOutline(
		[
			[0.021, 0.39],
			[0.063, 0.655],
			[0.104, 0.685],
			[0.188, 0.71],
			[0.271, 0.695],
			[0.354, 0.69],
			[0.438, 0.665],
			[0.521, 0.635],
			[0.604, 0.615],
			[0.688, 0.585],
			[0.729, 0.535],
			[0.771, 0.525],
			[0.813, 0.465],
			[0.854, 0.435],
			[0.896, 0.37],
			[0.938, 0.275],
			[0.979, 0.175],
			[1, 0],
		],
		// The crown is built nearly round. Still 01 looks across the wide side.
		0.8,
	),
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.26 wide at the ground, 0.118 at breast height and 0.104 at mid bole. Still 17:
		// the bole barely thins below the first limbs.
		width: [
			[0, 0.26],
			[0.04, 0.15],
			[0.08, 0.118],
			[0.3, 0.104],
			[0.62, 0.08],
		],
		// Still 01: the centre column runs on to 0.62 of the height and divides there.
		length: { share: 0.62 },
		// Stills 01, 17 and 03: no lean and no bend.
		sway: 1.5,
		elbows: 3,
		children: [
			{
				name: 'low',
				role: 'limb',
				// Still 01: a low pair leaves at 0.26 to 0.32 of the height and a middle pair at 0.38
				// to 0.43. The shares here are of the column's own length.
				count: 4,
				along: [0.44, 0.68],
				stagger: 0.2,
				// Stills 05 and 03: single, each at its own height, a quarter turn on from the last, so
				// the four stand on every side of the trunk.
				around: 'ring',
				jitter: 10,
				// Still 01: the low limbs leave at 55 to 60 degrees from plumb and the middle ones at
				// 40 to 45.
				angle: [
					[0, 58],
					[0.34, 56],
					[0.66, 44],
					[1, 41],
				],
				from: 'plumb',
				angleSpread: 3,
				// Stills 01 and 18: the wood shows to 0.6 and to 0.8 of the crown's half width.
				length: { outline: 0.7 },
				vary: 0.05,
				// Still 01: 0.47 of the bole where it leaves.
				radius: 0.47,
				taper: 0.25,
				// Stills 01 and 18: a slow even rise, then level; the low limbs' ends dip below level
				// over their last quarter.
				bends: [
					{
						from: 0.12,
						to: 0.7,
						level: [
							[0, -4],
							[0.34, 2],
							[0.66, 22],
							[1, 26],
						],
					},
					{
						from: 0.75,
						to: 1,
						by: [
							[0, 30],
							[0.34, 24],
							[0.66, 6],
							[1, 4],
						],
					},
				],
				sway: 12,
				elbows: 5,
				patch: tier(0.24),
				// Still 01: the low boughs' ends hang to a skirt close to the grass.
				children: [boughs([{ from: 0.5, to: 1, by: 48 }])],
			},
			{
				name: 'upper',
				role: 'limb',
				// Still 01: two or three steep limbs divide from the column's top.
				count: 3,
				along: [1, 1],
				around: 'ring',
				jitter: 12,
				// Still 01: 15 to 30 degrees from plumb.
				angle: 24,
				from: 'plumb',
				angleSpread: 5,
				// The upper limbs' ends are the crown's highest wood.
				length: { outline: 0.95 },
				vary: 0.05,
				radius: 0.55,
				taper: 0.25,
				// Still 01: the upper limbs sweep up and outward in one slow curve.
				bends: [{ from: 0.15, to: 0.9, level: 42 }],
				sway: 12,
				elbows: 5,
				patch: tier(0.22),
				children: [boughs([{ from: 0.7, to: 1, by: 8 }])],
			},
		],
	},
};

/**
 * The European beech's record with the frame as its growth. A socket holds four shoot rows that fan 45
 * degrees from its line. These two are working figures, not measured ones: they stand until the
 * species' branch pieces are placed at its sockets, which then state what a socket holds.
 */
export const directed = framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45 });
