// The Scots pine's pieces: the bough that a limb's pad carries, and the forked shoot of its close
// photograph. Each value names the reference picture it was measured on. A needle in still 21
// measures 70 pixels, which at the record's needle length makes the bough 0.55 m long and its cone
// 4 cm; a needle in still 22 measures 180 pixels, which makes that shoot 0.21 m long.
import type { PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/**
 * The forked shoot's needle pairs: the metres between one node and the next, and the pairs at a
 * node. Still 22: a brush shows 12 to 14 needles on a side, 20 to 25 pairs on 8 cm of shoot, as its
 * own photograph counts them.
 */
const FORK_PAIRS = [0.0036, 1] as const;
/**
 * The bough's needle pairs, one at a node on the species' own spiral, so a brush is round and its
 * needles hide its stem. Stills 21 and 22 show different shoots, and still 21's needles cannot be
 * counted. With the needle at its own size, the cover of two brushes was read with one mask at one
 * size on the photograph and on the drawing. One brush reads as a pair each 2.4 to 3.6 mm of shoot
 * and the other as closer than 2 mm, so the range is about 1.2 to 2.7 mm. Still 22's count of 20
 * to 25 pairs on 8 cm is of the one face its camera sees, which is a pair each 1.6 to 2 mm round
 * the whole shoot. The bough takes 2 mm.
 */
const BOUGH_PAIRS = [0.002, 1] as const;

/**
 * The needle pairs of a shoot's leafy end, from the angle the needles stand at where the brush
 * begins to the angle at its tip.
 *
 * @param from The share of the stem's length below which the wood is bare.
 * @param low Degrees a needle stands from the shoot where the brush begins.
 * @param tip Degrees a needle stands from the shoot at its tip.
 */
function brush(
	from: number,
	low: number,
	tip: number,
	[gap, pairs]: readonly [number, number],
): NonNullable<PieceStem['leaves']> {
	return {
		gap,
		// One pair at a node follows the species' own spiral; more stand in a ring at the node.
		...(pairs > 1 ? { phyllotaxis: { kind: 'whorled', count: pairs } as const } : {}),
		from,
		angle: [
			[from, low],
			[1, tip],
		],
		angleSpread: 8,
	};
}

/**
 * Still 21: a brush is 0.21 to 0.28 of the bough's length across and a needle 0.10 of it long, so
 * the needles stand nearly square to the shoot where the brush begins. They close toward its tip.
 */
const BOUGH_BRUSH = [75, 40] as const;
/**
 * Still 22: the needles stand 50 to 60 degrees from the shoot where the brush begins and 25 to 40
 * degrees near its tip.
 */
const FORK_BRUSH = [55, 32] as const;

/**
 * Degrees the bough's side branches stand out of its plane, one pair toward the sky side and the
 * next away. The turning video: the bough's narrowest view is 0.43 as wide as its widest. The drawn
 * bough reads 0.38 at 12 degrees and 0.48 at 20.
 */
const OUT = 16;

/** The Scots pine's pieces. */
export const PIECES: readonly PieceRule[] = [
	{
		// Still 21 and its turning video. The bough is a flattened fan: its narrowest view is 0.43 as
		// wide as its widest, so its side branches leave to one side and the other in its own plane.
		// It stands on its socket with its tips up, so its side branches lift toward its own tip.
		name: 'bough',
		attitude: 'up',
		variants: 3,
		ground: [0, -1, 0],
		// The fan lies in the plane of the bough's line and its sides.
		plane: [0, 0, 1],
		stem: {
			length: { mean: 0.55, spread: 0.03 },
			// 0.040 of the length across at the cut and 0.017 in the upper part.
			radius: [0.011, 0.0047],
			// The leader's own brush stands above the last side branch, which leaves at 0.75.
			leaves: brush(0.78, ...BOUGH_BRUSH, BOUGH_PAIRS),
			// The buds and the cones are extras with sockets of their own, so a tip ends in needles.
			bud: false,
			sides: [
				{
					stem: {
						// The longest side branch is 0.51 of the bough's length.
						length: { mean: 0.28, spread: 0.015 },
						// Still 21: a side branch is 6 to 8 mm across at its foot (8 to 10 pixels).
						radius: [0.0035, 0.002],
						// A side branch leaves at 40 to 68 degrees and stands 20 to 30 degrees from
						// the bough's line at its tip. It runs straight over its bare part and turns
						// up inside its brush (by eye on still 21).
						droop: -30,
						droopOver: [0.55, 1],
						// The inner 0.25 to 0.30 of a side branch is bare.
						leaves: brush(0.28, ...BOUGH_BRUSH, BOUGH_PAIRS),
						bud: false,
					},
					// Six side branches, one at a node, at 0.16, 0.27, 0.37, 0.51, 0.59 and 0.75 of
					// the bough's length: 0.115 of it apart, the lowest 0.16 bare.
					gap: 0.0633,
					from: 0.11,
					to: 0.8,
					arrangement: 'alternate',
					out: OUT,
					angle: { mean: 57, spread: 11 },
					// Their lengths, by where each leaves: 0.51, 0.45, 0.34, 0.20, 0.43 and 0.21 of
					// the bough's length.
					lengthAlong: [
						[0.16, 1],
						[0.27, 0.88],
						[0.37, 0.67],
						[0.51, 0.39],
						[0.59, 0.84],
						[0.75, 0.41],
					],
				},
			],
		},
	},
	{
		// Still 22: a shoot that forks into three. Its right arm leaves at 0.24 of its length, 34
		// degrees from it and 0.54 as long; its left arm at 0.38, about 45 degrees and 0.45 as long.
		// The main axis is bare to 0.56 of its length.
		name: 'fork',
		attitude: 'up',
		variants: 2,
		ground: [0, -1, 0],
		stem: {
			length: { mean: 0.21, spread: 0.015 },
			// 0.05 of the length across at the cut.
			radius: [0.0052, 0.003],
			leaves: brush(0.56, ...FORK_BRUSH, FORK_PAIRS),
			bud: false,
			sides: [
				{
					stem: {
						length: { mean: 0.105, spread: 0.01 },
						radius: [0.004, 0.0028],
						droop: -10,
						leaves: brush(0.35, ...FORK_BRUSH, FORK_PAIRS),
						bud: false,
					},
					gap: 0.0294,
					from: 0.17,
					to: 0.45,
					arrangement: 'alternate',
					angle: { mean: 40, spread: 6 },
				},
			],
		},
	},
];

/** The studio photographs the pieces are drawn beside. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'bough' },
	{ still: 22, piece: 'fork' },
];
