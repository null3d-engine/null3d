// The European beech's pieces: the branch end of flat level sprays its sockets carry, and the twig at
// its top. Each value names the reference picture it was measured on.
//
// The cut branch of still 21 is a metre tall, which makes its leaf 5.6 centimetres (40 pixels at 1.4
// millimetres), inside the species' 5 to 10. The record's leaf is 13, so a piece draws its leaves at
// half of that until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * A piece's leaf over the record's: 5.6 centimetres measured on still 21 and about 7 on still 22,
 * over 13.
 */
const LEAF_SCALE = 0.5;

/**
 * The leaves along a twig. Stills 09 and 04: alternate in two rows, one each 0.6 to 0.8 of a leaf's
 * length, lying in the spray's own plane.
 */
function rows(from: number): PieceLeaves {
	return {
		gap: 0.032,
		from,
		phyllotaxis: { kind: 'distichous', flatten: 0.9 },
		angle: 55,
		angleSpread: 6,
		scale: LEAF_SCALE,
	};
}

/**
 * A flat spray. Still 09: a zigzag twig with four to five alternate side twigs at 40 to 50 degrees,
 * all in one plane, four to six leaves on each, about 28 leaves in all. Still 21: 30 to 45
 * centimetres long.
 */
const SPRAY: PieceStem = {
	length: { mean: 0.43, spread: 0.06 },
	radius: [0.0025, 0.001],
	zigzag: 12,
	leaves: rows(0.12),
	sides: [
		{
			stem: {
				length: { mean: 0.15, spread: 0.03 },
				radius: [0.0015, 0.0008],
				zigzag: 12,
				leaves: rows(0.15),
			},
			gap: 0.075,
			from: 0.12,
			to: 0.85,
			arrangement: 'alternate',
			angle: { mean: 45, spread: 5 },
			lengthAlong: [
				[0, 1],
				[1, 0.55],
			],
		},
	],
};

/** The European beech's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a slender axis a metre long. Four sprays leave it, two each side in turn, at 60 to 80
	// degrees, and its own top is a fifth. The piece is 1.25 times as wide as tall.
	{
		name: 'branch-end',
		attitude: 'level',
		variants: 2,
		stem: {
			length: { mean: 1, spread: 0.05 },
			radius: [0.005, 0.0012],
			zigzag: 10,
			leaves: rows(0.68),
			sides: [
				{
					stem: SPRAY,
					gap: 0.14,
					from: 0.22,
					to: 0.8,
					arrangement: 'alternate',
					angle: { mean: 70, spread: 8 },
				},
			],
		},
	},
	// Still 22: a zigzag twig 35 centimetres long with twelve leaves and three side shoots at about
	// 45 degrees.
	{
		name: 'twig',
		attitude: 'level',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.002, 0.0008],
			zigzag: 14,
			leaves: { ...rows(0.25), gap: 0.05 },
			sides: [
				{
					stem: {
						length: { mean: 0.11, spread: 0.02 },
						radius: [0.0012, 0.0008],
						zigzag: 14,
						leaves: { ...rows(0.3), gap: 0.05 },
					},
					gap: 0.09,
					from: 0.18,
					to: 0.75,
					arrangement: 'alternate',
					angle: { mean: 45, spread: 5 },
				},
			],
		},
	},
];

/** The studio photographs of the beech's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
