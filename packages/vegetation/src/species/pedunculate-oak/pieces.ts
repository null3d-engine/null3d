// The pedunculate oak's pieces: the stiff, angular branch end its sockets carry, and the twig at its
// top. Each value names the reference picture it was measured on; stills of the bare winter oak are
// named as such.
//
// The cut branch of still 21 is a metre tall, which makes a leaf tuft 19 centimetres across and a
// leaf 9 to 10 centimetres. The record's leaf is 12, so a piece draws its leaves at 0.8 of that
// until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 9.5 centimetres measured on still 21, over 12. */
const LEAF_SCALE = 0.8;

/**
 * The tuft at a shoot's end. Stills 09, 10 and 21: six to ten leaves crowd in a shoot's last five
 * centimetres and radiate all round it, the outer ones standing wider than the inner.
 */
function tuft(length: number, leaves: number): PieceLeaves {
	const run = 0.05;
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: [
			[1 - run / length, 85],
			[1, 50],
		],
		angleSpread: 8,
		// Stills 21 and 22: the blades of a tuft lie open to the sky side, face on to the camera.
		skyward: 0.85,
		scale: [
			[1 - run / length, LEAF_SCALE],
			[1, LEAF_SCALE * 0.8],
		],
	};
}

/**
 * A side shoot. Still 21 and the winter oak's 21: it is bare but for its end, turns 15 to 40 degrees
 * once or twice along its length, and may carry one short shoot of its own.
 */
function sideShoot(length: number, spread: number): PieceStem {
	return {
		length: { mean: length, spread },
		radius: [0.004, 0.002],
		kink: { length: 0.11, angle: 22 },
		leaves: tuft(length, 7),
		sides: [
			{
				stem: { length: 0.08, radius: [0.0025, 0.0018], leaves: tuft(0.08, 6) },
				gap: 0.25,
				from: 0.3,
				to: 0.8,
				arrangement: 'spiral',
				angle: { mean: 55, spread: 8 },
			},
		],
	};
}

/** The pedunculate oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a branch end a metre long, 1.2 centimetres thick at its cut. Five side shoots leave
	// one at a time, one each 10 to 12 centimetres from 0.2 of its length, at 45 to 60 degrees. They
	// are 15 to 42 centimetres long, the longest at the middle. The stem ends in a tuft of its own.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 1, spread: 0.06 },
			radius: [0.006, 0.0025],
			kink: { length: 0.115, angle: 9 },
			leaves: tuft(1, 8),
			sides: [
				{
					stem: sideShoot(0.3, 0.1),
					gap: 0.115,
					from: 0.17,
					to: 0.75,
					// Still 21 and the winter oak's 21: the side shoots stand left and right in turn, in
					// one plane, which the photographs show face on.
					arrangement: 'alternate',
					angle: { mean: 52, spread: 8 },
					lengthAlong: [
						[0, 0.7],
						[0.45, 1.25],
						[1, 0.6],
					],
				},
			],
		},
	},
	// Still 22 and the winter oak's 22: a twig 35 centimetres long with three side shoots 6 to 10
	// centimetres long at 50 to 60 degrees, and a tuft of five to seven leaves at each end.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.004, 0.002],
			kink: { length: 0.09, angle: 12 },
			leaves: tuft(0.35, 6),
			sides: [
				{
					stem: {
						length: { mean: 0.08, spread: 0.02 },
						radius: [0.0025, 0.0018],
						leaves: tuft(0.08, 6),
					},
					gap: 0.09,
					from: 0.18,
					to: 0.95,
					arrangement: 'alternate',
					angle: { mean: 55, spread: 6 },
				},
			],
		},
	},
];

/** The studio photographs of the oak's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
