// The holm oak's pieces: the thick forked branch end with a tuft of upright leafy shoots at each
// arm's end, and one such leafy shoot. Each value names the reference picture it was measured on.
// Acorns are not part of a piece yet.
//
// The leaf is the ruler. On still 21 at full size a leaf is 45 to 55 pixels of a branch 720 pixels
// tall, 0.07 of it, and the record's leaf is 8 centimetres, so the branch is 1.14 metres tall. A
// piece's rule states its lengths as shares of the piece's height, and names that size.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A leaf's length over the record's, with the branch's height as the unit: 0.07 over 0.08. */
const LEAF_SCALE = 0.875;
/**
 * The same for still 22's shoot, whose rule states its lengths in metres at a caption of 35
 * centimetres: at full size a leaf is 0.15 of the shoot's height, so the shoot is 0.53 metres tall.
 * The shoot carries about ten leaves along it and three to four side shoots of four to six.
 */
const TWIG_LEAF_SCALE = 0.8;

/**
 * The leaves of one shoot. Still 21 at full size and stills 10 and 11: a shoot is lined with small
 * oval leaves along its whole length, one each centimetre and a half, held up at about 45 degrees,
 * the tip ones nearly along it.
 */
function shootLeaves(from: number): PieceLeaves {
	return {
		gap: 0.014,
		from,
		angle: [
			[from, 55],
			[1, 30],
		],
		angleSpread: 8,
		scale: LEAF_SCALE,
		// The cut branch's turning video: edge on it is 0.30 as wide as face on.
		flat: 0.5,
	};
}

/** One upright leafy shoot of a tuft. Still 21: 0.14 to 0.21 of the branch's height long. */
const TUFT_SHOOT: PieceStem = {
	length: { mean: 0.15, spread: 0.035 },
	radius: [0.003, 0.0015],
	leaves: shootLeaves(0.12),
};

/**
 * An arm with its tuft. Still 21: thick grey crooked wood, bare to its end, where `shoots` leafy
 * shoots stand up in a tight tuft, the arm's own end among them.
 */
function arm(
	length: number,
	radius: number,
	shoots: number,
	forks: PieceStem['sides'] = [],
): PieceStem {
	const run = 0.03 * shoots;
	return {
		length: { mean: length, spread: length * 0.05 },
		radius: [radius, 0.003],
		kink: { length: 0.14, angle: 14 },
		leaves: shootLeaves(1 - 0.12 / length),
		sides: [
			{
				stem: TUFT_SHOOT,
				gap: 0.03,
				from: 1 - run / length - 0.04 / length,
				to: 1 - 0.04 / length,
				arrangement: 'alternate',
				angle: { mean: 38, spread: 10 },
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
	// Still 21 at full size, in shares of the branch's height: a thick crooked stem, 0.037 thick at
	// its cut. It forks at 0.2, where an arm leaves to the right at 50 degrees and ends in a tuft at
	// 0.4 to 0.6 of the height. It forks again at 0.44 into a right arm, whose tuft is a third of
	// the height across, and its own end, whose tuft is the largest, 0.42 across. Two small tufts
	// stand on short shoots at 0.5 and 0.63. It holds more leaves than one prototype may, so it is
	// built in parts that one socket carries together.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.30 as wide as face on.
		depth: 22,
		stem: {
			length: 0.44,
			radius: [0.0185, 0.012],
			kink: { length: 0.14, angle: 14 },
			bud: false,
			sides: [
				fork(arm(0.48, 0.011, 5), 0.45, 0.44, 50),
				fork(
					arm(0.42, 0.011, 6, [
						fork(arm(0.13, 0.005, 2), 0.25, 0.42, 55),
						fork(arm(0.12, 0.005, 2), 0.5, 0.42, 60, true),
					]),
					1,
					0.44,
					33,
					true,
				),
				fork(arm(0.4, 0.011, 5), 0.97, 0.44, 30),
			],
		},
	},
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		scale: 1 / TWIG_LEAF_SCALE,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			// Still 22: the shoot is 0.026 of its height thick (19 of 729 pixels).
			radius: [0.0046, 0.0015],
			// The sub-branch's turning video: edge on it is 0.35 as wide as face on.
			leaves: {
				gap: 0.026,
				from: 0.2,
				angle: 52,
				angleSpread: 8,
				scale: TWIG_LEAF_SCALE,
				flat: 0.6,
			},
			sides: [
				{
					stem: {
						length: { mean: 0.1, spread: 0.02 },
						radius: [0.0015, 0.001],
						// The sub-branch's turning video: edge on it is 0.35 as wide as face on.
						leaves: {
							gap: 0.026,
							from: 0.2,
							angle: 52,
							angleSpread: 8,
							scale: TWIG_LEAF_SCALE,
							flat: 0.6,
						},
					},
					gap: 0.055,
					from: 0.3,
					to: 0.8,
					arrangement: 'alternate',
					spread: 12,
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
