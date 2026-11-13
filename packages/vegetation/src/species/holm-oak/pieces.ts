// The holm oak's pieces: the bare forked branch end with a leaf tuft at each arm's end, and the leafy
// shoot of a tuft's own top. Each value names the reference picture it was measured on. On still 21 a tuft
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

/**
 * An arm of the Y with its tuft. Still 21: bare, grey and a little bent, it ends in a tuft 20 to 25
 * centimetres across. Still 09: a tuft is the arm's last 20 centimetres with a side twig each 3.5
 * centimetres, each ending in its own leaves.
 */
function arm(length: number, radius: number, forks: PieceStem['sides'] = []): PieceStem {
	return {
		length: { mean: length, spread: length * 0.06 },
		radius: [radius, 0.0015],
		kink: { length: 0.16, angle: 10 },
		leaves: tuft(length, 14, 0.1),
		sides: [
			{
				stem: SIDE_TWIG,
				gap: 0.035,
				from: 1 - 0.2 / length,
				to: 0.97,
				// The cut branch's turning video: edge on it is 0.30 as wide as face on, so a tuft's side
				// twigs stand nearer the branch's plane than round it.
				arrangement: 'alternate',
				spread: 40,
				angle: { mean: 60, spread: 10 },
			},
			...(forks ?? []),
		],
	};
}

/**
 * A fork: one arm leaves `at` of the way along a parent of `length` metres, to the picture's right
 * or, turned, to its left.
 */
function fork(
	stem: PieceStem,
	at: number,
	length: number,
	angle: number,
	left = false,
): NonNullable<PieceStem['sides']>[number] {
	return {
		stem,
		gap: 0.04 * length,
		from: at - 0.04,
		to: at,
		arrangement: 'alternate',
		angle: { mean: angle, spread: 5 },
		turn: left ? 180 : 0,
	};
}

/** The holm oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a bare grey Y a metre tall, 1.8 centimetres thick at its cut. The stem forks at a
	// quarter of its height; the right arm forks again at half its own length, and two shorter arms
	// leave the stem higher up. Five to six tufts, each at an arm's end. The piece is as wide as it
	// is tall, and the turning video shows it flat: edge on it is a third as wide. It holds more
	// leaves than one prototype may, so it is built in parts that one socket carries together.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: arm(0.8, 0.009, [
			fork(arm(0.55, 0.006, [fork(arm(0.3, 0.004), 0.45, 0.55, 50)]), 0.27, 0.8, 52),
			fork(arm(0.32, 0.005), 0.5, 0.8, 50, true),
			fork(arm(0.25, 0.004), 0.75, 0.8, 55),
		]),
	},
	// Still 22: a shoot 35 centimetres long with fifteen to twenty leaves, one each 1.5 centimetres,
	// and four to five side shoots at 40 to 50 degrees.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.0025, 0.001],
			// The sub-branch's turning video: edge on it is 0.35 as wide as face on.
			leaves: { gap: 0.016, from: 0.2, angle: 52, angleSpread: 8, scale: LEAF_SCALE, flat: 0.6 },
			sides: [
				{
					stem: {
						length: { mean: 0.1, spread: 0.02 },
						radius: [0.0015, 0.001],
						// The sub-branch's turning video: edge on it is 0.35 as wide as face on.
						leaves: {
							gap: 0.016,
							from: 0.2,
							angle: 52,
							angleSpread: 8,
							scale: LEAF_SCALE,
							flat: 0.6,
						},
					},
					gap: 0.055,
					from: 0.3,
					to: 0.8,
					arrangement: 'alternate',
					spread: 20,
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
