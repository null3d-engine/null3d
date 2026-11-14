// The giant sequoia's pieces: the weeping bough of still 21, many of which make each rounded clump
// on a limb's end. Each value names the picture it was read on, on a grid. The index gives the
// bough no length; a cone in still 21 measures 55 px, which at the fact sheet's middle cone length
// of 6.5 cm makes a pixel 1.18 mm and the bough 0.84 m long.
import type { PieceRule, PieceSides, PieceStem, PieceStudio } from '../../leaf/piece';

/** The bough's length in metres, by its cones. */
const BOUGH_LENGTH = 0.84;

/**
 * The awl-shaped scales along a cord. Stills 10, 12 and 13: pressed to the shoot so only their sharp
 * tips flare, about twelve to the centimetre on the species' own spiral, so a cord is a rope of
 * scales 6 to 7 mm thick (still 21 at its cone's scale).
 */
const SCALES = {
	gap: 0.0009,
	from: 0,
	angle: [
		[0, 22],
		[1, 18],
	],
	angleSpread: 6,
} as const;

/**
 * One branchlet of the bough. Still 21: it leaves the axis 60 to 70 degrees out, about 25 degrees
 * above level on an upright bough, arcs over in its first 40 per cent and hangs, its tip 70 to 80
 * degrees below level: a turn of about 100 degrees. It carries 5 to 8 sub-sprays that hang from it
 * like the fingers of a tassel.
 *
 * @param length The branchlet's length in metres.
 */
function branchlet(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.1 },
		radius: [0.0045, 0.0022],
		droop: 100,
		droopOver: [0.1, 0.55],
		leaves: { ...SCALES, from: 0.1 },
		bud: false,
		sides: [
			{
				stem: {
					length: { mean: 0.12, spread: 0.02 },
					radius: [0.0026, 0.002],
					droop: 10,
					leaves: SCALES,
					bud: false,
					// Still 09: each side shoot of a hanging branchlet divides into six cords, the top of
					// its stated 3 to 6, whose scales make a rope near the scales' own width.
					sides: [
						{
							stem: {
								length: { mean: 0.06, spread: 0.01 },
								radius: [0.0022, 0.0018],
								leaves: SCALES,
								bud: false,
							},
							gap: 0.014,
							from: 0.2,
							to: 0.95,
							arrangement: 'alternate',
							angle: { mean: 38, spread: 5 },
						},
					],
				},
				// Eight a branchlet, the top of the stated 5 to 8, alternate over its hanging part and
				// spread like the fingers of a tassel, so the plumes of neighbouring branchlets overlap.
				gap: (length * 0.7) / 8,
				from: 0.3,
				to: 1,
				arrangement: 'alternate',
				angle: { mean: 34, spread: 10 },
			},
		],
	};
}

/**
 * One tier of branchlets. Still 21 shows two at a tier and the turning video about three, the
 * bough fuller one way than the other (its narrowest view 0.52 to 0.58 as wide as its widest): to
 * one side and the other in its plane in turn, each pair lifted out of it. The planner sets a side
 * stem half a gap past the tier's start and then a gap apart, so a gap of a third of the tier's
 * span sets three.
 *
 * @param from The tier's start as a share of the axis.
 * @param to Its end.
 * @param length Its branchlets' length in metres.
 */
function tier(from: number, to: number, length: number): PieceSides {
	return {
		stem: branchlet(length),
		gap: ((to - from) * BOUGH_LENGTH) / 3,
		from,
		to,
		arrangement: 'alternate',
		out: 25,
		angle: { mean: 65, spread: 5 },
	};
}

/** The giant sequoia's pieces. */
export const PIECES: readonly PieceRule[] = [
	{
		name: 'bough',
		// The boughs point up and out of their clump; their branchlets arch over and hang.
		attitude: 'up',
		// Each variant takes cells of the card atlas for its card and its tassels' pictures.
		variants: 1,
		// A cord's scales close round it, so below the finest tier each cord draws as a card of its
		// own picture. A stem's wood ends where its leaves hide it, save at the branchlets, whose wood
		// runs to its tip so each tassel card hangs from its own branchlet.
		brushCards: true,
		brushHidesStems: true,
		brushStemKeep: 1,
		// Each branchlet draws as one card of its whole tassel, its sprays included.
		brushSubtrees: true,
		// A bough holds tens of thousands of scales, too many to draw one by one within the kit's cap
		// at the finest tier, so that tier draws the tassel cards too.
		brushFinest: true,
		// Twelve scales to the centimetre, below the planner's own 2 mm between nodes.
		nodeLeast: 0.0009,
		ground: [0, -1, 0],
		// The branch's turning video: the narrowest view is 0.52 to 0.58 as wide as the widest.
		depth: 40,
		stem: {
			length: { mean: BOUGH_LENGTH, spread: 0.06 },
			// Still 21: 0.040 of the length across at the base and 0.011 at 0.68 of it.
			radius: [0.0168, 0.0046],
			// The axis ends in its own short cords above the last tier.
			leaves: { ...SCALES, from: 0.88 },
			bud: false,
			// Still 21: the lowest 0.19 is bare, then four tiers at 0.20 to 0.27, 0.43 to 0.46, 0.56 to
			// 0.68 and 0.82 to 0.87 of the axis, their branchlets 0.25, 0.34, 0.28 and 0.18 of it long.
			sides: [
				tier(0.2, 0.27, 0.25 * BOUGH_LENGTH),
				tier(0.43, 0.46, 0.34 * BOUGH_LENGTH),
				tier(0.56, 0.68, 0.28 * BOUGH_LENGTH),
				tier(0.82, 0.87, 0.18 * BOUGH_LENGTH),
			],
		},
	},
];

/** The studio photographs the pieces are drawn beside. */
export const STUDIO: readonly PieceStudio[] = [{ still: 21, piece: 'bough' }];
