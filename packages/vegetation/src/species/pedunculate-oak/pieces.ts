// The pedunculate oak's pieces: the stiff, angular branch end its sockets carry, and the twig at its
// top. Each value names the reference picture it was measured on; stills of the bare winter oak are
// named as such.
//
// The leaf is the ruler. On still 21 at full size a full leaf is 90 to 110 pixels of a branch 705
// pixels tall, 0.14 of it, and the record's leaf is 12 centimetres, so the branch is 0.86 metres
// tall. A piece's rule states its lengths as shares of the piece's height, and names that size.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

/** A leaf's length over the record's, with the branch's height as the unit: 0.14 over 0.12. */
const LEAF_SCALE = 1.17;
/**
 * The same for still 22's twig: at full size a leaf is 110 to 140 pixels of a twig 720 pixels tall,
 * 0.18 of it, so the twig is 0.67 metres tall.
 */
const TWIG_LEAF_SCALE = 1.5;

/**
 * The rosette at a shoot's end. Still 21 at full size: eight to ten separate leaves crowd in a
 * shoot's last few centimetres and radiate all round its tip, with sky between them, so a rosette
 * is two leaf lengths across, a third of the branch. Its turning video: the rosettes have depth,
 * and the branch is a third as deep as it is wide.
 */
function tuft(length: number, leaves: number, scale = LEAF_SCALE): PieceLeaves {
	const run = 0.05;
	return {
		gap: run / leaves,
		from: 1 - run / length,
		angle: 60,
		// The outer, older leaves are the full ones; the inner are young and down to 0.6 of them.
		scale: [
			[1 - run / length, scale],
			[1, scale * 0.6],
		],
		fan: { reach: 165, tilt: 20, cone: 20 },
	};
}

/**
 * A side shoot. Still 21 and the winter oak's 21: it is bare but for its end, bends at each node,
 * and a long one carries a short shoot of its own.
 */
function sideShoot(length: number, forks = false): PieceStem {
	return {
		length: { mean: length, spread: length * 0.08 },
		radius: [0.006, 0.004],
		kink: { length: 0.07, angle: 20 },
		leaves: tuft(length, 9),
		sides: forks
			? [
					{
						stem: {
							length: 0.09,
							radius: [0.004, 0.003],
							kink: { length: 0.05, angle: 16 },
							leaves: tuft(0.09, 6),
						},
						gap: 0.3,
						from: 0.45,
						to: 0.85,
						arrangement: 'alternate',
						angle: { mean: 55, spread: 8 },
					},
				]
			: [],
	};
}

/** The leaves along the outer part of a twig's shoot, from a share of its length. */
function twigLeaves(from: number): PieceLeaves {
	return {
		gap: 0.035,
		from,
		angle: 62,
		angleSpread: 10,
		scale: [
			[from, TWIG_LEAF_SCALE],
			[1, TWIG_LEAF_SCALE * 0.75],
		],
		// The sub-branch's turning video: edge on the twig is 0.37 as wide as face on, so its
		// leaves lean most of the way into its plane.
		flat: 0.8,
	};
}

/** A shoot of the twig: it bends at each node and is leafy over its outer half. */
function twigShoot(length: number): PieceStem {
	return {
		length: { mean: length, spread: length * 0.06 },
		radius: [0.008, 0.005],
		kink: { length: 0.08, angle: 16 },
		leaves: twigLeaves(0.5),
	};
}

/** One shoot that leaves a stem of `length` at a share of it, to the right or the left. */
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

// The wood. Still 21: the stem is 0.023 of the branch's height thick at its cut (17 of 733 pixels),
// and holds that to a quarter of the height. The winter oak's 21: 0.034, stouter, with twig ends
// about 0.011 thick, and a bend at every node, each rounded over a few centimetres. Still 22: the
// twig's stem is 0.032 of its height thick.
/** The pedunculate oak's pieces. */
export const PIECES: readonly PieceRule[] = [
	// Still 21 at full size, in shares of the branch's height: a stem bare to 0.25, where a short
	// shoot leaves to the left (0.2 long, near level) and a long one to the right (0.55 long, at 45
	// degrees). A short shoot at 0.45 carries the rosette at the branch's middle, and a shoot of 0.33
	// leaves to the left at 0.5. The stem ends at 0.84 in a rosette of its own. Five rosettes.
	{
		name: 'branch-end',
		attitude: 'along',
		variants: 2,
		scale: 1 / LEAF_SCALE,
		// The turning video of the cut branch: edge on it is 0.33 as wide as face on.
		depth: 24,
		stem: {
			length: { mean: 0.84, spread: 0.03 },
			radius: [0.0115, 0.005],
			kink: { length: 0.08, angle: 14 },
			leaves: tuft(0.84, 9),
			sides: [
				fork(sideShoot(0.2), 0.3, 0.84, 85, true),
				fork(sideShoot(0.55, true), 0.3, 0.84, 45),
				fork(sideShoot(0.1), 0.54, 0.84, 60),
				fork(sideShoot(0.33), 0.6, 0.84, 65, true),
			],
		},
	},
	// Still 22 at full size, in shares of the twig's height: a knobbly stem 0.032 thick that bends
	// at each node. Three shoots: to the right at 0.2 (0.28 long, 40 degrees), to the left at 0.33
	// (0.42 long, 50 degrees) and to the right at 0.5 (0.38 long, 45 degrees). Each shoot and the
	// stem carry five to seven separate leaves along their outer half, held 50 to 70 degrees out,
	// and end in a cluster of buds.
	{
		name: 'twig',
		attitude: 'along',
		variants: 2,
		scale: 1 / TWIG_LEAF_SCALE,
		// The turning video of the sub-branch: edge on it is 0.37 as wide as face on.
		depth: 26,
		stem: {
			length: { mean: 0.93, spread: 0.03 },
			radius: [0.016, 0.006],
			kink: { length: 0.1, angle: 18 },
			leaves: twigLeaves(0.78),
			sides: [
				fork(twigShoot(0.28), 0.22, 0.93, 40),
				fork(twigShoot(0.42), 0.36, 0.93, 50, true),
				fork(twigShoot(0.38), 0.54, 0.93, 45),
			],
		},
	},
];

/** The studio photographs of the oak's cut wood, each one piece standing on its cut. */
export const STUDIO: readonly PieceStudio[] = [
	{ still: 21, piece: 'branch-end' },
	{ still: 22, piece: 'twig' },
];
