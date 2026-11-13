// The hawthorn's pieces: the zigzag branch end with leaf tufts on short spurs its sockets carry, and
// the twig at its top. Each value names the reference picture it was measured on. Thorns, haws and
// flowers are not part of a piece yet.
//
// Still 21 is stated as a metre tall, but its leaf tufts are a sixth of its height across. With the
// record's leaf of 3.5 centimetres a tuft is 8 centimetres, so the pictured branch is half a metre.
// The piece keeps the leaf's true size and the photograph's proportions.
import type { PieceRule, PieceSides, PieceStudio } from '../../leaf/piece';

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

/** The hawthorn's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a zigzag axis half a metre long that forks low into two arms about 50 degrees apart, with
	// about fourteen tufts on spurs. The tufts stand apart and the ground shows between them.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.5, spread: 0.04 },
			radius: [0.004, 0.0015],
			kink: { length: 0.045, angle: 16 },
			leaves: { gap: 0.004, from: 0.955, angle: 55, angleSpread: 12 },
			sides: [
				spurs(0.055, 0.25),
				{
					stem: {
						length: { mean: 0.36, spread: 0.04 },
						radius: [0.003, 0.0015],
						kink: { length: 0.045, angle: 16 },
						leaves: { gap: 0.004, from: 0.94, angle: 55, angleSpread: 12 },
						sides: [spurs(0.055, 0.2)],
					},
					gap: 0.3,
					from: 0,
					to: 0.4,
					arrangement: 'alternate',
					angle: { mean: 48, spread: 5 },
				},
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
