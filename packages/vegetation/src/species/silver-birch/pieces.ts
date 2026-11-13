// The silver birch's pieces: the hanging strands its branches carry. Each value names the reference
// picture it was measured on. The cut branch of still 21 is a metre tall, which makes its leaf blade
// five centimetres, the record's own leaf.
import type { PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * One hanging strand of a stated length. Stills 09 and 19: a strand leaves the upper side or the
 * flank of its branch and turns plumb within a few centimetres. Still 10: the twig is one to two
 * millimetres thick. Stills 09 and 22: one leaf each three to four centimetres, alternate, the first
 * a few centimetres from the branch, the blade hanging within thirty degrees of the strand. Stills
 * 11 and 22: some nodes carry a short shoot of two leaves. Stills 10 and 23: a bud at the tip.
 */
function strand(length: number, spread: number, hook: PieceStem['hook']): PieceStem {
	return {
		length: { mean: length, spread },
		radius: [0.001, 0.0006],
		hook,
		zigzag: 5,
		leaves: {
			gap: 0.035,
			from: 0.06 / length,
			// Stills 09 and 22: a blade hangs on its long stalk whichever way its twig runs, about 25
			// degrees off a hanging strand and 40 below level on a rising twig, and faces away from
			// the twig.
			angle: 55,
			angleSpread: 15,
			hang: 0.55,
			face: { turn: 180, spread: 80 },
		},
		sides: [
			{
				stem: {
					length: 0.015,
					radius: [0.0007, 0.0005],
					leaves: {
						gap: 0.007,
						angle: 55,
						angleSpread: 15,
						hang: 0.55,
						face: { turn: 180, spread: 80 },
					},
				},
				gap: 0.14,
				from: 0.15,
				to: 0.9,
				arrangement: 'spiral',
				angle: { mean: 50, spread: 10 },
			},
		],
	};
}

/** The hook of a strand that leaves a level branch: it starts a little above level. */
const SIDE_HOOK = { angle: 105, length: 0.045 } as const;

/** The silver birch's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 09: the strands along a side branch are five to seven and a half leaf lengths long,
	// 25 to 38 centimetres.
	{ name: 'strand-short', attitude: 'plumb', variants: 3, stem: strand(0.31, 0.07, SIDE_HOOK) },
	// Still 21: the strands of a cut branch hang 30 to 72 centimetres.
	{ name: 'strand', attitude: 'plumb', variants: 2, stem: strand(0.5, 0.1, SIDE_HOOK) },
	// Still 19: a limb end's strands reach a metre.
	{ name: 'strand-long', attitude: 'plumb', variants: 2, stem: strand(0.95, 0.08, SIDE_HOOK) },
	// Still 22: a twig of 35 centimetres with twelve leaves. It rises for 20 centimetres from its
	// branch, arches through about 150 degrees within 13 and ends pointing down.
	{
		name: 'strand-arch-short',
		attitude: 'plumb',
		variants: 2,
		stem: strand(0.35, 0.04, { angle: 165, rise: 0.2, length: 0.13 }),
	},
	// Still 21: the arms of a cut branch rise, arch over and hang 30 to 72 centimetres. A branch's own
	// end is this piece.
	{
		name: 'strand-arch',
		attitude: 'plumb',
		variants: 3,
		stem: strand(0.62, 0.2, { angle: 150, rise: 0.03, length: 0.12 }),
	},
];

/** The studio photographs of the birch's cut wood, each laid out from the pieces. */
export const STUDIO: readonly PieceStudio[] = [
	// Still 21: a branch a metre tall. White wood 2.5 centimetres thick for its lowest quarter, one
	// fork at 45 centimetres into three arms at 25 to 35 degrees, each 20 to 35 centimetres long. The
	// piece is flat: face on it is 0.42 of its height wide.
	{
		still: 21,
		piece: 'strand-arch',
		stand: {
			stem: {
				length: 0.45,
				radius: [0.012, 0.006],
				bud: false,
				sides: [
					{
						stem: {
							length: { mean: 0.27, spread: 0.07 },
							radius: [0.005, 0.002],
							droop: 20,
							droopOver: [0.5, 1],
							bud: false,
						},
						gap: 0.015,
						from: 0.9,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 28, spread: 14 },
					},
				],
			},
			along: { piece: 'strand-short', gap: 0.2, from: 0.55 },
		},
	},
	// Still 22: one arching twig of 35 centimetres, upright in its clamp.
	{ still: 22, piece: 'strand-arch-short' },
	// Still 09: a branch 60 centimetres long that leaves a little below level and bends down to the
	// right, with seven strands, one each eight centimetres.
	{
		still: 9,
		piece: 'strand-short',
		stand: {
			stem: {
				length: 0.6,
				radius: [0.005, 0.002],
				droop: 30,
				bud: false,
			},
			lean: 97,
			along: { piece: 'strand-short', gap: 0.08, from: 0.12 },
		},
	},
];
