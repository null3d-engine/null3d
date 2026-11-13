// The pedunculate oak as a directed frame: one massive bole that divides over a zone into seven
// great limbs, which fan from near level at the bottom to upright at the top and stand on every
// side of the trunk; each limb's boughs, one at a place; and the boughs' branches, under clumps of
// foliage. The limbs are crooked all the way and thin where a bough leaves. The proportions are
// from the species' measured targets (still 01, the primary tree) and from the description of the
// real tree in the first review of its frame, which read stills 01, 02, 03, 04, 18 and 20, the
// whole-tree turning video and the winter oak. Shares are of the tree's height.
import {
	type FrameBranchRule,
	type FrameSide,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { record } from './record';

/** A rounded clump of foliage. The real tree's rim is ten to twelve clumps with sky bays between. */
const clump = (width: number) => ({ kind: 'clump', width, depth: width * 0.7 }) as const;

/**
 * The boughs of a great limb and their branches. The real tree: each limb carries five to eight
 * second-order branches, one at a place, with bare limb between, and those divide again into
 * short, stiff, kinked twigs. No bare tip stands outside a clump.
 */
const boughs: FrameBranchRule = {
	name: 'bough',
	role: 'branch',
	count: { every: 0.07, least: 5, most: 8 },
	along: [0.3, 0.93],
	stagger: 0.3,
	// One at a place, each turned on round the limb from the last, so no two boughs leave together.
	// A limb that runs out level carries none straight beneath it: still 01 shows sky under the low
	// limbs down to the fork.
	around: 'spiral',
	clear: 100,
	jitter: 20,
	angle: [
		[0, 58],
		[1, 42],
	],
	from: 'parent',
	angleSpread: 8,
	length: { outline: 0.92 },
	vary: 0.06,
	least: 0.08,
	most: 0.5,
	radius: 0.5,
	taper: 0.35,
	shed: 0.7,
	// Still 01: the boughs of a low limb rise from it to the dome's surface, so the crown is as
	// wide at half its height as the limbs are long, and each arches over a little at its end.
	bends: [{ from: 0.55, to: 1, by: 18 }],
	sway: 30,
	elbows: 7,
	crook: 0.42,
	// Still 05: a bough's outer half keeps clear of its neighbours'.
	apart: 0.012,
	// A bough's clump is smaller the nearer its limb's end it leaves, as the crown's rim and top
	// are made of smaller clumps than its body.
	patch: {
		kind: 'clump',
		width: [
			[0, 0.2],
			[1, 0.12],
		],
		depth: [
			[0, 0.14],
			[1, 0.085],
		],
	},
	children: [
		{
			name: 'branch',
			role: 'branch',
			count: { every: 0.06, least: 2, most: 4 },
			along: [0.35, 0.9],
			stagger: 0.3,
			around: 'sides',
			jitter: 30,
			angle: 52,
			from: 'parent',
			angleSpread: 8,
			// A branch ends inside the crown's surface, and none is longer than a clump is wide.
			length: { outline: 0.9 },
			vary: 0.12,
			least: 0.03,
			most: [
				[0, 0.2],
				[1, 0.1],
			],
			radius: 0.55,
			taper: 0.35,
			sway: 34,
			elbows: 5,
			crook: 0.4,
			// A branch's wood passes through no other wood.
			apart: 0.004,
			patch: clump(0.13),
		},
	],
};

/**
 * One side of the crown as a whole still shows it, read on the still's own columns from the
 * trunk's line. Every figure is a share of the tree's height in that still.
 */
interface Reading {
	/** The lowest foliage on the side: its height, and its distance from the trunk's line. */
	readonly foot: readonly [number, number];
	/** Where foliage hangs into the band under the first one read: that band's top and its reach. */
	readonly hung?: readonly [number, number];
	/**
	 * The reach in bands a sixteenth of the height deep, from the third band above the ground to
	 * the top: the farthest foliage from the trunk's line in each.
	 */
	readonly reach: readonly number[];
	/** The height the bole stands bare to, which is the lower boundary on the trunk's line. */
	readonly bare: number;
	/**
	 * The lower boundary at each twentieth of the height out from the trunk's line, from a tenth
	 * out: the lowest foliage over the columns there. Nearest the trunk it is the wood where the
	 * limbs leave.
	 */
	readonly under: readonly number[];
}

// The reach, the foot's hang and the bare bole are the species' measured targets for each still;
// the lower boundary is read on the same still from the same foot.

// Still 01, right of the trunk's line: the side the long low limb is on, and the wider one. A
// spray hangs low near the trunk here.
const STILL_01_RIGHT: Reading = {
	foot: [0.11, 0.2],
	hung: [0.125, 0.244],
	reach: [
		0.787, 0.89, 0.894, 0.88, 0.835, 0.835, 0.77, 0.742, 0.722, 0.66, 0.54, 0.516, 0.344, 0.213,
	],
	bare: 0.186,
	under: [
		0.11, 0.17, 0.11, 0.11, 0.14, 0.14, 0.13, 0.14, 0.22, 0.19, 0.19, 0.21, 0.19, 0.18, 0.17, 0.23,
		0.25,
	],
};

// Still 01, left of the trunk's line: the shorter side, and no foliage hangs under its first band.
const STILL_01_LEFT: Reading = {
	foot: [0.13, 0.35],
	reach: [
		0.749, 0.804, 0.797, 0.801, 0.725, 0.735, 0.749, 0.725, 0.619, 0.608, 0.598, 0.371, 0.323,
		0.172,
	],
	bare: 0.186,
	under: [0.12, 0.19, 0.21, 0.18, 0.16, 0.13, 0.15, 0.16, 0.25, 0.24, 0.24, 0.24, 0.19, 0.19, 0.22],
};

// Still 02, a quarter turn on, left of the trunk's line: the side that faces still 01's camera.
// The crown is widest higher up than in still 01, and its foliage hangs lower far out.
const STILL_02_LEFT: Reading = {
	foot: [0.1, 0.6],
	hung: [0.125, 0.608],
	reach: [
		0.691, 0.756, 0.764, 0.775, 0.802, 0.786, 0.697, 0.694, 0.67, 0.632, 0.519, 0.452, 0.317, 0.247,
	],
	bare: 0.164,
	under: [0.12, 0.15, 0.15, 0.13, 0.13, 0.2, 0.16, 0.11, 0.12, 0.11, 0.1, 0.18, 0.18, 0.24, 0.35],
};

// Still 02, right of the trunk's line: the side away from still 01's camera. The tree's top
// stands off the trunk's line toward the other side, so the top band is narrow here.
const STILL_02_RIGHT: Reading = {
	foot: [0.1, 0.4],
	hung: [0.125, 0.675],
	reach: [
		0.675, 0.797, 0.834, 0.834, 0.81, 0.791, 0.788, 0.783, 0.718, 0.608, 0.594, 0.503, 0.354, 0.047,
	],
	bare: 0.164,
	under: [
		0.11, 0.15, 0.14, 0.13, 0.15, 0.1, 0.1, 0.1, 0.1, 0.16, 0.13, 0.12, 0.13, 0.22, 0.22, 0.27,
	],
};

/** A side of the outline, from its reading on a still. */
function side(toward: number, read: Reading): FrameSide {
	return {
		toward,
		reach: [
			read.foot,
			...(read.hung ? [read.hung] : []),
			...read.reach.map((reach, band) => [(band + 2.5) / 16, reach] as const),
			[1, 0],
		],
		under: [
			[0, read.bare],
			...read.under.map((height, step) => [0.1 + step * 0.05, height] as const),
		],
	};
}

/** The pedunculate oak's frame. */
export const frame: FrameSpec = {
	// The outline, side by side, with no two sides averaged. Still 01 gives the two sides it looks
	// across; still 02, a quarter turn on, gives the two it looks along.
	outline: [
		side(0, STILL_01_RIGHT),
		side(90, STILL_02_LEFT),
		side(180, STILL_01_LEFT),
		side(270, STILL_02_RIGHT),
	],
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.16 of the height across below the limbs, on a flared foot. The real tree: a
		// bole 0.12 to 0.16 across.
		width: [
			[0, 0.26],
			[0.03, 0.19],
			[0.06, 0.165],
			[0.15, 0.155],
			[0.25, 0.12],
		],
		// The real tree: the bole divides over a zone between 0.15 and 0.25 of the height.
		length: { share: 0.25 },
		sway: 2,
		elbows: 2,
		children: [
			{
				name: 'limb',
				role: 'limb',
				// The real tree: six or seven great limbs, which leave over the zone and stand on
				// every side. Each is stated by itself, lowest first: its direction round the trunk,
				// its angle, its reach and its course are each a figure by its place. The shares here
				// are of the bole's own length.
				count: 7,
				along: [0.7, 1],
				stagger: 0,
				// Still 01, where +X is the picture's right: the fourth limb is the long low limb on
				// the right, which leaves at 0.21 of the height, and the fifth is the low limb on the
				// left, which leaves at 0.23 and stands a little toward the camera. The seven stand a
				// seventh of a turn apart: the first two are the low limbs toward and away from the
				// camera, the third and the sixth stand between at steeper angles, and the seventh is
				// the upright one.
				around: [103, 257, 309, 0, 206, 154, 51],
				jitter: 5,
				// Still 01: the right limb leaves 21 degrees above level and the left one nearly level;
				// the real tree's limbs fan from there to upright in the middle.
				angle: [
					[0, 72],
					[0.167, 74],
					[0.333, 44],
					[0.5, 69],
					[0.667, 82],
					[0.833, 40],
					[1, 12],
				],
				from: 'plumb',
				angleSpread: 2,
				// Still 01: the right limb's foliage is the crown's widest reach, and its bare wood
				// shows two thirds of the way out. Its wood ends half a clump short of the outline, so
				// the clump at its end stands on the outline. The others' wood runs out nearly to the
				// rim, and the upright limb's end is the crown's highest wood.
				length: {
					outline: [
						[0, 0.9],
						[0.167, 0.9],
						[0.333, 0.84],
						[0.5, 0.89],
						[0.667, 0.9],
						[0.833, 0.84],
						[1, 0.93],
					],
				},
				vary: 0.03,
				// Still 03, from below, each limb's width across its run a little way out from the
				// fork, in the picture's own pixels: the left limb 72, the right limb 62, the limb
				// over the camera 43, the two steeper limbs 48 and 41, and the trunk's upright
				// continuation 110. The limb away from the camera does not show and takes the figure
				// of the one toward it. The real tree: the thickest limb leaves at half the bole's
				// width. Each share here gives its limb that thickness beside the left limb's, on a
				// bole that thins over the zone the limbs leave in.
				radius: [
					[0, 0.268],
					[0.167, 0.274],
					[0.333, 0.321],
					[0.5, 0.421],
					[0.667, 0.5],
					[0.833, 0.302],
					[1, 0.827],
				],
				taper: 0.3,
				shed: 0.7,
				// Still 01: the right limb rises to 0.29 of the height over its first third, then runs
				// level and dips a little at its end. The real tree: the low limbs run out near level
				// and dip at their ends, and no foliage lies on the ground.
				bends: [
					{
						from: 0.1,
						to: 0.4,
						level: [
							[0, 12],
							[0.167, 10],
							[0.333, 50],
							[0.5, 4],
							[0.667, 6],
							[0.833, 54],
							[1, 78],
						],
					},
					{
						from: 0.75,
						to: 1,
						by: [
							[0, 8],
							[0.167, 8],
							[0.333, 0],
							[0.5, 6],
							[0.667, 6],
							[0.833, 0],
							[1, 0],
						],
					},
				],
				// The real tree: crooked all the way, a gentle elbow every metre or two.
				sway: 28,
				elbows: 9,
				crook: 0.5,
				// Still 03, from below: the limbs spread to every side and none lies along another.
				apart: 0.02,
				patch: clump(0.2),
				children: [boughs],
			},
		],
	},
};

/**
 * The pedunculate oak's record with the frame as its growth. A socket holds five shoot rows that fan
 * 45 degrees from its line: the figures the scaffold build's oak states for the same branch ends.
 */
export const directed = framedRecord(record, frame, { rows: { mean: 5, spread: 1 }, fan: 45 });
