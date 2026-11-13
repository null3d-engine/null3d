// The common alder's pieces: the branch end its sockets carry and the forked twig at its top. Each
// value names the reference picture it was measured on. The cut branch of still 21 is a metre tall,
// which makes its leaf about 7 centimetres, the record's own leaf. The cones and catkins are not
// part of a piece yet.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * The leaves along a shoot. Still 21: alternate, one each 4 to 6 centimetres, held 50 to 70 degrees
 * off the shoot.
 */
function leaves(from: number): PieceLeaves {
	return { gap: 0.045, from, angle: 60, angleSpread: 10, skyward: 0.9 };
}

/** A side shoot. Still 21: 15 to 25 centimetres long with four to six leaves. */
const SHOOT: PieceStem = {
	length: { mean: 0.2, spread: 0.05 },
	radius: [0.002, 0.001],
	leaves: leaves(0.2),
};

/** An arm of the branch. Still 21: it carries three to four alternate side shoots at 40 to 50 degrees. */
function arm(length: number): PieceStem {
	return {
		length: { mean: length, spread: 0.05 },
		radius: [0.004, 0.0012],
		leaves: leaves(0.55),
		sides: [
			{
				stem: SHOOT,
				gap: 0.13,
				from: 0.25,
				to: 0.9,
				arrangement: 'alternate',
				angle: { mean: 45, spread: 5 },
			},
		],
	};
}

/** The common alder's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a straight stem a metre long that forks at a quarter of its height into two arms about
	// 40 degrees apart. About 40 leaves. The piece is 0.75 as wide as tall.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		stem: {
			...arm(1),
			radius: [0.006, 0.0012],
			sides: [
				{
					stem: arm(0.6),
					gap: 0.5,
					from: 0,
					to: 0.3,
					arrangement: 'alternate',
					angle: { mean: 38, spread: 4 },
				},
				{
					stem: SHOOT,
					gap: 0.14,
					from: 0.42,
					to: 0.9,
					arrangement: 'alternate',
					angle: { mean: 45, spread: 5 },
				},
			],
		},
	},
	// Still 22: a twig 35 centimetres long, forked once, with eleven leaves.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.0025, 0.001],
			leaves: leaves(0.2),
			sides: [
				{
					stem: {
						length: { mean: 0.2, spread: 0.02 },
						radius: [0.002, 0.001],
						leaves: leaves(0.15),
					},
					gap: 0.3,
					from: 0.1,
					to: 0.45,
					arrangement: 'alternate',
					angle: { mean: 40, spread: 4 },
				},
			],
		},
	},
];

/** The studio photographs of the alder's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
