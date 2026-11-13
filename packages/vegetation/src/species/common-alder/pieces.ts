// The common alder's pieces: the branch end its sockets carry and the forked twig at its top. Each
// value names the reference picture it was measured on. The cones and catkins are not part of a
// piece yet.
//
// The cut branch of still 21 is a metre tall over 725 pixels, which makes its round leaf 9 to 10
// centimetres across (65 to 75 pixels at full size), inside the species' 4 to 10. The record's leaf
// is 7, so a piece draws its leaves at 1.3 of that until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 9.5 centimetres measured on still 21, over 7. */
const LEAF_SCALE = 1.3;

/**
 * The leaves along a shoot. Still 21: alternate, four to six on a side shoot of 15 to 25 centimetres,
 * one each 4.5 centimetres, held 50 to 70 degrees off the shoot, their faces open to the branch's sky
 * side. About forty leaves on the branch.
 */
function leaves(from: number, scale = LEAF_SCALE, flat = 0.7): PieceLeaves {
	// The sub-branch's turning video: edge on the twig is a fifth as wide as face on, so its leaves
	// lean most of the way into its plane.
	return { gap: 0.045, from, angle: 60, angleSpread: 10, skyward: 0.9, scale, flat };
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
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.29 as wide as face on.
		depth: 16,
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
					angle: { mean: 46, spread: 4 },
				},
				{
					stem: SHOOT,
					gap: 0.14,
					from: 0.42,
					to: 0.9,
					arrangement: 'alternate',
					// The arm leaves to the right, so the stem's own shoots start on the left.
					turn: 180,
					angle: { mean: 45, spread: 5 },
				},
			],
		},
	},
	// Still 22: a twig 35 centimetres long, forked once at a third of its length, with eleven leaves,
	// each a fifth of the twig long: 7 centimetres, the record's own leaf.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.0025, 0.001],
			leaves: leaves(0.2, 1, 0.85),
			sides: [
				{
					stem: {
						length: { mean: 0.2, spread: 0.02 },
						radius: [0.002, 0.001],
						leaves: leaves(0.15, 1, 0.85),
					},
					gap: 0.1,
					from: 0.25,
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
