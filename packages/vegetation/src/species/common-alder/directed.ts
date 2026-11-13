// The common alder as a directed frame: one plumb leader to the tip and sixteen slim branches that
// leave it one at a time, the lowest the longest, so the crown is a broad cone. Each figure names
// the reference picture it was read on. Shares are of the tree's height. Still 30 and the whole-tree
// turning video are the one tree the frame follows; still 01 is the same tree on a river bank.
import { evenOutline, type FrameSpec, framedRecord } from '../../grow/frame';
import { pieceRecord } from '../../leaf/piece';
import { PIECE_LEAF, PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a clump, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 0.82 m long and 0.6 m wide on a tree 20 m tall, so the sockets stand a
 * branch end's width apart over the clump's surface and a branch end's reach inside it, which closes
 * the crown to stills 01 and 02.
 */
const ENDS = { pitch: 0.6 / 20, reach: 0.82 / 20 } as const;

/** The common alder's frame. */
export const frame: FrameSpec = {
	// Still 30, the outline's half width in 24 bands from the top down, each at its own height. Two
	// bands that fall in a notch between clumps are left out, so the curve is the clumps' far edge.
	outline: evenOutline(
		[
			[0.21, 0.2],
			[0.229, 0.28],
			[0.271, 0.355],
			[0.313, 0.39],
			[0.396, 0.415],
			[0.438, 0.45],
			[0.479, 0.46],
			[0.521, 0.42],
			[0.604, 0.4],
			[0.646, 0.41],
			[0.688, 0.365],
			[0.729, 0.31],
			[0.771, 0.25],
			[0.813, 0.235],
			[0.854, 0.165],
			[0.896, 0.145],
			[0.938, 0.115],
			[0.979, 0.03],
			[1, 0],
		],
		// Still 30 looks across the wide side. The turning video: a quarter turn on, the crown is
		// about 0.65 as wide as tall against 0.85 at still 30's turn.
		0.72,
	),
	stems: {
		name: 'leader',
		count: 1,
		// Still 30: 0.046 wide at 0.02 of the height, 0.040 to 0.043 from 0.05 to 0.20, with surface
		// roots spreading at the ground. Stills 03 and 17: an even taper to a thin tip.
		width: [
			[0, 0.07],
			[0.02, 0.046],
			[0.05, 0.042],
			[0.2, 0.04],
			[0.5, 0.028],
			[0.8, 0.012],
			[1, 0.002],
		],
		// The leader's own tip carries a clump, whose fine wood and pieces make the tree's top.
		length: { height: 0.955 },
		// Stills 01 and 17: no lean and no bend.
		sway: 0.6,
		elbows: 4,
		patch: { kind: 'clump', width: 0.1, depth: 0.09, fill: ENDS },
		children: [
			{
				name: 'limb',
				role: 'limb',
				// Still 30: 7 to 8 branches show on each side in outline, leaving from 0.23 of the height
				// to the tip. A branch that points at the camera or away does not show in an outline,
				// so the tree carries about half as many again as the 16 seen. The shares here are of
				// the leader's own length.
				count: 24,
				along: [0.238, 0.975],
				stagger: 0.25,
				// Stills 07, 17 and 03: single, at clearly different heights, on every side.
				around: 'spiral',
				jitter: 8,
				// Stills 30, 18 and 17: the lowest leave at 70 to 85 degrees from plumb, the middle at
				// 60 to 70 and the upper at 40 to 55. Still 30: the lowest two end a little below the
				// height they leave at.
				angle: [
					[0, 88],
					[0.2, 80],
					[0.5, 68],
					[1, 48],
				],
				from: 'plumb',
				angleSpread: 4,
				// Still 30: the longest branches reach 0.46 of the height from the leader, and a clump
				// 0.12 across sits round each branch's end, so the wood ends 0.06 short of the outline.
				length: { outline: 0.87 },
				vary: 0.06,
				// Still 30: the highest branches are half a metre long at the least.
				least: 0.025,
				// Stills 07 and 17: 0.2 to 0.3 of the trunk at the join.
				radius: 0.25,
				taper: 0.2,
				// Stills 30 and 18: nearly straight; the low ones rise a little at the end.
				bends: [
					{
						from: 0.65,
						to: 1,
						by: [
							[0, -6],
							[0.5, -4],
							[1, 0],
						],
					},
				],
				// Still 03: a branch's line shifts a little to one side and the other along its run.
				sway: 10,
				elbows: 5,
				// Still 30: a clump is 0.10 to 0.15 of the height across.
				patch: { kind: 'clump', width: 0.16, depth: 0.12, fill: ENDS },
				children: [
					{
						name: 'side',
						role: 'branch',
						// Stills 05 and 09: side branches leave alternately from the middle of a branch
						// outward. A long low branch carries four or five and a top one a single one.
						count: { every: 0.035, least: 1, most: 7 },
						along: [0.3, 0.92],
						stagger: 0.2,
						around: 'sides',
						jitter: 12,
						// Still 09: side twigs leave at 40 to 60 degrees.
						angle: [
							[0, 55],
							[1, 42],
						],
						from: 'parent',
						angleSpread: 6,
						// Still 05: the side branches shorten toward the branch's end.
						length: {
							parent: [
								[0, 0.3],
								[1, 0.16],
							],
						},
						vary: 0.12,
						// Still 08: a low branch divides into arms of like width.
						radius: 0.5,
						taper: 0.3,
						bends: [{ from: 0.4, to: 1, by: -8 }],
						sway: 10,
						elbows: 3,
						// Still 30: the smaller clumps on a branch's side twigs.
						patch: { kind: 'clump', width: 0.12, depth: 0.09, fill: ENDS },
					},
				],
			},
		],
	},
};

/**
 * The common alder's record with the frame as its growth and the branch end of still 21 at each
 * socket, wearing the leaf on the stalk the pieces were measured with. The shoot rows are working
 * figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...pieceRecord(
		framedRecord(record, frame, {
			rows: { mean: 4, spread: 1 },
			fan: 45,
			piece: 'branch-end',
			// With every branch end's flat side to the sky, a crown seen from the side shows most of
			// its leaves slanted or edge on. Stills 07 and 17: the alder's leafy shoots face every way,
			// so each piece rolls up to a quarter turn either way about its own line and tilts a
			// little off the wood's.
			turn: { roll: 90, tilt: 25 },
		}),
		PIECE_LEAF,
	),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
};
