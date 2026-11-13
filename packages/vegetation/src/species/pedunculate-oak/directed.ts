// The pedunculate oak as a directed frame: one massive bole that divides over a zone into seven
// great limbs, which fan from near level at the bottom to upright at the top and stand on every
// side of the trunk; each limb's boughs, one at a place; and the boughs' branches, under clumps of
// foliage. The limbs are crooked all the way and thin where a bough leaves. The proportions are
// from the species' measured targets (still 01, the primary tree) and from the description of the
// real tree in the first review of its frame, which read stills 01, 02, 03, 04, 18 and 20, the
// whole-tree turning video and the winter oak. Shares are of the tree's height.
import type { FrameBranchRule, FrameSpec } from '../../grow/frame';

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
	// One at a place, to one side and the other in turn, a little toward the sky side.
	around: 'sides',
	lift: 20,
	jitter: 25,
	angle: [
		[0, 58],
		[1, 42],
	],
	from: 'parent',
	angleSpread: 8,
	length: { outline: 0.94 },
	vary: 0.06,
	least: 0.08,
	most: 0.4,
	radius: 0.5,
	taper: 0.35,
	shed: 0.7,
	bends: [{ from: 0.2, to: 0.7, level: 4 }],
	sway: 30,
	elbows: 7,
	crook: 0.5,
	patch: clump(0.2),
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
			length: {
				parent: [
					[0, 0.42],
					[1, 0.26],
				],
			},
			vary: 0.12,
			radius: 0.55,
			taper: 0.35,
			sway: 34,
			elbows: 5,
			crook: 0.4,
			patch: clump(0.15),
		},
	],
};

/** The pedunculate oak's frame. */
export const frame: FrameSpec = {
	// Still 01, the mean of the outline's two half widths in 16 bands from the crown's base up.
	outline: [
		[0.13, 0.6],
		[0.156, 0.768],
		[0.219, 0.847],
		[0.281, 0.845],
		[0.344, 0.84],
		[0.406, 0.78],
		[0.469, 0.785],
		[0.531, 0.76],
		[0.594, 0.734],
		[0.656, 0.67],
		[0.719, 0.634],
		[0.781, 0.569],
		[0.844, 0.443],
		[0.906, 0.333],
		[0.969, 0.192],
		[1, 0],
	],
	// The crown is built nearly round. Still 01 looks across the wide side.
	plan: { narrow: 0.82, turn: 0 },
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
				// every side. The shares here are of the bole's own length.
				count: 7,
				along: [0.6, 1],
				stagger: 0.15,
				// Each limb's own direction round the trunk: each pair that leaves near one height
				// stands on opposite sides, and each pair is turned on from the last.
				around: [0, 180, 90, 270, 45, 225, 135],
				jitter: 10,
				// The real tree: the limbs fan from near level on both sides to upright in the middle.
				angle: [
					[0, 80],
					[0.5, 58],
					[0.84, 34],
					[1, 10],
				],
				from: 'plumb',
				angleSpread: 4,
				// The limbs show through the foliage, and their wood runs out nearly to the rim. The
				// upright limb's end is the crown's highest wood.
				length: {
					outline: [
						[0, 0.82],
						[0.84, 0.82],
						[1, 0.93],
					],
				},
				vary: 0.05,
				// The real tree: each limb leaves at a third to a half of the bole's width.
				radius: [
					[0, 0.42],
					[1, 0.5],
				],
				taper: 0.3,
				shed: 0.7,
				// The real tree: the low limbs run out near level and dip at their ends.
				bends: [
					{
						from: 0.75,
						to: 1,
						by: [
							[0, 22],
							[0.5, 8],
							[1, 0],
						],
					},
				],
				// The real tree: crooked all the way, a gentle elbow every metre or two.
				sway: 28,
				elbows: 8,
				crook: 0.55,
				patch: clump(0.2),
				children: [boughs],
			},
		],
	},
};
