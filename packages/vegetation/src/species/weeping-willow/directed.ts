// The weeping willow as a directed frame: a short thick trunk that divides low into three great
// limbs, the limbs each of those divides into (one that carries on upward and two that arch outward
// and run level), their branches, which arch over to the crown's edge, and the whips that hang from
// the arching wood to the hem. Each figure names the
// reference picture it was read on. Shares are of the tree's height. Still 01 and the whole-tree
// turning video are the one tree the frame follows; still 18 shows the limbs' course best.
import type { FrameBranchRule, FrameLength, FrameSpec } from '../../grow/frame';

/**
 * A whip: a hanging axis of the frame, which carries the strands at sockets along it. Stills 19 and
 * 21: it leaves the upper side or the flank of its branch and is plumb within a few centimetres.
 * Still 01: a single fall can be followed for 0.25 to 0.35 of the height, and the hem stands 0.03 to
 * 0.08 above the ground, so a whip runs to the hem or to its greatest length, whichever is shorter.
 */
function whips(along: readonly [number, number], every: number, most: number): FrameBranchRule {
	return {
		name: 'whip',
		role: 'whip',
		count: { every, least: 2, most },
		along,
		stagger: 0.3,
		around: 'spiral',
		// It leaves hanging, a little off plumb, on every side of its branch in turn.
		angle: 165,
		from: 'plumb',
		angleSpread: 6,
		length: {
			height: [
				[0, 0.04],
				[1, 0.07],
			],
		},
		vary: 0.06,
		most: 0.35,
		// Still 10: a strand's stem is 2 mm; a whip is the thicker axis that carries them.
		radius: 0.3,
		taper: 0.4,
		bends: [{ from: 0, to: 0.12, level: -90 }],
		// A whip hangs by its own weight, so it runs plumb and straight.
		sway: 0,
		elbows: 1,
		// Still 09: side strands 0.45 to 0.5 m long leave a whip to both sides along its whole run.
		patch: { kind: 'hang', width: 0.07, depth: 0.1, along: 0 },
	};
}

/**
 * The branches of a limb: each leaves its arching part, rises, arches over and ends at the crown's
 * edge, and the whips hang from it. Stills 05 and 08: a limb's whips hang from its branches. Stills
 * 01 and 18: the crown's top is a row of rounded heads where branches arch over, and below the
 * widest row the curtain's sides are plumb, so the outermost wood stands at the crown's edge.
 */
function branches(
	around: FrameBranchRule['around'],
	lift: number,
	along: readonly [number, number],
	length: FrameLength,
): FrameBranchRule {
	return {
		name: 'branch',
		role: 'branch',
		count: { every: 0.05, least: 2, most: 6 },
		along,
		stagger: 0.25,
		around,
		lift,
		jitter: 15,
		// Still 08: an arm leaves at about 55 degrees and arches to level and on over.
		angle: [
			[0, 60],
			[1, 45],
		],
		from: 'parent',
		angleSpread: 6,
		length,
		vary: 0.05,
		most: 0.45,
		radius: 0.5,
		taper: 0.3,
		bends: [{ from: 0.1, to: 0.8, level: -68 }],
		sway: 10,
		elbows: 4,
		children: [whips([0.3, 1], 0.04, 6)],
	};
}

/** The weeping willow's frame. */
export const frame: FrameSpec = {
	// Still 18, the outline's half width in 24 bands from the top down, each at its own height.
	outline: [
		[0, 0.5],
		[0.021, 0.555],
		[0.063, 0.66],
		[0.146, 0.675],
		[0.229, 0.695],
		[0.313, 0.7],
		[0.354, 0.715],
		[0.396, 0.715],
		[0.438, 0.705],
		[0.479, 0.685],
		[0.521, 0.665],
		[0.563, 0.655],
		[0.604, 0.65],
		[0.646, 0.615],
		[0.688, 0.555],
		[0.729, 0.54],
		[0.771, 0.515],
		[0.813, 0.465],
		[0.854, 0.405],
		[0.896, 0.31],
		[0.938, 0.21],
		[0.979, 0.16],
		[1, 0],
	],
	// The crown is built nearly round. Still 01 looks across the wide side.
	plan: { narrow: 0.8, turn: 0 },
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.23 wide at the ground and 0.14 to 0.15 at a tenth of the height.
		width: [
			[0, 0.23],
			[0.04, 0.165],
			[0.1, 0.145],
			[0.17, 0.14],
		],
		// Stills 01 and 02: the trunk divides at 0.17 of the height.
		length: { share: 0.17 },
		// Stills 15 and 17: no lean and no bend.
		sway: 2,
		elbows: 2,
		children: [
			{
				name: 'great',
				role: 'limb',
				// Stills 01 and 02: three great limbs, all from the one fork.
				count: 3,
				along: [1, 1],
				// Stills 06 and 03: the limbs stand round the trunk.
				around: 'ring',
				first: 0,
				jitter: 10,
				// Still 01: 160 px out for 270 px up.
				angle: 31,
				from: 'plumb',
				angleSpread: 4,
				// Still 18: they divide again at 0.45 to 0.5 of the height.
				length: { height: 0.47 },
				// Stills 01 and 07: half the bole's width where it leaves.
				radius: 0.5,
				taper: 0.75,
				// Still 18: straight for the first third, then a slow S.
				bends: [
					{ from: 0.33, to: 0.66, by: 10 },
					{ from: 0.66, to: 1, by: -10 },
				],
				sway: 8,
				elbows: 4,
				children: [
					{
						name: 'upper',
						role: 'limb',
						// Stills 01 and 18: over the fork of each great limb one limb carries on upward
						// and arches over under the crown's top.
						count: 1,
						along: [1, 1],
						around: 'sides',
						lift: 90,
						jitter: 20,
						// Still 18: the carrying limb turns back toward the tree's middle and stands a
						// little past plumb.
						angle: 36,
						from: 'parent',
						angleSpread: 4,
						// Still 18: the highest wood arches over the tree's middle just under the crown's
						// top.
						length: { height: 0.95 },
						radius: 0.55,
						taper: 0.2,
						bends: [{ from: 0.45, to: 1, by: 55 }],
						sway: 10,
						elbows: 5,
						// The top limbs stand at the crown's edge already, so their branches take a share
						// of the limb's own length.
						children: [
							branches('sides', 15, [0.45, 0.9], {
								parent: [
									[0, 0.45],
									[1, 0.3],
								],
							}),
							whips([0.6, 1], 0.04, 5),
						],
					},
					{
						name: 'secondary',
						role: 'limb',
						// Still 18: 6 to 8 secondary limbs in one view. Two leave each great limb, one to
						// each side, so the six stand evenly round the tree.
						count: 2,
						along: [1, 1],
						around: 'sides',
						lift: -10,
						jitter: 8,
						// Still 08: a limb divides in a narrow Y.
						angle: 21,
						from: 'parent',
						angleSpread: 3,
						// Still 18: the wood reaches 0.76 of the crown's half width.
						length: { outline: 0.76 },
						vary: 0.05,
						radius: 0.55,
						taper: 0.3,
						// Still 18: each arches outward and runs level at 0.55 to 0.75 of the height.
						bends: [{ from: 0.3, to: 0.95, level: 5 }],
						sway: 10,
						elbows: 5,
						children: [
							branches('sides', 45, [0.3, 0.92], { outline: 0.97 }),
							whips([0.55, 1], 0.045, 6),
						],
					},
				],
			},
		],
	},
};
