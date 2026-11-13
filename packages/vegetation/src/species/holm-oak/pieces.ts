// The holm oak's pieces: the leaf tuft its sockets carry at the ends of a bare forked branch, and the
// leafy shoot of a tuft's own top. Each value names the reference picture it was measured on. On still 21 a tuft
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
	length: { mean: 0.12, spread: 0.03 },
	radius: [0.0015, 0.001],
	leaves: tuft(0.12, 10, 0.07),
};

/** A bare arm of the Y. Still 21: grey, a little bent, 0.6 to 0.7 of its parent's thickness. */
function arm(length: number, radius: number, sides: PieceStem['sides'] = []): PieceStem {
	return {
		length: { mean: length, spread: length * 0.08 },
		radius: [radius, radius * 0.7],
		kink: { length: 0.16, angle: 10 },
		bud: false,
		sides,
	};
}

/**
 * A fork of an arm: one arm leaves `at` of the way along a parent of `length` metres, about 30
 * degrees from it, to one side.
 */
function fork(
	stem: PieceStem,
	at: number,
	length: number,
	angle = 30,
): NonNullable<PieceStem['sides']>[number] {
	return {
		stem,
		gap: 0.04 * length,
		from: at - 0.04,
		to: at,
		arrangement: 'alternate',
		angle: { mean: angle, spread: 5 },
	};
}

/** The holm oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Stills 21 and 09: the leaf tuft at an arm's end is the piece. A branch end as full as the
	// photograph holds more leaves than one prototype may at the finest tier, so the bare fork is
	// wood of the plant's frame with a tuft at each arm's end. A tuft is 20 to 25 centimetres
	// across: a short twig with a side twig each 3.5 centimetres, each ending in its own leaves.
	{
		name: 'tuft',
		attitude: 'along',
		variants: 3,
		stem: {
			length: { mean: 0.26, spread: 0.03 },
			radius: [0.0035, 0.0015],
			leaves: tuft(0.26, 14, 0.1),
			sides: [
				{
					stem: SIDE_TWIG,
					gap: 0.035,
					from: 0.1,
					to: 0.97,
					arrangement: 'spiral',
					angle: { mean: 60, spread: 10 },
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

/** The studio photographs of the holm oak's cut wood, each laid out from the pieces. */
export const STUDIO: readonly PieceStudio[] = [
	// Still 21: a bare grey Y a metre tall. The stem forks at a fifth of its height and each arm
	// forks again at half its own, about 30 degrees a side of the fork's line. Four large tufts and
	// two small ones, each at an arm's end. The piece is as wide as it is tall.
	{
		still: 21,
		piece: 'tuft',
		stand: {
			lean: -8,
			stem: arm(0.75, 0.009, [
				fork(arm(0.55, 0.006, [fork(arm(0.3, 0.004), 0.45, 0.55, 50)]), 0.27, 0.75, 55),
				fork(arm(0.32, 0.005), 0.62, 0.75, 50),
				fork(arm(0.25, 0.004), 0.82, 0.75, 55),
			]),
		},
	},
	{ still: 22, piece: 'twig' },
];
