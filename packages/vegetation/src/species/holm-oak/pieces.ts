// The holm oak's pieces: the bare forked branch end with leaf tufts its sockets carry, and the leafy
// shoot at its top. Each value names the reference picture it was measured on. On still 21 a tuft
// is 20 to 25 centimetres across and a leaf about 6.5 centimetres, against the record's 8, so a piece
// draws its leaves at 0.8 of the record's until the record's own length moves. Acorns are not part
// of a piece yet.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 6.5 centimetres measured on still 21, over 8. */
const LEAF_SCALE = 0.8;

/**
 * The tuft at an arm's end. Stills 10, 11 and 23: fourteen to sixteen leaves crowd toward the shoot's
 * tip round a bud cluster, standing 45 to 60 degrees from the stem, the tip ones nearly along it.
 */
function tuft(length: number, leaves: number, run: number): PieceLeaves {
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: [
			[1 - run / length, 62],
			[1, 30],
		],
		angleSpread: 8,
		scale: LEAF_SCALE,
	};
}

/** A short side twig of a tuft. Still 09: 5 to 12 centimetres long at 50 to 70 degrees, eight to twelve leaves. */
const SIDE_TWIG: PieceStem = {
	length: { mean: 0.1, spread: 0.03 },
	radius: [0.0015, 0.001],
	leaves: tuft(0.1, 10, 0.06),
};

/** An arm of the Y. Still 21: bare, a little bent, with a tuft at its end and one fork of its own. */
function arm(length: number, forks: boolean): PieceStem {
	return {
		length: { mean: length, spread: 0.04 },
		radius: [0.006, 0.002],
		kink: { length: 0.16, angle: 10 },
		leaves: tuft(length, 14, 0.1),
		sides: [
			{
				stem: SIDE_TWIG,
				// A fuller tuft passes the prototype's vertex limit at the finest tier: with a side twig
				// each 3.5 centimetres the branch end holds over 300 leaves.
				gap: 0.05,
				from: 1 - 0.16 / length,
				to: 0.97,
				arrangement: 'spiral',
				angle: { mean: 60, spread: 10 },
			},
			...(forks
				? [
						{
							stem: arm(length * 0.5, false),
							gap: length,
							from: 0,
							to: 1,
							arrangement: 'alternate' as const,
							angle: { mean: 55, spread: 6 },
						},
					]
				: []),
		],
	};
}

/** The holm oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a bare grey Y a metre tall. The stem forks at a fifth of its height and each arm
	// forks again at half its own, about 30 degrees a side. Four large tufts and two small ones, each
	// at an arm's end. The piece is as wide as it is tall.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		stem: {
			...arm(0.9, false),
			radius: [0.009, 0.002],
			sides: [
				...(arm(0.9, false).sides ?? []),
				{
					stem: arm(0.7, true),
					gap: 0.44,
					from: 0,
					to: 0.5,
					arrangement: 'alternate',
					angle: { mean: 58, spread: 5 },
				},
				{
					stem: arm(0.35, false),
					gap: 0.9,
					from: 0.1,
					to: 1,
					arrangement: 'alternate',
					angle: { mean: 55, spread: 5 },
				},
			],
		},
	},
	// Still 22: a shoot 35 centimetres long with fifteen to twenty leaves, one each 1.5 centimetres,
	// and four to five side shoots at 40 to 50 degrees.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.0025, 0.001],
			leaves: { gap: 0.016, from: 0.2, angle: 52, angleSpread: 8, scale: LEAF_SCALE },
			sides: [
				{
					stem: {
						length: { mean: 0.1, spread: 0.02 },
						radius: [0.0015, 0.001],
						leaves: { gap: 0.016, from: 0.2, angle: 52, angleSpread: 8, scale: LEAF_SCALE },
					},
					gap: 0.055,
					from: 0.3,
					to: 0.8,
					arrangement: 'spiral',
					angle: { mean: 45, spread: 5 },
				},
			],
		},
	},
];

/** The studio photographs of the holm oak's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
