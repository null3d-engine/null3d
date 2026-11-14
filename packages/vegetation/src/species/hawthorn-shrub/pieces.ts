// The hawthorn's pieces: the zigzag branch end with leaf tufts on short spurs its sockets carry, and
// the twig at its top, with a straight thorn at most nodes. Each value names the reference picture
// it was measured on. Haws and flowers are not part of a piece yet.
//
// Still 21 is stated as a metre tall, but read at full size its leaves are a tenth of its height
// and its longest thorn another tenth. With the record's leaf of 3.5 centimetres the pictured branch
// is 36 centimetres tall, its longest thorn 3.6 centimetres and its cut 1.3 centimetres thick, all of
// them a hawthorn's own sizes. The piece keeps the leaf's true size and the photograph's proportions.
import {
	oneMark,
	type PieceLeaf,
	type PieceLeaves,
	type PieceMark,
	type PieceRule,
	type PieceStem,
	type PieceStudio,
	withMarks,
} from '../../leaf/piece';

/**
 * The leaf the pieces wear: the record's, on the stalk the twig's photograph shows. The record's
 * leaf grows the crown the species ships, so it keeps its own stalk until a plant built of pieces
 * replaces that crown. Eight full leaves read at full size on still 22 stand on stalks 0.28 to 0.47
 * of their blade's length, with a median of 0.36: 1.25 centimetres on the record's 3.5 centimetre
 * blade.
 */
export const PIECE_LEAF: PieceLeaf = {
	// The photographs' leaves are three to four centimetres, and the branch end wears the top of
	// that range: a larger blade covers the crown more with the same leaves.
	length: { mean: 0.04, spread: 0.016 },
	stalk: 0.0125,
};

/**
 * The thorns along a stem. Stills 19, 21 and 22: one straight woody thorn at most nodes, one and a
 * half to four centimetres long, standing 70 to 90 degrees from the stem.
 */
function thorns(gap: number, share: number): PieceMark {
	return {
		kind: 'thorn',
		gap,
		from: 0.1,
		to: 0.95,
		share,
		length: { mean: 0.022, spread: 0.012 },
		width: 0.003,
		angle: 80,
	};
}

/** A tuft's leaves. Stills 21 and 11: three to five lobed leaves, open like a small flat rosette. */
function tuft(length: number, leaves: number): PieceLeaves {
	const run = Math.min(length, 0.012);
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: 58,
		// Still 21: a tuft holds one or two leaves a tenth of the branch's height long, the record's
		// own leaf, and the rest are young ones of half that.
		scale: [
			[1 - run / length, 1],
			[1, 0.45],
		],
		fan: { reach: 115, tilt: 28, cone: 35 },
	};
}

/**
 * A tuft's leaves on the twig. Still 22 at full size and its turning video: each view shows three
 * or four full leaves and one or two young ones, so a tuft holds about seven at a spur's end, 60 to 90 degrees from it, to every side. From the front and from the side
 * alike a tuft shows the leaves to its left and its right whole, so each blade lies in the plane of
 * its spur and its own midrib, as the pages of an open book lie round its spine. One or two leaves
 * are full size and the rest are young ones.
 */
function rosette(length: number, leaves: number): PieceLeaves {
	const run = Math.min(length, 0.012);
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: 75,
		angleSpread: 12,
		// Still 22: a full blade is 0.07 to 0.10 of the twig's height, the record's leaf 0.08.
		scale: [
			[1 - run / length, 1.15],
			[1, 0.75],
		],
		face: { turn: 90, spread: 25 },
	};
}

/**
 * An arm of the branch. Still 21: it zigzags a little each four to five centimetres, carries a tuft
 * on a short spur each 5.4 centimetres to one side and the other, and ends in a tuft.
 */
function arm(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.06 },
		radius: [0.004, 0.0015],
		// Still 21 at full size: no bud shows in a tuft, whose leaves hide its tip.
		bud: false,
		kink: { length: 0.045, angle: 16 },
		leaves: tuft(length, 4),
		marks: [thorns(0.054, 0.75)],
		sides: [
			{
				stem: {
					length: { mean: 0.012, spread: 0.004 },
					radius: [0.0012, 0.0009],
					bud: false,
					leaves: tuft(0.012, 4),
				},
				gap: 0.054,
				from: 0.2,
				to: 0.9,
				arrangement: 'alternate',
				angle: { mean: 60, spread: 12 },
			},
		],
	};
}

/** One arm that leaves a stem of `length` metres at a share of it, to the right or the left. */
function fork(stem: PieceStem, at: number, length: number, angle: number, left = false) {
	return {
		stem,
		gap: 0.04 * length,
		from: at - 0.04,
		to: at,
		arrangement: 'alternate' as const,
		angle: { mean: angle, spread: 4 },
		turn: left ? 180 : 0,
	};
}

/** The hawthorn's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21, read at full size, in shares of its height: a bare stem that forks at 0.43 into a left
	// arm (0.57 long, 37 degrees off the stem) and a right arm (0.63 long, 33 degrees). Below the
	// fork a third arm leaves to the right at 0.2 (0.5 long, 60 degrees) and a short twig to the left
	// at 0.13. Fourteen to fifteen tufts of three to five leaves, about sixty leaves. The piece is as
	// wide as it is tall.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		// The turning video of the cut branch: edge on it is 0.22 as wide as face on.
		depth: 12,
		stem: {
			length: 0.155,
			// Still 21: the stem is 0.03 of the branch's height thick at its cut (19 to 24 of 743 pixels).
			radius: [0.0055, 0.004],
			bud: false,
			// Still 21: the longest thorns stand on the stem, one below the fork a tenth of the
			// branch's height long.
			marks: [{ ...thorns(0.045, 1), length: { mean: 0.028, spread: 0.008 }, from: 0.3 }],
			sides: [
				fork(arm(0.205), 1, 0.155, 37, true),
				fork(arm(0.225), 0.97, 0.155, 33),
				fork(arm(0.18), 0.47, 0.155, 60),
				fork(arm(0.04), 0.3, 0.155, 50, true),
			],
		},
	},
	// Still 22 at full size, in shares of its height. A leaf is 0.07 to 0.09 of the height, so the
	// record's leaf of 3.5 centimetres makes the twig 0.44 metres. A stout stem that turns 25 to 30
	// to 40 degrees at each node, a node each 0.16. Four spurs leave to one side and the other
	// between 0.25 and 0.63, each 0.07 to 0.15 long at 60 degrees, and each ends in a tuft, as the
	// stem does: five tufts, about twenty-five leaves. A thorn stands nearly square to the stem at
	// most nodes, the long ones 0.12 of the height and the short ones 0.055. The twig is 0.58 as
	// wide as tall.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		// The turning video of the sub-branch: edge on it is 0.39 as wide as face on, and spurs show
		// to both sides of the stem in every frame.
		depth: 30,
		stem: {
			length: { mean: 0.43, spread: 0.03 },
			// Still 22: the twig is 0.025 of its height thick (16 to 20 of 725 pixels).
			radius: [0.0055, 0.002],
			kink: { length: 0.072, angle: 28 },
			marks: [{ ...thorns(0.072, 0.85), length: { mean: 0.04, spread: 0.014 }, angle: 88 }],
			leaves: rosette(0.43, 7),
			sides: [
				{
					stem: {
						length: { mean: 0.05, spread: 0.014 },
						radius: [0.0028, 0.0015],
						leaves: rosette(0.05, 7),
					},
					gap: 0.052,
					from: 0.22,
					to: 0.68,
					arrangement: 'alternate',
					angle: { mean: 60, spread: 8 },
				},
			],
		},
	},
];

/**
 * The pieces in fruit, the hawthorn's default season. Still 22 shows three to six flower buds on
 * stalks of one to two centimetres above each tuft; each becomes a round haw about nine millimetres
 * through, and the whole views show them red through the crown. No still shows a haw close.
 */
export const FRUIT_PIECES: readonly PieceRule[] = PIECES.map((rule) =>
	withMarks(rule, (stem) =>
		stem.leaves
			? [
					oneMark(
						{
							kind: 'body',
							share: 0.7,
							length: { mean: 0.009, spread: 0.001 },
							width: 0.009,
							stalk: 0.015,
							count: { mean: 4, spread: 2 },
						},
						stem.length,
						0.8,
						1,
					),
				]
			: undefined,
	),
);

/** The studio photographs of the hawthorn's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
