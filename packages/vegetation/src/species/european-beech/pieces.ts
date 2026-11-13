// The European beech's pieces: the branch end of flat level sprays its sockets carry, and the twig at
// its top. Each value names the reference picture it was measured on.
//
// The cut branch of still 21 is a metre tall over 715 pixels, which makes its leaf 8 to 9
// centimetres (55 to 65 pixels at full size), inside the species' 5 to 10. The record's leaf is 13,
// so a piece draws its leaves at 0.65 of that until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 8.5 centimetres measured on still 21, over 13. */
const LEAF_SCALE = 0.65;
/** The twig's leaf over the record's: on still 22 a leaf is a fifth of the 35-centimetre twig, 7 centimetres. */
const TWIG_LEAF_SCALE = 0.55;

/**
 * The leaves along a twig. Stills 09 and 04: alternate in two rows, lying in the spray's own plane.
 * A row's leaves stand 0.6 to 0.8 of a leaf's length apart, so a node comes each three centimetres.
 * Still 21: a spray of 50 centimetres carries about thirty leaves.
 */
function rows(from: number): PieceLeaves {
	return {
		gap: 0.03,
		from,
		phyllotaxis: { kind: 'distichous', flatten: 0.9 },
		angle: 55,
		angleSpread: 6,
		scale: LEAF_SCALE,
	};
}

/**
 * A limb of the branch end with its flat spray. Still 21: a bare grey limb whose outer half is a
 * spray 40 to 55 centimetres long and 20 to 25 wide, leaves in two rows on the limb and on short
 * side twigs, all in the branch's own plane. Still 09: four to five alternate side twigs at 40 to
 * 50 degrees, four to six leaves on each.
 */
function limb(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.07 },
		radius: [0.006, 0.0015],
		zigzag: 10,
		leaves: rows(0.45),
		sides: [
			{
				stem: {
					length: { mean: 0.14, spread: 0.03 },
					radius: [0.002, 0.001],
					zigzag: 12,
					leaves: rows(0.2),
				},
				gap: 0.085,
				from: 0.45,
				to: 0.92,
				arrangement: 'alternate',
				angle: { mean: 48, spread: 6 },
				lengthAlong: [
					[0, 1.1],
					[1, 0.6],
				],
			},
		],
	};
}

/** One limb that leaves a stem of `length` metres at a share of it, to the right or the left. */
function fork(stem: PieceStem, at: number, length: number, angle: number, left = false) {
	return {
		stem,
		gap: 0.04 * length,
		from: at - 0.04,
		to: at,
		arrangement: 'alternate' as const,
		angle: { mean: angle, spread: 5 },
		turn: left ? 180 : 0,
	};
}

/** A shoot of the twig: zigzag, with a leaf each 0.13 of the twig's height from a third of its length. */
function twigShoot(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.08 },
		radius: [0.0022, 0.001],
		zigzag: 18,
		leaves: { ...rows(0.3), gap: 0.055, angle: 70, scale: TWIG_LEAF_SCALE },
	};
}

/** The European beech's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a slender grey stem a metre tall, bare for its lowest 0.28. Three limbs: one to the
	// left from 0.28, 75 to 90 centimetres long; one to the right from 0.3, 55 to 60; and the stem's
	// own top with a short limb at 0.55. Each ends in a flat spray, and the whole branch lies in one
	// plane, which a tree holds level. The piece is 1.27 times as wide as tall.
	{
		name: 'branch-end',
		attitude: 'level',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.24 as wide as face on.
		depth: 13,
		stem: {
			...limb(0.95),
			// Still 21: the stem is 0.021 of the branch's height thick at its cut (15 of 727 pixels).
			radius: [0.0103, 0.003],
			leaves: rows(0.68),
			sides: [
				fork(limb(0.8), 0.28, 0.95, 58, true),
				fork(limb(0.58), 0.3, 0.95, 62),
				fork(limb(0.4), 0.55, 0.95, 50, true),
				...(limb(0.95).sides ?? []).map((side) => ({ ...side, from: 0.68 })),
			],
		},
	},
	// Still 22: a zigzag twig 35 centimetres long with twelve leaves and three side shoots at about
	// 45 degrees.
	{
		name: 'twig',
		attitude: 'level',
		variants: 2,
		scale: 1 / TWIG_LEAF_SCALE,
		// The turning video of the sub-branch: edge on it is 0.29 as wide as face on.
		depth: 16,
		// Still 22 at full size, in shares of the twig's height: a zigzag stem with a shoot to the
		// right at 0.4 (0.5 long, 50 degrees) and one to the left at 0.6 (0.28 long). Twelve oval
		// leaves, each 0.17 of the height, one each 0.13 along a shoot, held 60 to 80 degrees out in
		// the twig's plane. A long slim bud at each of the three ends.
		stem: {
			length: { mean: 0.38, spread: 0.02 },
			// Still 22: the twig is 0.02 of its height thick at its cut.
			radius: [0.0036, 0.0012],
			zigzag: 18,
			leaves: { ...rows(0.2), gap: 0.055, angle: 70, scale: TWIG_LEAF_SCALE },
			sides: [fork(twigShoot(0.21), 0.44, 0.38, 50), fork(twigShoot(0.12), 0.66, 0.38, 50, true)],
		},
	},
];

/** The studio photographs of the beech's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
