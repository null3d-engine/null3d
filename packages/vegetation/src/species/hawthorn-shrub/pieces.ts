// The hawthorn's pieces: the zigzag branch end with leaf tufts on short spurs its sockets carry, and
// the twig at its top. Each value names the reference picture it was measured on. Thorns, haws and
// flowers are not part of a piece yet.
//
// Still 21 is stated as a metre tall, but read at full size its leaves are a tenth of its height
// and its longest thorn another tenth. With the record's leaf of 3.5 centimetres the pictured branch
// is 36 centimetres tall, its longest thorn 3.6 centimetres and its cut 1.3 centimetres thick, all of
// them a hawthorn's own sizes. The piece keeps the leaf's true size and the photograph's proportions.
import type { PieceLeaves, PieceRule, PieceSides, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * The spurs along a stem. Stills 21 and 22: alternate, one each 6 to 8 centimetres on a branch and
 * each 3 to 4 on a twig, 1 to 3 centimetres long. Stills 11 and 23: each carries one tuft of five
 * to seven leaves round its buds.
 */
function spurs(gap: number, from: number): PieceSides {
	return {
		stem: {
			length: { mean: 0.02, spread: 0.008 },
			radius: [0.0015, 0.001],
			leaves: { gap: 0.0028, from: 0.25, angle: 58, angleSpread: 12 },
		},
		gap,
		from,
		to: 0.98,
		arrangement: 'alternate',
		angle: { mean: 60, spread: 12 },
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
		fan: { reach: 110, tilt: 25 },
	};
}

/**
 * An arm of the branch. Still 21: it zigzags a little each four to five centimetres, carries a tuft
 * on a short spur each 5.4 centimetres to one side and the other, and ends in a tuft.
 */
function arm(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.06 },
		radius: [0.003, 0.0012],
		kink: { length: 0.045, angle: 16 },
		leaves: tuft(length, 4),
		sides: [
			{
				stem: {
					length: { mean: 0.012, spread: 0.004 },
					radius: [0.0012, 0.0009],
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
		stem: {
			length: 0.155,
			radius: [0.0065, 0.004],
			bud: false,
			sides: [
				fork(arm(0.205), 1, 0.155, 37, true),
				fork(arm(0.225), 0.97, 0.155, 33),
				fork(arm(0.18), 0.47, 0.155, 60),
				fork(arm(0.04), 0.3, 0.155, 50, true),
			],
		},
	},
	// Still 22: a twig 35 centimetres long with a node each 3 to 4 centimetres and seven tufts.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.33, spread: 0.03 },
			radius: [0.0025, 0.001],
			kink: { length: 0.04, angle: 14 },
			leaves: { gap: 0.004, from: 0.93, angle: 55, angleSpread: 12 },
			sides: [spurs(0.05, 0.2)],
		},
	},
];

/** The studio photographs of the hawthorn's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
