// The weeping willow as a directed frame: a short thick trunk that divides low into three great
// limbs, the limbs each of those divides into (one that carries on upward and two that arch outward
// and run level), their branches, which arch over to the crown's edge, and the whips that hang from
// the arching wood to the hem. Each figure names the
// reference picture it was read on. Shares are of the tree's height. Still 01 and the whole-tree
// turning video are the one tree the frame follows; still 18 shows the limbs' course best.
import {
	type FrameBranchRule,
	type FrameLength,
	type FrameSide,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/** A long strand's length over the tree's height: still 19's 1.6 m on a tree 13 m tall. */
const STRAND = 1.6 / 13;

/**
 * A whip: a hanging axis of the frame, which carries the strands at sockets along it. Stills 19 and
 * 21: it leaves the upper side or the flank of its branch and is plumb within a few centimetres.
 * Still 01: a single fall can be followed for 0.25 to 0.35 of the height, and the hem stands 0.03 to
 * 0.08 above the ground; from the high arches the falls run longer. A whip ends a strand's length
 * above the hem, since the strand at its end hangs on to the hem, or at its greatest length,
 * whichever is shorter.
 */
function whips(along: readonly [number, number], every: number, most: number): FrameBranchRule {
	return {
		name: 'whip',
		role: 'whip',
		count: { every, least: 2, most },
		along,
		stagger: 0.3,
		around: 'spiral',
		// It leaves hanging, a little off plumb, on every side of its branch in turn.
		angle: 172,
		from: 'plumb',
		angleSpread: 6,
		length: {
			height: [
				[0, 0.04 + STRAND],
				[1, 0.07 + STRAND],
			],
		},
		vary: 0.06,
		most: 0.4,
		// The strand at its end hangs a strand's length below it, so a fall ends that far above the
		// first wood under it rather than running through that wood.
		clears: STRAND,
		// Still 10: a strand's stem is 2 mm; a whip is the thicker axis that carries them, a few
		// millimetres where it leaves its branch.
		radius: 0.18,
		taper: 0.4,
		bends: [{ from: 0, to: 0.12, level: -90 }],
		// A whip hangs by its own weight, nearly plumb, and swings a little round the wood below it.
		sway: 6,
		elbows: 3,
		apart: 0.005,
		// Still 09: side strands leave a whip along its whole run. A socket stands each 1.2 m down
		// the whip, so its strands hang end to end with a little overlap.
		patch: {
			kind: 'hang',
			width: 0.07,
			depth: 0.1,
			along: 0,
			sockets: { every: STRAND * 0.75, angle: 10 },
		},
	};
}

/**
 * The branches of a limb: each leaves its arching part, rises, arches over and ends at the crown's
 * edge, and the whips hang from it. Stills 05 and 08: a limb's whips hang from its branches. Stills
 * 01 and 18: the crown's top is a row of rounded heads where branches arch over, and below the
 * widest row the curtain's sides are plumb, so the outermost wood stands at the crown's edge.
 *
 * @param along The shares of the limb's length they leave between.
 * @param length How long each runs.
 * @param shape The longest any runs, as a share of the height, and the degrees of the limb's
 *   ground side none leaves toward, where a limb's branches differ from the rest.
 */
function branches(
	along: readonly [number, number],
	length: FrameLength,
	shape: { readonly most?: number; readonly clear?: number } = {},
): FrameBranchRule {
	return {
		name: 'branch',
		role: 'branch',
		count: { every: 0.02, least: 4, most: 15 },
		along,
		stagger: 0.25,
		// Each turned on round its limb from the last, so no two leave together, and none from a
		// level limb's underside: the limb's strands hang from its own run there.
		around: 'spiral',
		clear: shape.clear ?? 100,
		jitter: 15,
		// Still 08: an arm leaves at about 55 degrees and arches to level and on over.
		angle: [
			[0, 60],
			[1, 45],
		],
		from: 'parent',
		angleSpread: 6,
		length,
		vary: 0.05,
		most: shape.most ?? 0.45,
		radius: 0.5,
		taper: 0.3,
		// Stills 01, 02 and 18: the crown is a dome whose surface is the branches' crests, so each
		// rises straight for nearly half its run before it arches over.
		bends: [{ from: 0.45, to: 0.95, level: -68 }],
		sway: 10,
		elbows: 4,
		// A branch's wood passes through no other wood.
		apart: 0.014,
		// Stills 01 and 18: strands hang from the whole arching run of a branch, over the crown's
		// top as well as at its rim, each leaving the branch's upper side or flank and turning plumb.
		patch: {
			kind: 'hang',
			width: 0.07,
			depth: 0.1,
			along: 0.25,
			sockets: { every: 0.25 / 13, angle: 70 },
		},
		// Stills 02 and 18: the falls hang from a branch's outer arch, at the curtain, and the crown
		// stands open under it, where the trunk and the limbs show.
		children: [whips([0.6, 1], 0.025, 8)],
	};
}

/**
 * One side of the crown as a whole still shows it, from the species' measured targets: the
 * greatest reach from the trunk's line in bands a sixteenth of the height deep, from the band
 * where the curtain's hem stands to the top band. Every figure is a share of the tree's height in
 * that still. The turning video agrees with both stills: 1.43 wide over tall at still 01's turn and
 * 1.27 a quarter turn on, where still 02 reads 1.35.
 */
interface Reading {
	/** The band, from 1 at the foot to 16 at the top, where the hem stands on this side. */
	readonly from: number;
	readonly reach: readonly number[];
}

// Still 01, right of the trunk's line, and left of it. The curtain hangs to the lowest band.
const STILL_01_RIGHT: Reading = {
	from: 1,
	reach: [
		0.633, 0.643, 0.646, 0.711, 0.711, 0.704, 0.694, 0.694, 0.691, 0.691, 0.65, 0.561, 0.507, 0.463,
		0.313, 0.221,
	],
};
const STILL_01_LEFT: Reading = {
	from: 1,
	reach: [
		0.605, 0.629, 0.629, 0.684, 0.687, 0.708, 0.704, 0.687, 0.657, 0.643, 0.629, 0.554, 0.531,
		0.435, 0.381, 0.235,
	],
};
// Still 02, a quarter turn on: the hem stands a little above the lowest band.
const STILL_02_LEFT: Reading = {
	from: 2,
	reach: [
		0.607, 0.638, 0.665, 0.668, 0.685, 0.685, 0.682, 0.677, 0.634, 0.621, 0.58, 0.546, 0.466, 0.376,
		0.284,
	],
};
const STILL_02_RIGHT: Reading = {
	from: 2,
	reach: [
		0.595, 0.597, 0.653, 0.655, 0.665, 0.665, 0.66, 0.636, 0.621, 0.575, 0.556, 0.481, 0.435, 0.291,
		0.138,
	],
};

/** A side of the outline, from its reading on a still. */
function side(toward: number, read: Reading): FrameSide {
	return {
		toward,
		reach: [
			[(read.from - 1) / 16, read.reach[0] as number],
			...read.reach.map((reach, band) => [(read.from + band - 0.5) / 16, reach] as const),
			[1, 0],
		],
		// Stills 01 and 02: the curtain hangs to a hem a little above the ground on every side.
		under: 0.03,
	};
}

/** The weeping willow's frame. */
export const frame: FrameSpec = {
	// The outline, side by side: still 01 gives the two sides it looks across, and still 02, a
	// quarter turn on, the two it looks along.
	outline: [
		side(0, STILL_01_RIGHT),
		side(90, STILL_02_LEFT),
		side(180, STILL_01_LEFT),
		side(270, STILL_02_RIGHT),
	],
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.23 wide at the ground and 0.14 to 0.15 at a tenth of the height.
		width: [
			[0, 0.23],
			[0.04, 0.165],
			[0.1, 0.145],
			[0.17, 0.14],
		],
		// Stills 01 and 02: the trunk divides at 0.17 of the height.
		length: { share: 0.17 },
		// Stills 15 and 17: no lean and no bend.
		sway: 2,
		elbows: 2,
		children: [
			{
				name: 'great',
				role: 'limb',
				// Stills 01 and 02: three great limbs, all from the one fork.
				count: 3,
				along: [1, 1],
				// Stills 06 and 03: the limbs stand round the trunk. Still 01: one leans toward the
				// camera's side of the view and the other two to its left and right, so the crown
				// is as wide to each side.
				around: 'ring',
				first: 90,
				jitter: 10,
				// Still 01: 160 px out for 270 px up.
				angle: 31,
				from: 'plumb',
				angleSpread: 4,
				// Still 18: they divide again at 0.45 to 0.5 of the height.
				length: { height: 0.47 },
				// Stills 01 and 07: half the bole's width where it leaves.
				radius: 0.5,
				taper: 0.75,
				// Still 18: straight for the first third, then a slow S.
				bends: [
					{ from: 0.33, to: 0.66, by: 10 },
					{ from: 0.66, to: 1, by: -10 },
				],
				sway: 8,
				elbows: 4,
				children: [
					{
						name: 'upper',
						role: 'limb',
						// Stills 01 and 18: over the fork of each great limb one limb carries on upward
						// and arches over under the crown's top.
						count: 1,
						along: [1, 1],
						around: 'sides',
						lift: 90,
						jitter: 20,
						// Still 18: the carrying limb turns back toward the tree's middle and stands a
						// little past plumb.
						angle: 36,
						from: 'parent',
						angleSpread: 4,
						// Still 18: the highest wood arches over the tree's middle under the crown's top,
						// where the strands that hang from it close over it.
						length: { height: 0.94 },
						radius: 0.55,
						taper: 0.2,
						bends: [{ from: 0.45, to: 1, by: 55 }],
						sway: 10,
						elbows: 5,
						// Strands hang from the limb's own arch over the tree's middle, so its end is
						// clothed. Its wood carries no falls: those would hang in front of the trunk.
						patch: {
							kind: 'hang',
							width: 0.07,
							depth: 0.1,
							along: 0.6,
							sockets: { every: 0.25 / 13, angle: 70 },
						},
						// Stills 01, 02 and 18: the dome's upper shoulders are the top limbs' branches,
						// which run out toward the outline. They leave the limb's rising part, before it
						// arches over, and from its upper side only, so none heads in over the middle
						// through its own limb or another's; the longest stops short of the dome's top.
						children: [branches([0.3, 0.7], { outline: 0.94 }, { clear: 200, most: 0.3 })],
					},
					{
						name: 'secondary',
						role: 'limb',
						// Still 18: 6 to 8 secondary limbs in one view, a profile count, so the tree has
						// about half as many again round its near and far sides. Three leave each great
						// limb's end evenly round it, so the nine stand round the tree and no two leave
						// on one side.
						count: 3,
						along: [1, 1],
						around: 'ring',
						jitter: 8,
						// Still 08: a limb divides in a narrow Y.
						angle: 21,
						from: 'parent',
						angleSpread: 3,
						// Still 18: the wood reaches 0.76 of the crown's half width.
						length: { outline: 0.76 },
						vary: 0.05,
						radius: 0.55,
						taper: 0.3,
						// Still 18: each arches outward and runs level at 0.55 to 0.75 of the height.
						bends: [{ from: 0.3, to: 0.95, level: 5 }],
						sway: 10,
						elbows: 5,
						// Still 18: the limbs spread round the tree and none lies along another.
						apart: 0.015,
						// Their branches leave past the stretch where the three limbs still stand close
						// together, so none runs through a sibling limb.
						children: [branches([0.4, 0.92], { outline: 0.97 }), whips([0.75, 1], 0.045, 4)],
					},
				],
			},
		],
	},
};

/**
 * The foot of the framed willow. The frame's trunk already flares to still 01's foot, so the stem
 * base adds no flare of its own, as the framed oak's does: low rounded lobes, and short roots that
 * sink into the turf close to the foot.
 */
const base = {
	...record.base,
	flare: { amount: 0, height: 0.5 },
	buttress: {
		lobes: { mean: 6, spread: 1 },
		amount: 0.1,
		sharpness: 1.5,
		height: 0.4,
		round: 0.6,
	},
	roots: {
		count: { mean: 5, spread: 1 },
		length: { mean: 0.6, spread: 0.15 },
		radius: 0.16,
		dive: 0.3,
		ridge: 0.9,
	},
} as const;

/**
 * The weeping willow's record with the frame as its growth and the long hanging strand of still 19
 * at each socket. The shoot rows are working figures, not measured ones: a kit with no pieces draws
 * them.
 */
export const directed = {
	...framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45, piece: 'strand-long' }),
	base,
	pieces: PIECES.filter((piece) => piece.name === 'strand-long'),
};
