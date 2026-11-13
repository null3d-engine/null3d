// The common ash's pieces: the stout upturned branch end its sockets carry, with leaves only in
// bunches at shoot tips, and the twig at its top. Each value names the reference picture it was
// measured on. Still 21 is weak by its own index note (six leaves in one plane). Stills 09 and 21
// show one or two leaves at an end where still 04 shows four to six, so the branch end carries one
// pair at each side twig's end and two at its own.
//
// On still 21 a leaf is about 20 centimetres long against the record's 26, so a piece draws its
// leaves at 0.8 of the record's until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 20 centimetres measured on still 21, over 26. */
const LEAF_SCALE = 0.8;

/**
 * A tip bunch. Stills 04, 22 and 23: two to three opposite pairs of leaves under the end bud, each
 * pair crossed with the next, the pairs 2 to 5 centimetres apart, the leaves 50 to 70 degrees off
 * the shoot.
 */
function bunch(length: number, pairs: number): PieceLeaves {
	const gap = 0.035;
	return {
		gap,
		from: 1 - (gap * pairs) / length,
		phyllotaxis: { kind: 'opposite', decussate: true },
		angle: 60,
		angleSpread: 8,
		scale: LEAF_SCALE,
	};
}

/** The common ash's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 09: a stout twig with side twigs in exactly opposite pairs at three nodes 12 to 15
	// centimetres apart, the middle pair turned a quarter turn. Each side twig is 8 to 10 centimetres
	// long at 60 to 70 degrees and ends in a bud. Still 04: every end turns up and carries a bunch.
	{
		name: 'branch-end',
		attitude: 'up',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: {
			length: { mean: 0.6, spread: 0.05 },
			radius: [0.006, 0.004],
			leaves: bunch(0.6, 2),
			sides: [
				{
					stem: {
						length: { mean: 0.14, spread: 0.03 },
						radius: [0.004, 0.003],
						droop: -25,
						leaves: bunch(0.14, 1),
					},
					gap: 0.13,
					from: 0.2,
					to: 0.85,
					arrangement: 'opposite',
					angle: { mean: 65, spread: 5 },
				},
			],
		},
	},
	// Still 22: a twig 35 centimetres long with one wide pair of leaves and a crossed pair above it,
	// under a small end bud.
	{
		name: 'twig',
		attitude: 'up',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.004, 0.003],
			leaves: { ...bunch(0.35, 2), gap: 0.12, from: 0.3 },
		},
	},
];

/** The studio photographs of the ash's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
	{ still: 9, piece: 'branch-end' },
];
