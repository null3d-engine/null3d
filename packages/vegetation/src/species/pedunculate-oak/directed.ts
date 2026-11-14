// The pedunculate oak as a directed frame: one massive bole on a rounded flare that gives six great
// limbs over a zone, from near level to steep, standing on every side of the trunk, and then runs on
// and divides into three rising limbs that carry the dome; each limb's boughs, one at a place; and
// the boughs' branches, under clumps of foliage. The limbs are crooked all the way and thin where a
// bough leaves. The proportions are from the species' measured targets (still 01, the primary tree)
// and from the description of the real tree in the first review of its frame, which read stills 01,
// 02, 03, 04, 18 and 20, the whole-tree turning video and the winter oak. Shares are of the tree's
// height.

import type { ExtraSpec } from '../../core/record';
import type { Vec2 } from '../../core/types';
import {
	type FrameBranchRule,
	type FrameSide,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a clump, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 0.86 m long and 0.79 m wide on a tree 20 m tall. The sockets stand a
 * branch end's reach inside the clump's surface and closer together than its width, so neighbouring
 * branch ends overlap as a real crown's do and the clump reads closed at the first card level.
 */
const ENDS = { pitch: (0.79 * 0.82) / 20, reach: 0.86 / 20 } as const;

/** A rounded clump of foliage. The real tree's rim is ten to twelve clumps with sky bays between. */
const clump = (width: number) =>
	({ kind: 'clump', width, depth: width * 0.7, fill: ENDS }) as const;

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
			[0, 0.23],
			[1, 0.14],
		],
		depth: [
			[0, 0.16],
			[1, 0.098],
		],
		fill: ENDS,
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
 * The skirts of a low limb: branches from its outer half that leave its sides lowered toward the
 * ground and hang as far as a fifth of the height, each under a small clump. Stills 01, 02 and 18:
 * the crown's underside hangs lower far out than near the bole, in lobes of leaf under the low
 * limbs' outer reach, down to a tenth of the height at still 02. A skirt's branch ends
 * where the piece at its end meets the lower boundary, so its leaf hangs down to the boundary and
 * never under it.
 */
const skirts: FrameBranchRule = {
	name: 'skirt',
	role: 'branch',
	count: { every: 0.07, least: 2, most: 4 },
	along: [0.5, 0.95],
	stagger: 0.3,
	around: 'sides',
	lift: -45,
	jitter: 20,
	angle: 80,
	from: 'parent',
	angleSpread: 8,
	length: { outline: 0.95 },
	vary: 0.1,
	least: 0.03,
	most: 0.2,
	radius: 0.4,
	taper: 0.35,
	sway: 30,
	elbows: 5,
	crook: 0.4,
	apart: 0.006,
	patch: clump(0.11),
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

/**
 * A side of the outline, from its reading on a still taken from a direction round the plant: still
 * 01's camera stands toward 90 degrees and still 02's toward 0.
 */
function side(toward: number, seen: number, read: Reading): FrameSide {
	return {
		toward,
		seen,
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
		side(0, 90, STILL_01_RIGHT),
		side(90, 0, STILL_02_LEFT),
		side(180, 90, STILL_01_LEFT),
		side(270, 0, STILL_02_RIGHT),
	],
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01, read row by row from the trunk's line: the bole is narrowest, 0.155 of the height
		// across, a tenth of the way up, and its foot flares on a rounded curve to 0.168 at 0.075 of the
		// height, 0.194 at 0.054, 0.213 at 0.043 and 0.23 at 0.032, where the grass hides it. It holds
		// its width up through the fork zone, where its limbs' collars widen it, so it stands as a post
		// to the fork and not as a bottle's neck. Above the low limbs, which take its wood, it runs on
		// a third as thick as at its foot to where it divides.
		width: [
			[0, 0.262],
			[0.012, 0.25],
			[0.022, 0.24],
			[0.032, 0.229],
			[0.043, 0.212],
			[0.054, 0.194],
			[0.075, 0.168],
			[0.1, 0.157],
			[0.24, 0.152],
			[0.294, 0.0984],
			[0.35, 0.071],
		],
		// The real tree: the low limbs leave over a zone between 0.15 and 0.25 of the height. Stills 01
		// and 03: the bole runs on above them and divides into rising limbs, and none runs on as a
		// stem to the top.
		length: { share: 0.35 },
		sway: 2,
		elbows: 2,
		children: [
			{
				name: 'limb',
				role: 'limb',
				// The real tree: six or seven great limbs, which leave over the zone and stand on
				// every side. Each low limb is stated by itself, lowest first: its direction round the
				// trunk, its angle, its reach and its course are each a figure by its place. The shares
				// here are of the bole's own length, which runs on past them.
				count: 6,
				along: [0.5, 0.6786],
				stagger: 0,
				// Still 01, where +X is the picture's right: the fourth limb is the long low limb on
				// the right, which leaves at 0.21 of the height, and the fifth is the low limb on the
				// left, which leaves at 0.23 and stands a little toward the camera. The first two are the
				// low limbs toward and away from the camera, and the third and the sixth stand between
				// at steeper angles.
				around: [103, 257, 309, 0, 206, 154],
				jitter: 5,
				// Still 01: the right limb leaves 21 degrees above level and the left one nearly level;
				// the steeper two rise at half that from plumb.
				angle: [
					[0, 72],
					[0.2, 74],
					[0.4, 44],
					[0.6, 69],
					[0.8, 82],
					[1, 40],
				],
				from: 'plumb',
				angleSpread: 2,
				// Still 01: the right limb's foliage is the crown's widest reach, and its bare wood
				// shows two thirds of the way out. Its wood ends half a clump short of the outline, so
				// the clump at its end stands on the outline. The others' wood runs out nearly to the rim,
				// and still 02 shows the two toward and away from still 01's camera carrying its widest
				// reach on both sides, so theirs runs out furthest.
				length: {
					outline: [
						[0, 0.95],
						[0.2, 0.95],
						[0.4, 0.84],
						[0.6, 0.89],
						[0.8, 0.9],
						[1, 0.84],
					],
				},
				vary: 0.03,
				// Still 03, from below, each limb's width across its run a little way out from the
				// fork, in the picture's own pixels: the left limb 72, the right limb 62, the limb
				// over the camera 43, and the two steeper limbs 48 and 41. The limb away from the camera
				// does not show and takes the figure of the one toward it. The real tree: the thickest
				// limb leaves at half the bole's width. Each share here gives its limb that thickness
				// beside the left limb's, on a bole that holds its width over the zone the limbs leave in.
				radius: [
					[0, 0.254],
					[0.2, 0.2526],
					[0.4, 0.2877],
					[0.6, 0.3663],
					[0.8, 0.4221],
					[1, 0.247],
				],
				taper: 0.3,
				shed: 0.7,
				// Still 01: the right limb rises to 0.29 of the height over its first third, then runs
				// level and dips a little at its end. The real tree: the low limbs run out near level
				// and dip at their ends, and no foliage lies on the ground. Still 02 shows the two
				// toward and away from still 01's camera in profile, rising a little more, to the
				// crown's widest band a third of the way up.
				bends: [
					{
						from: 0.1,
						to: 0.4,
						level: [
							[0, 18],
							[0.2, 16],
							[0.4, 50],
							[0.6, 4],
							[0.8, 6],
							[1, 54],
						],
					},
					{
						from: 0.75,
						to: 1,
						by: [
							[0, 8],
							[0.2, 8],
							[0.4, 0],
							[0.6, 6],
							[0.8, 6],
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
				children: [skirts, boughs],
			},
			{
				name: 'crown',
				role: 'limb',
				// Stills 01 and 03: where the bole ends it divides into three rising limbs, each about
				// as thick as a low limb: one runs up near the trunk's line and carries the top, which
				// still 02 shows standing off toward the camera of still 01, and the other two rise to
				// the picture's left and right in still 01 and arch out under the dome's shoulders.
				count: 3,
				along: [1, 1],
				around: [80, 230, 10],
				jitter: 5,
				angle: [
					[0, 16],
					[0.5, 34],
					[1, 34],
				],
				from: 'plumb',
				angleSpread: 3,
				// The middle limb ends inside the dome, so the clumps of its boughs make the top, which
				// still 01 shows as broad as a fifth of the height either side a little under it.
				length: {
					outline: [
						[0, 0.86],
						[0.5, 0.9],
						[1, 0.9],
					],
				},
				vary: 0.03,
				// Still 03: the bole above the low limbs divides into limbs a little over half its
				// width, none of them near the bole's thickness.
				radius: [
					[0, 0.62],
					[0.5, 0.58],
					[1, 0.6],
				],
				taper: 0.3,
				shed: 0.7,
				bends: [
					{
						from: 0.4,
						to: 0.9,
						by: [
							[0, 4],
							[0.5, 16],
							[1, 16],
						],
					},
				],
				sway: 26,
				elbows: 8,
				crook: 0.5,
				apart: 0.02,
				patch: clump(0.18),
				children: [boughs],
			},
		],
	},
};

/**
 * The foot of the framed oak. The frame's trunk already flares to still 01's foot, so the stem base
 * adds no flare of its own. It keeps still 14's buttresses as low, rounded lobes with furrows between
 * them, and short roots that sink into the litter close to the foot.
 */
const base = {
	...record.base,
	flare: { amount: 0, height: 0.5 },
	buttress: {
		lobes: { mean: 9, spread: 1.5 },
		amount: 0.12,
		sharpness: 1.5,
		height: 0.5,
		round: 0.6,
	},
	roots: {
		count: { mean: 6, spread: 1 },
		length: { mean: 0.7, spread: 0.2 },
		radius: 0.18,
		dive: 0.3,
		ridge: 1,
	},
} as const;

/**
 * The share of the sockets that bear a bunch of acorns: the record's 0.0475 of the old grower's
 * 3,774 shoot tips at seed 11 over the frame's 7,932 sockets, so the tree hangs the bunches the
 * record means.
 */
const ACORN_SHARE = 0.0226;

/**
 * The framed oak's acorn: the record's own cup and nut drawn in fewer segments. At the nearest
 * level's farthest an acorn is about five pixels long, and the cup's rim, the nut's swell and its
 * point are what read, so ten points of the record's profile keep them, on twelve faces with four
 * rows of scales.
 */
function acorn(extra: ExtraSpec): ExtraSpec {
	if (extra.kind !== 'fruit' || extra.at !== 'shoot-tip' || !('lathe' in extra.shape)) return extra;
	const shape = extra.shape;
	const keep = [0, 2, 4, 5, 6, 8, 10, 12, 14, 16];
	return {
		...extra,
		share: ACORN_SHARE,
		shape: {
			...shape,
			lathe: keep.flatMap((k): Vec2[] => {
				const point = shape.lathe[k];
				return point ? [point] : [];
			}),
			sides: 12,
			scales: 4,
			stalkSides: 4,
		},
	};
}

/**
 * The framed oak's own budgets, measured at seed 11 and set a twentieth above
 * the measure, under every class-wide cap: the variant's bytes at each tier, and the second card
 * level's triangles at the finest tier. The fill's sockets stand closer than a branch end's width so
 * the crown reads closed, which the review judged better than the old oak (round
 * pedunculate-oak-38f84d469); that takes 11,725 rows where the old record's budget held 7,935.
 * Measured: 12,049,487, 12,196,112, 12,394,235 and 12,641,108 bytes from low to ultra, the merged
 * crown's largest variant at each tier; each cap sits a twentieth above its figure. The second card
 * level measures 40,469 to 42,992 triangles. The first card level, 107,111 to 122,840, keeps the
 * record's own budget.
 */
const VARIANT_BYTES = { low: 12_660_000, medium: 12_810_000, high: 13_020_000, ultra: 13_280_000 };
const LEVEL_2_TRIANGLES = 44_600;

/**
 * The leaf's faces as the oak's own leaf pictures show them, leaf pixels' means in sRGB: the upper
 * face on 12 57 / 96 / 23 and 24 45 / 66 / 23, mean 51 / 81 / 23; the lower face on 13 124 / 139 /
 * 119 and 25 88 / 100 / 85, mean 106 / 120 / 102. The record's own faces read 58 / 83 / 38 and
 * 133 / 148 / 127: the lower face paler than its pictures, and the upper bluer.
 */
const foliage =
	record.foliage.kind === 'blade'
		? {
				...record.foliage,
				leaf: {
					...record.foliage.leaf,
					optics: {
						...record.foliage.leaf.optics,
						reflectance: [0.0331, 0.0823, 0.0086] as const,
						reflectanceBack: [0.1441, 0.1861, 0.1329] as const,
					},
				},
			}
		: record.foliage;

/**
 * The pedunculate oak's record with the frame as its growth and the branch end of still 21 at each
 * socket. The shoot rows are the figures the scaffold build's oak states for the same branch ends;
 * a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, {
		rows: { mean: 5, spread: 1 },
		fan: 45,
		piece: 'branch-end',
		// The bake worker's reading of round `pedunculate-oak-9178db536`: with every branch end's
		// flat side to the sky, a crown seen from the side shows most of its cards slanted or edge
		// on, and the sky shows through. A real crown's rosettes face every way, so each piece rolls
		// up to a quarter turn either way about its own line and tilts a little off the wood's.
		// Rolled round the sky, more than half the pieces showed their pale lower faces to a side view
		// (the bake worker's count at `95257a144`). A crown's outer leaves turn their upper faces to
		// the light, so each piece first tips down from straight out of its clump, its upper face
		// leaning out and up; a steeper tip opens the crown.
		turn: { roll: 90, tilt: 25, out: 30 },
	}),
	base,
	foliage,
	lod: {
		...record.lod,
		budget: {
			...record.lod.budget,
			variantBytes: VARIANT_BYTES,
			lod2Triangles: LEVEL_2_TRIANGLES,
		},
	},
	extras: record.extras?.map(acorn),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
};
