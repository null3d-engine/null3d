// The silver birch's pieces: the hanging strands its branches carry. Each value names the reference
// picture it was measured on. The cut branch of still 21 is a metre tall, which makes its leaf blade
// five centimetres, the record's own leaf.
import {
	oneMark,
	type PieceRule,
	type PieceStem,
	type PieceStudio,
	withMarks,
} from '../../leaf/piece';

/**
 * One hanging strand of a stated length. Stills 09 and 19: a strand leaves the upper side or the
 * flank of its branch and turns plumb within a few centimetres. Still 10: the twig is one to two
 * millimetres thick. Stills 09 and 22: one leaf each three to four centimetres, alternate, the first
 * a few centimetres from the branch, the blade hanging within thirty degrees of the strand. Stills
 * 11 and 22: some nodes carry a short shoot of two leaves. Stills 10 and 23: a bud at the tip.
 *
 * @param length The strand's length in metres.
 * @param spread The spread of that length.
 * @param hook How the strand leaves its wood before it hangs.
 * @param foot The stem's radius at its foot.
 * @param shoots Metres between the short shoots of two leaves.
 */
function strand(
	length: number,
	spread: number,
	hook: PieceStem['hook'],
	foot = 0.001,
	shoots = 0.14,
): PieceStem {
	return {
		length: { mean: length, spread },
		radius: [foot, 0.0006],
		hook,
		// Stills 09 and 19: a strand wavers from node to node as it hangs.
		zigzag: 9,
		leaves: {
			gap: 0.035,
			from: 0.06 / length,
			// Stills 09 and 22: a blade hangs on its long stalk whichever way its twig runs, about 25
			// degrees off a hanging strand and 40 below level on a rising twig. Stills 09 and 21: nearly
			// every blade shows its whole face to a camera that looks square at the branch.
			angle: 55,
			angleSpread: 15,
			hang: 0.55,
			// The sub-branch's turning video: edge on the twig is 0.27 as wide as face on, and about
			// a third of its blades still show their faces: the midribs lie near the twig's plane and
			// the blades are rolled through a wide range about them.
			flat: 0.8,
			face: { turn: 0, spread: 40, inPlane: true },
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
						flat: 0.8,
						face: { turn: 0, spread: 40, inPlane: true },
					},
				},
				gap: shoots,
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
	{
		name: 'strand-short',
		attitude: 'plumb',
		leafDroop: 'plane',
		variants: 3,
		stem: strand(0.31, 0.07, SIDE_HOOK),
	},
	// Still 21: the strands of a cut branch hang 30 to 72 centimetres.
	{
		name: 'strand',
		attitude: 'plumb',
		leafDroop: 'plane',
		variants: 2,
		stem: strand(0.5, 0.1, SIDE_HOOK),
	},
	// Still 19: a limb end's strands reach a metre.
	{
		name: 'strand-long',
		attitude: 'plumb',
		leafDroop: 'plane',
		variants: 2,
		stem: strand(0.95, 0.08, SIDE_HOOK),
	},
	// Still 22, read at full size: a leaf is 0.13 of the twig's height, so the record's leaf of five
	// centimetres makes the twig 0.385 metres tall. It rises for 0.75 of that height, arches through
	// about 150 degrees over 0.58 and ends pointing down: 0.56 metres of twig with seventeen leaves,
	// thirteen along it and two short shoots of two.
	{
		name: 'strand-arch-short',
		attitude: 'plumb',
		leafDroop: 'plane',
		variants: 2,
		// Still 22: the twig is 0.016 of its height thick at its cut (11 to 13 of 712 pixels).
		stem: strand(0.56, 0.04, { angle: 165, rise: 0.29, length: 0.22 }, 0.003, 0.2),
	},
	// Still 21: the arms of a cut branch rise, arch over and hang 30 to 72 centimetres. A branch's own
	// end is this piece.
	{
		name: 'strand-arch',
		attitude: 'plumb',
		leafDroop: 'plane',
		variants: 3,
		stem: strand(0.62, 0.2, { angle: 150, rise: 0.03, length: 0.12 }, 0.002),
	},
];

/**
 * The pieces in catkin. Still 35: two to four slim catkins hang plumb from a twig's end, each four
 * to five centimetres long, a leaf's length, and six to seven times as long as thick. About half
 * of the strands carry them.
 */
export const FRUIT_PIECES: readonly PieceRule[] = PIECES.map((rule) =>
	withMarks(rule, (stem, order) =>
		order === 0
			? [
					oneMark(
						{
							kind: 'body',
							share: 0.5,
							length: { mean: 0.045, spread: 0.006 },
							width: 0.007,
							stalk: 0.005,
							count: { mean: 2.5, spread: 1 },
						},
						stem.length,
						0.9,
						1,
					),
				]
			: undefined,
	),
);

/** The studio photographs of the birch's cut wood, each laid out from the pieces. */
export const STUDIO: readonly PieceStudio[] = [
	// Still 21, read at twice its size: a branch a metre tall, white for its lowest quarter. It forks
	// at 0.36 of its height. The left arm is bare, 50 centimetres long, and ends in an arch with 22
	// leaves on two strands that hang 45 centimetres. The right arm is 59 centimetres long with a
	// short side arm at a third of it (14 leaves, hanging 32 centimetres) and a long one at 0.7 that
	// arches right (40 leaves on two to three strands, hanging 73 centimetres); its own top carries
	// 22 leaves. About 98 leaves and eleven twig ends by the measure. The arms are bare but for their
	// ends, and the piece is flat: face on it is 0.76 of its height wide.
	{
		still: 21,
		piece: 'strand-arch',
		// The cut branch's turning video: edge on it is 0.21 as wide as face on.
		depth: 8,
		stand: {
			stem: {
				length: 0.36,
				radius: [0.012, 0.007],
				bud: false,
				sides: [
					{
						// The arm curves a little along its length; its end's strand makes the arch.
						stem: {
							length: 0.5,
							radius: [0.005, 0.002],
							kink: { length: 0.12, angle: 6 },
							bud: false,
						},
						gap: 0.02,
						from: 0.95,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 22, spread: 0 },
						turn: 180,
					},
					{
						stem: {
							length: 0.59,
							radius: [0.006, 0.002],
							kink: { length: 0.12, angle: 6 },
							bud: false,
							sides: [
								{
									stem: { length: 0.1, radius: [0.003, 0.002], bud: false },
									gap: 0.03,
									from: 0.3,
									to: 0.35,
									arrangement: 'alternate',
									angle: { mean: 45, spread: 0 },
								},
								{
									stem: {
										length: 0.28,
										radius: [0.004, 0.002],
										droop: 60,
										bud: false,
									},
									gap: 0.03,
									from: 0.66,
									to: 0.71,
									arrangement: 'alternate',
									angle: { mean: 60, spread: 0 },
								},
							],
						},
						gap: 0.02,
						from: 0.95,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 12, spread: 0 },
					},
				],
			},
			// A second strand hangs beside the first at each arm's end.
			along: { piece: 'strand', gap: 0.06, from: 0.82 },
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
