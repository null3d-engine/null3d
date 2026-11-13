// The silver birch as a directed frame: one plumb leader to the tip, twelve thin limbs that leave it
// one at a time, and the side branches whose ends arch over and hang. Each figure names the
// reference picture it was read on. Shares are of the tree's height, measured from the true foot of
// each picture. Still 01 and the whole-tree turning video are the one tree the frame follows.
import type { FrameSpec } from '../../grow/frame';

/** The silver birch's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in 24 bands from the top down, each at its own height.
	outline: [
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
	plan: { narrow: 0.8, turn: 0 },
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
		patch: { kind: 'hang', width: 0.05, depth: 0.05 },
		children: [
			{
				name: 'limb',
				role: 'limb',
				// Stills 01 and 18: 11 to 12 limbs show in outline, leaving from 0.39 to 0.85 of the height
				// at even steps of about 0.04. The shares here are of the leader's own length.
				count: 12,
				along: [0.4, 0.872],
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
				// Still 01: the wood shows to 250 px of a 355 px half width.
				length: { outline: 0.7 },
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
							[0, -40],
							[0.5, -8],
							[1, 12],
						],
					},
				],
				// Still 06: a limb's line shifts a little to one side and the other along its run.
				sway: 10,
				elbows: 5,
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
				},
				children: [
					{
						name: 'side',
						role: 'branch',
						// Still 05: one limb with six side branches in view, alternate, on its outer two
						// thirds.
						count: { every: 0.04, least: 2, most: 6 },
						along: [0.36, 0.93],
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
								[0, 0.4],
								[1, 0.2],
							],
						},
						vary: 0.12,
						radius: 0.45,
						taper: 0.3,
						// Stills 21 and 22: an arm rises, arches over and ends pointing down.
						bends: [{ from: 0.3, to: 1, level: -65 }],
						sway: 9,
						elbows: 4,
						// Still 09: a side branch carries strands 17 to 28 cm long, and still 19 up to a
						// metre at its end.
						patch: { kind: 'hang', width: 0.08, depth: 0.06, offset: -0.5 },
					},
				],
			},
			{
				name: 'top',
				role: 'branch',
				// The leader's top 0.15 of the height carries branch ends directly, at a limb's spacing.
				count: 5,
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
				radius: 0.4,
				taper: 0.3,
				bends: [{ from: 0.5, to: 1, level: -30 }],
				sway: 8,
				elbows: 4,
				patch: { kind: 'hang', width: 0.05, depth: 0.05, offset: -0.5 },
			},
		],
	},
};
