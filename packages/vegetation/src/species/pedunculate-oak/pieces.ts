// The pedunculate oak's pieces: the stiff, angular branch end its sockets carry, and the twig at its
// top. Each value names the reference picture it was measured on; stills of the bare winter oak are
// named as such.
//
// The cut branch of still 21 is a metre tall, and a leaf tuft on it is 0.22 of that across, which
// makes a leaf 10 to 11 centimetres. The record's leaf is 12, so a piece draws its leaves at 0.9 of
// that until the record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * The leaf's share of the record's 12 centimetres, were still 21's branch the metre its caption says:
 * a tuft is 0.22 of the branch across. The leaf is the ruler, so the branch is 1.11 metres.
 */
const LEAF_SCALE = 0.9;
/** The same for still 22's twig, captioned 35 centimetres: 0.62, so the twig is 56 centimetres. */
const TWIG_LEAF_SCALE = 0.62;

/**
 * The tuft at a shoot's end. Stills 09, 10 and 21: six to ten leaves crowd in a shoot's last five
 * centimetres. Stills 21 and 22: they lie as one flat rosette that faces out of the branch's plane,
 * fanned all round the shoot's tip, so a tuft is two leaf lengths across.
 */
function tuft(length: number, leaves: number, scale = LEAF_SCALE): PieceLeaves {
	const run = 0.05;
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: 60,
		scale: [
			[1 - run / length, scale],
			[1, scale * 0.85],
		],
		fan: { reach: 150, tilt: 18 },
	};
}

/**
 * A side shoot. Still 21 and the winter oak's 21: it is bare but for its end, turns 15 to 40 degrees
 * once or twice along its length, and may carry one short shoot of its own.
 */
function sideShoot(length: number, spread: number): PieceStem {
	return {
		length: { mean: length, spread },
		radius: [0.006, 0.004],
		kink: { length: 0.07, angle: 20 },
		leaves: tuft(length, 9),
		sides: [
			{
				stem: { length: 0.08, radius: [0.004, 0.003], leaves: tuft(0.08, 6) },
				gap: 0.2,
				from: 0.3,
				to: 0.8,
				// Still 21: the short shoots lie in the branch's plane with the rest; one carries the
				// tuft at the branch's middle.
				arrangement: 'alternate',
				angle: { mean: 55, spread: 8 },
			},
		],
	};
}

// The wood. Still 21: the stem is 0.023 of the branch's height thick at its cut (17 of 733 pixels),
// and holds that to a quarter of the height. The winter oak's 21: 0.034, stouter, with twig ends
// about 0.011 thick, and a bend at every node, each rounded over a few centimetres. Still 22: the
// twig's stem is 0.032 of its height thick.
/** The pedunculate oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a branch end a metre long, 1.2 centimetres thick at its cut. Five side shoots leave
	// one at a time, one each 10 to 12 centimetres from 0.2 of its length, at 50 to 70 degrees. They
	// are 15 to 42 centimetres long, the longest at the middle. The stem ends in a tuft of its own.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.33 as wide as face on.
		depth: 22,
		stem: {
			length: { mean: 1, spread: 0.06 },
			radius: [0.0115, 0.005],
			kink: { length: 0.08, angle: 14 },
			leaves: tuft(1, 9),
			sides: [
				{
					stem: sideShoot(0.4, 0.06),
					gap: 0.115,
					from: 0.13,
					to: 0.75,
					// Still 21 and the winter oak's 21: the side shoots stand left and right in turn, in
					// one plane, which the photographs show face on.
					arrangement: 'alternate',
					angle: { mean: 63, spread: 7 },
					lengthAlong: [
						[0, 0.8],
						[0.4, 1.1],
						[1, 0.6],
					],
				},
			],
		},
	},
	// Still 22 and the winter oak's 22: a twig 35 centimetres long with three side shoots 10 to 14
	// centimetres long at 50 to 60 degrees, and a tuft of five to seven leaves at each end. At that
	// length its leaves are about 7.5 centimetres, 0.62 of the record's.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		scale: 1 / TWIG_LEAF_SCALE,
		// The turning video of the sub-branch: edge on it is 0.37 as wide as face on.
		depth: 34,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.0068, 0.003],
			kink: { length: 0.07, angle: 24 },
			leaves: tuft(0.35, 6, TWIG_LEAF_SCALE),
			sides: [
				{
					stem: {
						length: { mean: 0.12, spread: 0.02 },
						radius: [0.003, 0.0025],
						leaves: tuft(0.12, 6, TWIG_LEAF_SCALE),
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
