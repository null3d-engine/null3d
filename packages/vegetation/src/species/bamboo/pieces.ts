// The bamboo's pieces: the branch pair a culm's joint carries, in three forms up the branching
// zone, each placed whole at a socket (grow/culm-clump.ts). Each value names the picture it was read
// on; lengths are metres on a clump 8 m tall with culms 0.15 m across (see directed.ts).
//
// A joint carries two branches from one point, the first the stouter, leaving 30 to 40 degrees from
// the culm and curving out to level; each carries 4 to 6 alternate sub-branches, each sub-branch 4
// twigs and its own tip, and each ends in a fan of 3 to 5 narrow leaves spread through some 120
// degrees (pictures 01, 21, 22 and 23).
import type { PieceLeaves, PieceRule, PieceSides, PieceStem, PieceStudio } from '../../leaf/piece';

/** A thick culm's diameter at its foot (directed.ts): pictures 01 and 17, 0.019 of the height. */
const CULM = 0.15;

/**
 * A leaf over the species' own leaf: picture 01 at full size shows leaves 13 to 20 px long on a
 * clump 676 px tall, 0.02 to 0.03 of the height, 0.16 m against the species' 0.17.
 */
const LEAF = 0.16 / 0.17;

/**
 * A twig's fan: 3 to 5 leaves crowded into the twig's last stretch (pictures 22 and 23; 21 shows
 * up to 10), spread flat to 60 degrees either side of the twig, the lowest the widest, each a
 * little below the one before it in size toward the fan's tip, drooping a little (pictures 01 and
 * 22).
 */
const FAN: PieceLeaves = {
	gap: 0.008,
	from: 0.7,
	hang: 0.25,
	angle: [
		[0, 50],
		[1, 20],
	],
	angleSpread: 8,
	scale: [
		[0, LEAF],
		[1, 0.85 * LEAF],
	],
	fan: { reach: 60, tilt: 25, cone: 15 },
};

/** A twig: about as long as its leaves (picture 22), thin and a little drooping, ending in its fan. */
const TWIG: PieceStem = {
	length: { mean: 0.16, spread: 0.04 },
	radius: [0.0025, 0.001],
	droop: 15,
	bud: false,
	leaves: FAN,
};

/**
 * A sub-branch, as picture 22 stands one: a jointed stem 0.4 m long carrying 4 alternate twigs from
 * 0.3 of its length, 40 to 60 degrees out, and its own fan at its tip, so 5 fans a sub-branch.
 */
const SUB_BRANCH: PieceStem = {
	length: { mean: 0.4, spread: 0.08 },
	radius: [0.004, 0.0015],
	droop: 20,
	droopOver: [0.2, 1],
	bud: false,
	leaves: FAN,
	sides: [
		{
			stem: TWIG,
			gap: (0.65 * 0.4) / 4,
			from: 0.3,
			to: 0.95,
			arrangement: 'alternate',
			angle: { mean: 50, spread: 10 },
		},
	],
};

/**
 * The sub-branches along a branch: alternate, from a quarter of its length, 40 to 50 degrees out;
 * picture 01's plume shows each branch as sub-branches of fans, 10 to 20 fans a branch.
 */
function subBranches(length: number, count: number): PieceSides {
	return {
		stem: SUB_BRANCH,
		gap: (0.75 * length) / count,
		from: 0.25,
		arrangement: 'alternate',
		angle: { mean: 45, spread: 5 },
		lengthAlong: [
			[0, 1],
			[1, 0.7],
		],
	};
}

/**
 * One branch of a pair: its length, its width at the foot over the culm's, its sub-branches, and the
 * degrees it turns down to level over its run (pictures 01 and 22).
 */
function branch(length: number, width: number, count: number, droop: number): PieceStem {
	return {
		length: { mean: length, spread: 0.1 * length },
		radius: [(width * CULM) / 2, 0.003],
		droop,
		droopOver: [0.1, 1],
		bud: false,
		sides: [subBranches(length, count)],
	};
}

/**
 * A branch pair: the first branch, 0.35 of the culm wide, and at its foot the second, 0.2 of the
 * culm wide and 0.7 as long, leaving it at 40 to 60 degrees so the two splay apart (pictures 01, 08
 * and 22).
 */
function pair(name: string, length: number, count: number, droop: number): PieceRule {
	const first = branch(length, 0.35, count, droop);
	const second = branch(0.7 * length, 0.2, Math.max(2, count - 1), droop);
	return {
		name,
		attitude: 'along',
		variants: 2,
		stem: {
			...first,
			sides: [
				{
					stem: second,
					gap: 0.01,
					to: 0.015,
					arrangement: 'alternate',
					angle: { mean: 50, spread: 10 },
				},
				...(first.sides ?? []),
			],
		},
	};
}

/**
 * The bamboo's pieces, by their place up the branching zone (directed.ts): the low pairs short,
 * 0.06 of the height, with four sub-branches; the middle ones full, 0.11 of the height, with five;
 * the top ones slender whips, 0.09 of the height, with six that droop further (pictures 01 and 02, and the
 * turning video: the plume's longest branches stand about its middle).
 */
export const PIECES: readonly PieceRule[] = [
	pair('pair-low', 0.06 * 8, 3, 45),
	pair('pair-full', 0.11 * 8, 4, 55),
	pair('pair-whip', 0.09 * 8, 4, 65),
];

/** The studio photograph of a branch: still 21 stands one branch with its twigs and fans. */
export const STUDIO: readonly PieceStudio[] = [{ still: 21, piece: 'pair-full' }];
