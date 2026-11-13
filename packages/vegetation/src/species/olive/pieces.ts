// The olive's pieces: the branch end its sockets carry and the twig at its top. Each value names the
// reference picture it was measured on.
//
// The cut branch of still 21 is a metre tall, which makes its leaf about 4.5 centimetres, inside the
// species' 4 to 10. The record's leaf is 6.5, so a piece draws its leaves at 0.7 of that until the
// record's own length moves.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A piece's leaf over the record's: 4.5 centimetres measured on still 21, over 6.5. */
const LEAF_SCALE = 0.7;

/**
 * The leaves along a twig. Stills 10, 11 and 23: opposite pairs, each a quarter turn from the last.
 * Still 22: a pair each 2.2 centimetres, held 50 to 60 degrees from the stem.
 */
function pairs(from: number): PieceLeaves {
	return {
		gap: 0.022,
		from,
		phyllotaxis: { kind: 'opposite', decussate: true },
		angle: 52,
		angleSpread: 6,
		scale: LEAF_SCALE,
	};
}

/**
 * A leafy spray. Stills 21 and 04: 30 to 45 centimetres long, it arches outward and its outer third
 * hangs 30 to 50 degrees below level.
 */
const SPRAY: PieceStem = {
	length: { mean: 0.46, spread: 0.08 },
	radius: [0.0025, 0.0012],
	droop: 65,
	droopOver: [0.4, 1],
	leaves: pairs(0.15),
};

/** The olive's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Stills 21 and 04: the leafy spray is the piece. A branch end carries nine to ten of them, which
	// is more leaves than one prototype may hold at the finest tier, so the branch end's own axis is
	// wood of the plant's frame with a spray at each socket.
	{ name: 'spray', attitude: 'along', variants: 3, stem: SPRAY },
	// Still 22: a twig 35 centimetres long with nine pairs of leaves and two side shoots, at a
	// quarter and a half of its length, at 45 to 50 degrees.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.35, spread: 0.03 },
			radius: [0.002, 0.001],
			leaves: pairs(0.3),
			sides: [
				{
					stem: {
						length: { mean: 0.14, spread: 0.03 },
						radius: [0.0015, 0.001],
						leaves: pairs(0.2),
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

/** The studio photographs of the olive's cut wood, each laid out from the pieces. */
export const STUDIO: readonly PieceStudio[] = [
	// Still 21: a straight pale axis a centimetre thick, a metre long. Sprays leave it at four to
	// five levels 12 to 15 centimetres apart, at 40 to 50 degrees, nine to ten in all, and its own
	// top is a spray. The piece is 1.06 times as wide as tall.
	{
		still: 21,
		piece: 'spray',
		stand: {
			stem: { length: 0.72, radius: [0.005, 0.002], bud: false },
			along: { piece: 'spray', gap: 0.065, from: 0.3, angle: 52 },
		},
	},
	{ still: 22, piece: 'twig' },
];
