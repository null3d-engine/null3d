// The Italian cypress's pieces: the upright flat fan of scale cords that tiles its column's
// surface, read from still 21 on a grid. Its length is set by its cones, not by the index's caption:
// on a bough of "about a metre" the cones of still 21 would be 6 cm across, where the species' are
// 2.5 to 4 cm, so the bough is 0.4 to 0.65 m long.
import type { PieceLeaves, PieceRule, PieceSides, PieceStudio } from '../../leaf/piece';

/**
 * The scale cords along a stem, in two ranks that lie half way into the fan's plane, by eye. Still
 * 21's core is closed and shows its background only between the tips at its edge. Read by the piece
 * preview's sky inside the outline (photograph 0.157, band 0.137 to 0.207): the 6 to 10 cords a
 * branchlet that still 21 seems to show, a cord each 1.6 cm, leave 0.647; a cord each 5 mm 0.444,
 * at half again the spray's size 0.263, with the branchlets of the figures below 0.236, and a cord
 * each 4 mm 0.198. That fan's kit holds 48 MB at the finest tier, where every cord draws whole,
 * against a cap of 22.6 MB, so the cords stand each 6 mm at 1.85 times the spray's size, about the
 * same cover a stem: 0.212 drawn and 0.127 as cards, its face covering 0.420 of its box against the
 * turning video's 0.442.
 */
const CORDS = {
	gap: 0.006,
	scale: 1.85,
	phyllotaxis: { kind: 'distichous', flatten: 0.5 },
	from: 0,
	angle: [
		[0, 50],
		[1, 30],
	],
	angleSpread: 10,
} as const;

/** Cords a third farther apart and half again as large: the same cover from two thirds the sprays. */
const ARM_CORDS = { ...CORDS, gap: 0.009, scale: 2.25 } as const;

/**
 * How every piece of the cypress stands and draws. It stands along its socket's line, which runs up
 * the column's surface, so its flat face looks out of the column. Each run of cords draws as a card
 * of its own picture below the finest tier: a cord's spray is longer than the step between cords,
 * so neighbours overlap along their stem. Still 21 and its turning video: the plume is flat, its
 * narrowest view 0.69 as wide as its widest.
 */
const FORM = {
	attitude: 'along',
	brushCards: true,
	brushGap: 0.02,
	ground: [0, -1, 0],
	plane: [0, 0, 1],
	depth: 25,
} as const;

/**
 * A plume's branchlets, alternate and ascending: 13 to 14 a side on still 21, about 0.06 of its
 * length apart on each side, 35 to 50 degrees from the axis (the steep end of that range here), the
 * longest a little below the middle.
 *
 * @param length The longest branchlet in metres.
 * @param spread The half-width of the branchlets' even spread on that length, in metres.
 * @param from The share of the axis below which none leaves.
 * @param leaves The cords along each branchlet.
 */
function branchlets(
	length: number,
	spread: number,
	from: number,
	leaves: PieceLeaves = CORDS,
): PieceSides {
	return {
		stem: {
			length: { mean: length, spread },
			radius: [0.0025, 0.0012],
			leaves,
			bud: false,
		},
		gap: 0.0156,
		from,
		to: 0.95,
		arrangement: 'alternate',
		out: 8,
		angle: { mean: 38, spread: 5 },
		lengthAlong: [
			[from, 0.85],
			[0.45, 1],
			[0.8, 0.55],
			[1, 0.4],
		],
	};
}

/**
 * The Italian cypress's pieces: the plume of still 21 and the forked plume of still 08. The kit
 * holds one of each, which keeps it inside its cap at the finest tier, where every cord draws whole;
 * each socket takes one of them and sizes it.
 */
export const PIECES: readonly PieceRule[] = [
	{
		name: 'fan',
		...FORM,
		variants: 1,
		stem: {
			// The cones of still 21 are 0.062 of the axis across: at 2.5 to 4 cm the axis is 0.4 to
			// 0.65 m long.
			length: { mean: 0.52, spread: 0.06 },
			// Still 21: 0.029 of the length across at the cut.
			radius: [0.0075, 0.0015],
			// The lowest 0.08 of the axis is bare.
			leaves: { ...CORDS, from: 0.08 },
			bud: false,
			// 0.20 to 0.32 of the axis low and in the middle, 0.10 to 0.15 near the top: the short
			// end of that range, which with the cords' own reach keeps the plume 0.46 as wide as long
			// against still 21's 0.39.
			sides: [branchlets(0.115, 0.015, 0.08)],
		},
	},
	{
		// Still 08 by eye: a slim stem, bare for about a third of its length, forks in a narrow Y of
		// about 30 degrees into two upright plumes, each about 0.3 as wide as long. One arm runs on
		// along the stem and the other leaves it.
		name: 'fork',
		...FORM,
		variants: 1,
		stem: {
			length: { mean: 0.52, spread: 0.06 },
			radius: [0.0075, 0.0015],
			leaves: { ...CORDS, from: 0.34 },
			bud: false,
			sides: [
				{
					// The second arm holds every cord it carries in one side stem, which the vertex
					// limit of one prototype bounds at the finest tier: its own axis is bare to 0.30
					// of its length, its branchlets start at 0.10, and its cords stand fewer and
					// larger at about the same cover.
					stem: {
						length: { mean: 0.3, spread: 0.03 },
						radius: [0.006, 0.0012],
						leaves: { ...ARM_CORDS, from: 0.3 },
						bud: false,
						sides: [branchlets(0.07, 0.01, 0.1, ARM_CORDS)],
					},
					// One arm: the planner sets a side stem half a gap past the range's start, and the
					// next a gap on, outside the range.
					gap: 0.02,
					from: 0.28,
					to: 0.32,
					arrangement: 'alternate',
					out: 0,
					angle: { mean: 28, spread: 3 },
				},
				branchlets(0.07, 0.01, 0.34),
			],
		},
	},
];

/** The studio photographs the pieces are drawn beside. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'fan' },
	{ still: 8, piece: 'fork' },
];
