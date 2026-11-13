// The weeping willow's pieces: the leafy strands its hanging whips carry. A whip is wood of the
// plant's frame; a strand is the piece at each of the whip's sockets. Each value names the reference
// picture it was measured on.
//
// The cut branch of still 21 is a metre tall, which makes its leaf blade 8 to 9 centimetres, inside
// the species' 8 to 15. The record's leaf is 11.5 centimetres, so a strand draws its leaves at 0.74
// of that until the record's own length moves.
import type { PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A strand's leaf over the record's: 8.5 centimetres measured on still 21, over 11.5. */
const LEAF_SCALE = 0.74;

/**
 * One hanging strand of a stated length. Stills 19 and 21: a strand leaves the top or the outer side
 * of an arching twig and turns plumb within a few centimetres. Stills 10 and 28: the stem is about
 * two millimetres thick. Still 21: a strand of 45 to 85 centimetres carries 30 to 45 leaves, one each
 * 1.75 centimetres, alternate, to both sides of the strand, tip down. A leafy strand is 7 to 8 centimetres wide, which
 * a leaf of 8.5 centimetres makes at 24 degrees off the strand. Stills 10 and 23: the tip's
 * leaves are young and small, and a slim bud lies in each axil.
 */
function strand(length: number, spread: number): PieceStem {
	return {
		length: { mean: length, spread },
		radius: [0.0015, 0.0008],
		// Still 21 at full size: a strand leaves its arm and hangs at once, on a short curve, and is
		// leafy from where it leaves.
		hook: { angle: 70, length: 0.03 },
		zigzag: 2,
		leaves: {
			gap: 0.0175,
			from: 0.02 / length,
			phyllotaxis: { kind: 'distichous', flatten: 0, turn: 35 },
			angle: 24,
			angleSpread: 6,
			scale: [
				[0, LEAF_SCALE],
				[0.88, LEAF_SCALE],
				[1, LEAF_SCALE * 0.45],
			],
			// Still 21 and its turning video: the curtain's blades show their faces to a camera that
			// looks square at the branch.
			face: { turn: 0, spread: 35, inPlane: true },
			// The sub-branch's turning video: edge on it is 0.23 as wide as face on.
			flat: 0.7,
		},
	};
}

/** The weeping willow's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 22: the strands of a 35-centimetre sub-branch.
	{
		name: 'strand-short',
		attitude: 'plumb',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: strand(0.3, 0.04),
	},
	// Still 21, read at full size: seventeen strands. Most hang 0.6 to 0.85 of the branch's height,
	// from the arch nearly to the branch's foot; a few at its middle hang 0.45.
	{
		name: 'strand',
		attitude: 'plumb',
		variants: 3,
		scale: 1 / LEAF_SCALE,
		stem: strand(0.72, 0.13),
	},
	// Still 19: one complete strand is 10.5 leaf lengths, about 1.1 metres.
	{
		name: 'strand-long',
		attitude: 'plumb',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		stem: strand(1.1, 0.08),
	},
];

/** The studio photographs of the willow's cut wood, each laid out from the pieces. */
export const STUDIO: readonly PieceStudio[] = [
	// Still 21: an axis 60 centimetres long and 1.5 centimetres thick forks into two arms at 30 to 40
	// degrees. Each arm rises 30 to 40 centimetres, arches over within 20 and carries four to five
	// strands on its arch; two side twigs carry two to three each. 13 to 14 strands, one each seven
	// centimetres of arching twig.
	{
		still: 21,
		scale: 1 / LEAF_SCALE,
		// The cut branch's turning video: edge on it is 0.37 as wide as face on.
		depth: 24,
		piece: 'strand',
		stand: {
			stem: {
				length: 0.6,
				// Still 21: the stem is 0.02 of the branch's height thick (15 of 737 pixels).
				radius: [0.01, 0.007],
				bud: false,
				sides: [
					// The left arm rises steeply and arches over at the branch's top; the right arm
					// leaves at about 50 degrees and reaches 0.3 of the height to the right before
					// it arches.
					{
						stem: {
							length: 0.5,
							radius: [0.006, 0.003],
							// The arm curves from where it leaves and arches over in one smooth sweep.
							droop: 110,
							droopOver: [0.25, 1],
							bud: false,
						},
						gap: 0.03,
						from: 0.95,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 25, spread: 0 },
						turn: 180,
					},
					{
						stem: {
							length: 0.6,
							radius: [0.006, 0.003],
							droop: 100,
							droopOver: [0.25, 1],
							bud: false,
						},
						gap: 0.03,
						from: 0.95,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 50, spread: 0 },
					},
					{
						stem: {
							length: { mean: 0.25, spread: 0.04 },
							radius: [0.003, 0.0015],
							droop: 70,
							droopOver: [0.3, 1],
							bud: false,
						},
						gap: 0.12,
						from: 0.45,
						to: 0.85,
						arrangement: 'alternate',
						angle: { mean: 50, spread: 8 },
					},
				],
			},
			// Six strands on the left arm, five on the right and three on each side twig.
			along: { piece: 'strand', gap: 0.055, from: 0.5 },
		},
	},
	// Still 22: a yellow twig 33 centimetres tall stands in its clamp; three strands leave its top
	// and hang back down beside it.
	{
		still: 22,
		scale: 1 / LEAF_SCALE,
		piece: 'strand-short',
		stand: {
			lean: 4,
			stem: {
				length: 0.33,
				radius: [0.003, 0.002],
				bud: false,
				sides: [
					{
						stem: { length: 0.09, radius: [0.002, 0.0015], droop: 50, bud: false },
						gap: 0.01,
						from: 0.91,
						to: 1,
						arrangement: 'alternate',
						angle: { mean: 60, spread: 15 },
					},
				],
			},
		},
	},
	// Still 19: a shoot hangs from its branch and parts within its first 25 centimetres into four
	// strands, each about a metre long.
	{
		still: 19,
		scale: 1 / LEAF_SCALE,
		piece: 'strand-long',
		stand: {
			lean: 176,
			stem: { length: 0.25, radius: [0.003, 0.0015], bud: false },
			along: { piece: 'strand-long', gap: 0.07, from: 0.2 },
		},
	},
];
