// The European beech's pieces: the branch end of flat level sprays its sockets carry, and the twig at
// its top. Each value names the reference picture it was measured on.
//
// The leaf is the ruler. The beech has no fact sheet, so a piece's leaf is 9 centimetres, taken from
// the species' range of 5 to 10; several full leaves read on still 21 at full size are 8 to 9. A
// piece is written in shares of its photograph's height and sized by the leaf's share of that
// height.
import type { PieceLeaf, PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A leaf's length in metres. */
const LEAF = 0.09;
/**
 * A leaf's width over its length. 24 full leaves read at full size on stills 11, 22 and 23 are 0.42
 * to 0.65 as wide as long, with a median of 0.55; still 21's smaller leaves read about 0.6.
 */
const LEAF_WIDTH = 0.55;
/** The texture contour's width over its blade's length. */
const CONTOUR_WIDTH = 0.75;

/**
 * The leaf the pieces wear: 9 centimetres long, with the record's share of spread, and drawn at the
 * photographs' width, about 0.73 of the texture contour's. The record's leaf grows the crown the
 * species ships, so it keeps its own length and outline until a plant built of pieces replaces
 * that crown.
 */
/**
 * Degrees per side of the V a piece's blade keeps: edge on it stands the blade wide, where the
 * crown's shallow fold shows a line, and a folded blade shows its face a share narrower, so the
 * breadth below is widened by the same share.
 */
const PIECE_FOLD = 35;
const FOLD_FLATTEN = Math.cos((PIECE_FOLD * Math.PI) / 180);

export const PIECE_LEAF: PieceLeaf = {
	length: { mean: LEAF, spread: 0.014 },
	breadth: LEAF_WIDTH / CONTOUR_WIDTH / FOLD_FLATTEN,
	fold: PIECE_FOLD,
};

/** A leaf's share of the branch end's height on still 21: 55 to 65 pixels of 715. */
const LEAF_SHARE = 0.0845;
/** A leaf's share of the twig's height on still 22, where the twig's stem is 0.38 of a unit. */
const TWIG_LEAF_SHARE = 0.0715;
/** A branch end's leaf over the pieces' leaf, in a branch one unit tall. */
const LEAF_SCALE = LEAF_SHARE / LEAF;
/** The twig's leaf over the pieces' leaf, in the twig's own unit. */
const TWIG_LEAF_SCALE = TWIG_LEAF_SHARE / LEAF;
/** A node's spacing along a spray, in a branch one unit tall: a row's two nodes 1.1 leaf widths apart. */
const ROW_GAP = (1.1 * LEAF_WIDTH * LEAF_SHARE) / 2;

/**
 * The leaves along a twig. Stills 09, 04 and 21: alternate in two rows that lie in the spray's own
 * plane, each leaf 60 to 80 degrees from its twig. Neighbours in a row just touch: two nodes apart
 * is a little more than a leaf's width, so a node comes each 2.7 centimetres.
 *
 * @param from The share of the twig's length below which no leaf stands.
 * @param tilt Degrees the two rows stand round the twig off the piece's own plane; a drawn place
 * where absent.
 */
function rows(from: number, tilt?: number, axils = true): PieceLeaves {
	return {
		gap: ROW_GAP,
		from,
		phyllotaxis: { kind: 'distichous', flatten: 0.9 },
		...(tilt === undefined ? {} : { heading: tilt }),
		angle: 70,
		angleSpread: 8,
		scale: LEAF_SCALE,
		...(axils ? {} : { axilBuds: false }),
	};
}

/**
 * A limb of the branch end with its flat spray. Still 21 at full size and its turning video: a
 * slender grey limb that leaves steeply and levels out. Its grey wood is bare. Its leaves stand on
 * its own thin brown end and on thin side twigs, 0.1 to 0.2 of the branch's height long, that leave
 * to one side and the other at 50 to 80 degrees, four or five leaves on each. A spray is 0.4 to 0.5
 * of the height long and 0.2 to 0.3 wide and holds about thirty leaves. Seen edge on, each spray's
 * plane is tilted from the branch's own. The wood runs smooth between its joints: the photograph's
 * twigs curve gently, and a kink at each of the piece's hundred-odd leaf nodes would cost a ring of
 * the three-sided wood at every one.
 *
 * @param length The limb's length in shares of the branch's height.
 * @param arc Degrees the limb turns away from the branch's line over its length.
 * @param tilt Degrees the spray's plane is turned round its limb off the branch's own plane.
 * @param from The share of the limb's length where its first side twig leaves.
 * @param own The share of the limb's length where its own thin leafy end begins.
 * @param radius The limb's radius at its foot.
 */
function limb(
	length: number,
	arc: number,
	tilt: number,
	from = 0.28,
	own = 0.62,
	radius = 0.005,
	axils = true,
): PieceStem {
	// A side twig of a long limb is 0.17 of the branch's height long, and a short limb's are shorter.
	const twig = Math.min(0.17, 0.4 * length);
	return {
		length: { mean: length, spread: length * 0.07 },
		radius: [radius, 0.0012],
		arc,
		leaves: rows(own, tilt, axils),
		sides: [
			{
				stem: {
					length: { mean: twig, spread: twig * 0.18 },
					radius: [0.0018, 0.001],
					leaves: rows(0.15, tilt, axils),
				},
				// Still 21: six side twigs on the left limb between 0.1 and 0.67 of its length.
				gap: 0.07,
				from,
				to: 0.75,
				arrangement: 'alternate',
				angle: { mean: 62, spread: 10 },
				turn: tilt,
				lengthAlong: [
					[0, 1.1],
					[1, 0.7],
				],
			},
		],
	};
}

/** One limb that leaves a stem of `length` metres at a share of it, to the right or the left. */
function fork(stem: PieceStem, at: number, length: number, angle: number, left = false) {
	return {
		stem,
		gap: 0.04 * length,
		from: at - 0.04,
		to: at,
		arrangement: 'alternate' as const,
		angle: { mean: angle, spread: 5 },
		turn: left ? 180 : 0,
	};
}

/**
 * The leaves along a stem of the twig. Still 22 at full size and its turning video: alternate in
 * two rows in the twig's own plane, 45 to 70 degrees from the stem, each whole to the camera. Edge
 * on the twig is a thin column: each blade leans and rolls 15 to 25 degrees.
 *
 * @param gap Metres between one leaf and the next.
 * @param from The share of the stem's length below which no leaf stands.
 */
function twigRows(gap: number, from: number): PieceLeaves {
	return {
		gap,
		from,
		phyllotaxis: { kind: 'distichous', flatten: 0.9 },
		heading: 8,
		angle: 58,
		angleSpread: 10,
		scale: TWIG_LEAF_SCALE,
		face: { turn: 0, spread: 18, inPlane: true },
	};
}

/** A shoot of the twig: zigzag, with a leaf each `gap` metres from a fifth of its length. */
function twigShoot(length: number, gap: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.08 },
		radius: [0.0022, 0.001],
		zigzag: 18,
		leaves: twigRows(gap, 0.2),
	};
}

/** The European beech's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21 at full size, in shares of the branch's height. A slender grey stem, bare. A limb
	// leaves to the right at 0.28, at 55 degrees, 0.61 long, and levels out. At 0.44 the stem forks:
	// a limb leaves to the left at 50 degrees, 0.72 long, and levels out, and the stem goes on 25
	// to 35 degrees to the right. At 0.76 it breaks into the top spray: three thin twigs, 0.22 long
	// to the left, 0.17 upward and 0.33 to the right. The piece is 1.27 times as wide as tall and holds 100 to 120
	// leaves.
	{
		name: 'branch-end',
		attitude: 'level',
		variants: 2,
		scale: LEAF / LEAF_SHARE,
		// The turning video of the cut branch: edge on it is 0.24 as wide as face on.
		depth: 13,
		// Every bud draws as a three-sided cone at the high tier: a bud is a few pixels wide in the
		// piece's own picture, and the long buds' swells cost more than the leaves.
		budCones: true,
		stem: {
			length: { mean: 0.44, spread: 0.02 },
			// Still 21: the stem is 0.021 of the branch's height thick at its cut (15 of 727 pixels).
			radius: [0.0103, 0.0075],
			bud: false,
			sides: [
				fork(limb(0.61, 28, -20, 0.33, 0.45, 0.005, false), 0.64, 0.44, 55),
				// A short twig of three leaves below the fork.
				fork(
					{
						length: { mean: 0.12, spread: 0.02 },
						radius: [0.0018, 0.001],
						leaves: rows(0.3, 0, false),
					},
					0.84,
					0.44,
					75,
					true,
				),
				fork(limb(0.72, 45, 25, 0.1, 0.62, 0.005, false), 1.02, 0.44, 50, true),
				fork(
					{
						length: { mean: 0.36, spread: 0.02 },
						radius: [0.006, 0.003],
						bud: false,
						sides: [
							// A thin twig of the top spray is leafy from a third of its length.
							fork(limb(0.22, 10, 15, 0.28, 0.35, 0.002, false), 1.02, 0.36, 95, true),
							fork(limb(0.17, 0, 0, 0.28, 0.35, 0.002, false), 1.02, 0.36, 22, true),
							fork(limb(0.33, 25, -10, 0.28, 0.35, 0.0025, false), 1.02, 0.36, 28),
						],
					},
					1.02,
					0.44,
					25,
				),
			],
		},
	},
	// Still 22: a zigzag twig 35 centimetres long with twelve leaves and three side shoots at about
	// 45 degrees.
	{
		name: 'twig',
		attitude: 'level',
		variants: 2,
		scale: LEAF / TWIG_LEAF_SHARE,
		// The turning video of the sub-branch: edge on it is 0.29 as wide as face on.
		depth: 16,
		// Still 22 at full size, in shares of the twig's height: a zigzag stem with a shoot to the
		// right at 0.4 (0.5 long, 50 degrees) and one to the left at 0.6 (0.28 long). Thirteen
		// pointed oval leaves, a full one 0.18 to 0.21 of the height: six on the stem, four on the
		// right shoot and three on the left. A long slim bud at each of the three ends.
		stem: {
			length: { mean: 0.38, spread: 0.02 },
			// Still 22: the twig is 0.02 of its height thick at its cut.
			radius: [0.0036, 0.0012],
			zigzag: 18,
			leaves: twigRows(0.055, 0.15),
			sides: [
				// The stem leans away from this shoot where it leaves, so it stands 50 degrees from
				// the twig's line.
				fork(twigShoot(0.21, 0.047), 0.44, 0.38, 62),
				fork(twigShoot(0.12, 0.04), 0.66, 0.38, 50, true),
			],
		},
	},
];

/** The studio photographs of the beech's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
