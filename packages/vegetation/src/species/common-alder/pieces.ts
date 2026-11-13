// The common alder's pieces: the branch end its sockets carry and the forked twig at its top. Each
// value names the reference picture it was measured on. Each arm carries its woody cones; the
// catkins are not part of a piece yet.
//
// The cut branch of still 21 is a metre tall over 725 pixels, which makes its round leaf 9 to 10
// centimetres across (65 to 75 pixels at full size), inside the species' 4 to 10. The record's leaf
// is 7, so a piece draws its leaves at 1.3 of that until the record's own length moves.
import {
	oneMark,
	type PieceLeaf,
	type PieceLeaves,
	type PieceRule,
	type PieceStem,
	type PieceStudio,
	withMarks,
} from '../../leaf/piece';

/**
 * The leaf the pieces wear: the record's, on the stalk the twig's photograph shows. The record's
 * leaf grows the crown the species ships, so it keeps its own stalk until a plant built of pieces
 * replaces that crown. Ten leaves read at full size on still 22 stand on stalks 0.15 to 0.31 of their
 * blade's length, with a median of 0.21: 1.5 centimetres on the record's 7 centimetre blade.
 */
export const PIECE_LEAF: PieceLeaf = { stalk: 0.015 };

/** A piece's leaf over the record's: 9.5 centimetres measured on still 21, over 7. */
const LEAF_SCALE = 1.3;
/** The twig's height over the 0.4 metres its rule is written for: a blade is 0.148 of its height. */
const TWIG_SCALE = 0.07 / 0.148 / 0.4;

/**
 * The leaves along a shoot. Still 21: alternate, four to six on a side shoot of 15 to 25 centimetres,
 * one each 4.5 centimetres, held 50 to 70 degrees off the shoot, their faces open to the branch's sky
 * side. About forty leaves on the branch.
 */
function leaves(from: number): PieceLeaves {
	// The cut branch's turning video: edge on it is 0.29 as wide as face on, so its leaves lean most
	// of the way into its plane.
	return {
		gap: 0.045,
		from,
		angle: 60,
		angleSpread: 10,
		skyward: 0.9,
		scale: LEAF_SCALE,
		flat: 0.7,
	};
}

/**
 * The leaves along a stem of the twig. Still 22 at full size and its turning video: alternate to
 * the stem's two sides in the plane of the fork, one each 0.073 of the twig's height, held 60 to
 * 75 degrees out on stalks. Face on each leaf stands alone and shows its whole face. Edge on the
 * twig is a thin column: each blade leans and rolls 10 to 25 degrees.
 *
 * @param heading Degrees round the stem its first leaf stands: 0 to the right, 180 to the left.
 * @param from The share of the stem's length below which no leaf stands.
 * @param to The share above which none stands.
 */
function twigLeaves(heading: number, from: number, to: number): PieceLeaves {
	return {
		gap: 0.029,
		from,
		to,
		phyllotaxis: { kind: 'distichous', flatten: 1 },
		heading,
		angle: 67,
		angleSpread: 8,
		scale: 1 / TWIG_SCALE,
		face: { turn: 0, spread: 18, inPlane: true },
	};
}

/** A side shoot. Still 21: 15 to 25 centimetres long with four to six leaves. */
const SHOOT: PieceStem = {
	length: { mean: 0.2, spread: 0.05 },
	radius: [0.003, 0.0012],
	leaves: leaves(0.2),
};

/** An arm of the branch. Still 21: it carries three to four alternate side shoots at 40 to 50 degrees. */
function arm(length: number): PieceStem {
	return {
		length: { mean: length, spread: 0.05 },
		radius: [0.008, 0.002],
		// Still 21: the arms bend a little along their length.
		kink: { length: 0.15, angle: 8 },
		// Stills 21 and 09: groups of three to four dark woody cones hang on stalks of three to five
		// centimetres from behind the shoot tips, each cone two centimetres long, three groups on the
		// branch.
		marks: [
			{
				kind: 'body',
				gap: 0.3,
				from: 0.35,
				to: 0.95,
				share: 0.8,
				length: { mean: 0.02, spread: 0.003 },
				width: 0.013,
				stalk: 0.035,
				count: { mean: 3.5, spread: 0.5 },
			},
		],
		leaves: leaves(0.55),
		sides: [
			{
				stem: SHOOT,
				gap: 0.13,
				from: 0.25,
				to: 0.9,
				arrangement: 'alternate',
				angle: { mean: 45, spread: 5 },
			},
		],
	};
}

/** The common alder's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21: a straight stem a metre long that forks at a quarter of its height into two arms about
	// 40 degrees apart. About 40 leaves. The piece is 0.75 as wide as tall.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.29 as wide as face on.
		depth: 16,
		stem: {
			...arm(1),
			// Still 21: the stem is 0.028 of the branch's height thick at its cut (20 of 725 pixels).
			radius: [0.014, 0.003],
			sides: [
				{
					stem: arm(0.6),
					gap: 0.5,
					from: 0,
					to: 0.3,
					arrangement: 'alternate',
					angle: { mean: 46, spread: 4 },
				},
				{
					stem: SHOOT,
					gap: 0.14,
					from: 0.42,
					to: 0.9,
					arrangement: 'alternate',
					// The arm leaves to the right, so the stem's own shoots start on the left.
					turn: 180,
					angle: { mean: 45, spread: 5 },
				},
			],
		},
	},
	// Still 22 at full size. The rule is written for a twig 0.4 metres tall; a blade is 0.134 to
	// 0.162 of the twig's height, so the record's 7-centimetre leaf makes the twig 0.47 metres, and
	// the rule's scale takes it there. A stem bare to 0.42 of the height, where it forks into two arms in one plane: the left 26
	// degrees from the stem and 0.61 long, the right 35 degrees and 0.52 long. Three stalked buds end
	// each arm. Ten round leaves, each alone and whole to the camera: one at the fork, six alternate
	// on the left arm between 0.13 and 0.72 of its length, three on the right arm's upper third. Four
	// cones hang on stalks from the middle of the right arm.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		scale: TWIG_SCALE,
		stem: {
			length: { mean: 0.168, spread: 0.01 },
			// Still 22: the twig is 0.028 of its height thick (20 of 708 pixels).
			radius: [0.0056, 0.0045],
			bud: false,
			// The one leaf at the fork, to the right.
			leaves: { ...twigLeaves(0, 0.86, 1), gap: 0.03 },
			sides: [
				{
					stem: {
						length: { mean: 0.244, spread: 0.012 },
						radius: [0.0034, 0.0014],
						leaves: twigLeaves(172, 0.1, 0.75),
					},
					gap: 0.007,
					from: 0.98,
					to: 1.02,
					arrangement: 'alternate',
					turn: 180,
					angle: { mean: 26, spread: 3 },
				},
				{
					stem: {
						length: { mean: 0.208, spread: 0.01 },
						radius: [0.0034, 0.0014],
						leaves: { ...twigLeaves(172, 0.6, 0.92), gap: 0.0231 },
						// Still 22: four cones, each 0.07 of the height long and 0.65 as wide, on stalks
						// of 0.06 to 0.1, from one place at 0.58 of the arm.
						marks: [
							{
								kind: 'body',
								gap: 0.033,
								from: 0.5,
								to: 0.66,
								share: 1,
								length: { mean: 0.033, spread: 0.003 },
								width: 0.021,
								stalk: 0.035,
								count: { mean: 4, spread: 0.4 },
							},
						],
					},
					gap: 0.007,
					from: 0.98,
					to: 1.02,
					arrangement: 'alternate',
					angle: { mean: 35, spread: 3 },
				},
			],
		},
	},
];

/**
 * The pieces in catkin. Still 19: three male catkins hang plumb from a twig's end, each eight to
 * ten centimetres long, five cone lengths, and about eight millimetres thick. The cones are part of
 * the pieces in every season.
 */
export const FRUIT_PIECES: readonly PieceRule[] = PIECES.map((rule) =>
	withMarks(rule, (stem, order) =>
		order > 0 && stem.leaves
			? [
					oneMark(
						{
							kind: 'body',
							share: 0.5,
							length: { mean: 0.09, spread: 0.01 },
							width: 0.008,
							stalk: 0.01,
							count: { mean: 3, spread: 0.5 },
						},
						stem.length,
						0.92,
						1,
					),
				]
			: undefined,
	),
);

/** The studio photographs of the alder's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
