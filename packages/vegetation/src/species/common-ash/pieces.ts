// The common ash's pieces: the stout upright branch end its sockets carry, with one pair of leaves
// under the bud at each of its ends, and the twig at its top. Each value names the reference picture
// it was measured on. Still 21 is weak by its own index note (six leaves in one plane), and its
// turning video shows the same six, so the branch end carries them and no more.
//
// On still 21 a leaf is about 20 centimetres long against the record's 26, so a piece draws its
// leaves at 0.8 of the record's until the record's own length moves.
import {
	oneMark,
	type PieceLeaves,
	type PieceRule,
	type PieceStudio,
	withMarks,
} from '../../leaf/piece';

/** A piece's leaf over the record's: 20 centimetres measured on still 21, over 26. */
const LEAF_SCALE = 0.8;

/**
 * A tip bunch. Stills 04, 22 and 23: two to three opposite pairs of leaves under the end bud, each
 * pair crossed with the next, the pairs 2 to 5 centimetres apart, the leaves 50 to 70 degrees off
 * the shoot.
 */
function bunch(length: number, pairs: number): PieceLeaves {
	const gap = 0.035;
	return {
		gap,
		from: 1 - (gap * pairs) / length,
		phyllotaxis: { kind: 'opposite', decussate: true },
		angle: 60,
		angleSpread: 8,
		scale: LEAF_SCALE,
		// The sub-branch's turning video: edge on it is a third as wide as face on, so its crossed
		// pairs lean most of the way into the twig's plane.
		flat: 0.9,
	};
}

/**
 * The one pair of leaves under an end's bud. Still 21 and its turning video: each of the cut
 * branch's three ends carries one opposite pair just behind its bud and no leaf below it. Face on,
 * every blade shows its whole face. Edge on, the branch is 0.145 as wide as it is tall: each leaf
 * leans a few degrees to the front or the back and shows a third to a half of its face.
 *
 * @param length The stem's length in metres.
 * @param angle Degrees each leaf stands from its stem.
 * @param heading Degrees round its stem the pair stands off the branch's own plane.
 * @param size The leaf's length over a full leaf's.
 * @param hang The share by which the pair hangs toward the branch's foot.
 */
function endPair(
	length: number,
	angle: number,
	heading: number,
	size: number,
	hang: number,
): PieceLeaves {
	const gap = 0.035;
	return {
		gap,
		// Only the node nearest the tip stands this close to it.
		from: 1 - (0.8 * gap) / length,
		phyllotaxis: { kind: 'opposite', decussate: true },
		heading,
		angle,
		angleSpread: 5,
		scale: LEAF_SCALE * size,
		hang,
		face: { turn: 25, spread: 8, inPlane: true },
	};
}

/** The common ash's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21, read at full size: a straight stem with one exactly opposite pair of side shoots at
	// 0.43 of its height. Each side shoot is 0.14 of the height long, stands 60 to 68 degrees from
	// the stem and ends in a black bud; the stem ends in a third. Six leaves: one pair at each end.
	{
		name: 'branch-end',
		attitude: 'upright',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.18 as wide as face on.
		depth: 5,
		stem: {
			length: { mean: 0.6, spread: 0.05 },
			// Still 21: the stem is 0.03 of the picture's height thick (19 to 23 of 683 pixels).
			radius: [0.0088, 0.006],
			// The top pair stands 77 degrees from the stem, and its leaves are 0.28 of the height long
			// against the side pairs' 0.34.
			leaves: endPair(0.6, 74, 2, 0.82, 0),
			sides: [
				{
					stem: {
						length: { mean: 0.085, spread: 0.01 },
						radius: [0.0045, 0.0035],
						// The pair's upper leaf stands about 70 degrees from the branch's line and its
						// lower leaf about 130, so the pair hangs toward the foot of the branch.
						leaves: endPair(0.085, 33, 4, 1, 0.4),
					},
					// One pair only: the next place along the stem falls past the last share.
					gap: 0.3,
					from: 0.18,
					to: 0.8,
					// The cut branch's turning video: every pair goes edge on together, so the side
					// shoots lie in one plane.
					arrangement: 'paired',
					angle: { mean: 64, spread: 4 },
				},
			],
		},
	},
	// Still 22: a twig 35 centimetres long with one wide pair of leaves and a crossed pair above it,
	// under a small end bud.
	{
		name: 'twig',
		attitude: 'up',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			// Still 22: the twig is 0.04 of its height thick (28 of 693 pixels).
			radius: [0.007, 0.005],
			leaves: { ...bunch(0.35, 2), gap: 0.12, from: 0.3 },
		},
	},
];

/**
 * The pieces in fruit. Still 19: dense hanging bunches of 30 to 60 flat keys, each 3.5 to 4
 * centimetres long and a fifth as wide, a bunch 12 to 15 centimetres long, from a node behind the
 * end leaves. A bunch is three rings of keys on stalks of three lengths.
 */
export const FRUIT_PIECES: readonly PieceRule[] = PIECES.map((rule) =>
	withMarks(rule, (stem, order) =>
		order === 0
			? [0.03, 0.06, 0.09].map((stalk) =>
					oneMark(
						{
							kind: 'body',
							share: 1,
							length: { mean: 0.037, spread: 0.004 },
							width: 0.007,
							stalk,
							count: { mean: 14, spread: 3 },
						},
						stem.length,
						0.75,
						0.95,
					),
				)
			: undefined,
	),
);

/** The studio photographs of the ash's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
	{ still: 9, piece: 'branch-end' },
];
