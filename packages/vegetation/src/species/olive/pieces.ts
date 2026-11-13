// The olive's pieces: the branch end its sockets carry and the twig at its top. Each value names the
// reference picture it was measured on.
//
// The cut branch of still 21 is a metre tall over 725 pixels, which makes its leaf 6.2 centimetres
// (42 to 50 pixels at full size), the record's own 6.5.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * The leaves along a twig. Stills 10, 11 and 23: opposite pairs, each a quarter turn from the last.
 * Still 21: a pair each 3.3 centimetres along a spray, held about 40 degrees from the stem, and
 * drooping with it. Still 22: a pair each 2.7 centimetres on a twig.
 */
function pairs(from: number, gap: number, flat = 0.8): PieceLeaves {
	return {
		gap,
		from,
		phyllotaxis: { kind: 'opposite', decussate: true },
		angle: 42,
		angleSpread: 8,
		hang: 0.25,
		// Still 21: both leaves of nearly every pair show beside their spray, so the pairs lie in the
		// branch's plane, as its turning video shows the whole branch flat. Stills 10, 22 and 23: on
		// an upright twig each pair stands a quarter turn from the last, so the twig takes none.
		flat,
	};
}

/**
 * A leafy spray. Still 21: 35 to 70 centimetres long. It leaves its axis at 40 to 50 degrees, runs
 * out nearly straight for a third of its length, arches over and ends pointing about 60 degrees
 * below level. Its first leaf pair stands 7 to 8 centimetres from the axis, 0.15 of its length, and
 * it carries one or two side sprays of 25 to 40 centimetres on its arch.
 */
const SPRAY: PieceStem = {
	length: { mean: 0.52, spread: 0.15 },
	radius: [0.003, 0.0012],
	droop: 105,
	droopOver: [0.33, 1],
	leaves: pairs(0.15, 0.033),
	sides: [
		{
			stem: {
				length: { mean: 0.3, spread: 0.07 },
				radius: [0.0018, 0.001],
				droop: 50,
				leaves: pairs(0.15, 0.033),
			},
			gap: 0.2,
			from: 0.3,
			to: 0.8,
			arrangement: 'alternate',
			angle: { mean: 42, spread: 8 },
		},
	],
};

/** The olive's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a straight pale axis a centimetre thick, a metre long, bare for its lowest third.
	// Seven to eight sprays leave it above that, one each seven centimetres to one side and the
	// other, at 40 to 50 degrees, the lowest the longest, and its own top is leafy. The piece is 1.06
	// times as wide as tall. The turning video shows it flat: edge on it is a third as wide.
	{
		name: 'branch-end',
		// The photograph's branch stands upright and its sprays arch down round it.
		attitude: 'upright',
		variants: 2,
		stem: {
			length: { mean: 0.95, spread: 0.05 },
			radius: [0.005, 0.0015],
			leaves: pairs(0.72, 0.033),
			sides: [
				{
					stem: SPRAY,
					gap: 0.075,
					from: 0.36,
					to: 0.9,
					arrangement: 'alternate',
					angle: { mean: 48, spread: 6 },
					lengthAlong: [
						[0, 1.2],
						[1, 0.6],
					],
				},
			],
		},
	},
	// Still 22: a twig 35 centimetres long with nine pairs of leaves and two side shoots, at a
	// quarter and a half of its length, at 45 to 50 degrees.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.002, 0.001],
			leaves: pairs(0.3, 0.027, 0),
			sides: [
				{
					stem: {
						length: { mean: 0.14, spread: 0.03 },
						radius: [0.0015, 0.001],
						leaves: pairs(0.2, 0.027, 0),
					},
					gap: 0.09,
					from: 0.2,
					to: 0.7,
					arrangement: 'alternate',
					angle: { mean: 47, spread: 4 },
				},
			],
		},
	},
];

/** The studio photographs of the olive's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
