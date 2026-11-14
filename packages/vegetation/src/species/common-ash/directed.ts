// The common ash as a directed frame: one straight slender trunk that carries on as a centre leader,
// two crossed pairs of long steep limbs, a pair that divides from the leader's top, and the limbs'
// branches and twigs, which leave in opposite pairs and turn up at their tips, where the leaf
// bunches stand. Each figure names the reference picture it was read on. Shares are of the tree's
// height, measured from the true foot. Still 01 and the whole-tree turning video are the one tree
// the frame follows.
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a bunch, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 0.81 m long and 0.7 m wide on a tree 22 m tall, so the sockets stand a
 * branch end's width apart over the bunch's surface and a branch end's reach inside it.
 */
const ENDS = { pitch: 1.12 / 22, reach: 0.81 / 22 } as const;

/**
 * A bunch of leaves at a shoot tip, which fine wood clothes. Still 01: nine or ten separate masses
 * show in one view, each a limb end's set of tips. Still 04: five or six tip bunches on one branch
 * end two metres across.
 */
const bunch = (width: number) =>
	({ kind: 'bunch', width, depth: width * 0.7, fill: ENDS }) as const;

/**
 * The branches of a limb and their twigs. Stills 07, 06 and 05: branches and twigs leave in opposite
 * pairs, each pair crossed with the next. Stills 01 and 05: a branch arches out to level and turns
 * up at its tip. Stills 01 and 18: the wood reaches the crown's edge.
 */
const branches: FrameBranchRule = {
	name: 'branch',
	role: 'branch',
	// Still 01: the low sweeping branches leave the limbs at 0.40 to 0.48 of the height, a fifth of
	// the way along a limb.
	count: { every: 0.05, least: 4, most: 8 },
	along: [0.06, 0.88],
	stagger: 0.2,
	// The first of a limb's branches leaves its ground side, which on a steep limb is level and
	// outward, and the next two leave its flanks; the three stand so again up the limb.
	around: [180, 80, 280],
	jitter: 14,
	// More branches stand on a limb than it once carried, so each keeps clear of the wood before it.
	apart: 0.004,
	angle: [
		[0, 62],
		[1, 42],
	],
	from: 'parent',
	angleSpread: 6,
	length: {
		outline: [
			[0, 1],
			[1, 0.86],
		],
	},
	vary: 0.06,
	least: 0.08,
	most: 0.5,
	radius: 0.45,
	taper: 0.3,
	bends: [
		{
			from: 0.1,
			to: 0.6,
			level: [
				[0, 6],
				[0.4, 4],
				[1, 6],
			],
		},
		{ from: 0.72, to: 1, by: -35 },
	],
	sway: 10,
	elbows: 4,
	patch: bunch(0.15),
	children: [
		{
			name: 'side',
			role: 'branch',
			count: { every: 0.045, least: 2, most: 7 },
			along: [0.12, 0.94],
			stagger: 0.2,
			around: 'opposite',
			jitter: 12,
			apart: 0.003,
			angle: 48,
			from: 'parent',
			angleSpread: 6,
			// A twig ends inside the crown's edge, and no twig is longer than a branch end's
			// two metres across.
			length: { outline: 0.95 },
			vary: 0.1,
			least: 0.03,
			most: [
				[0, 0.12],
				[1, 0.07],
			],
			radius: 0.5,
			taper: 0.35,
			// Stills 04 and 09: every shoot tip turns up, and the leaves stand only there.
			bends: [{ from: 0.5, to: 1, by: -30 }],
			sway: 10,
			elbows: 3,
			patch: bunch(0.11),
		},
	],
};

/**
 * The short leafy shoots along a limb's upper run, each with its own bunch. Stills 02 and 03: the
 * middle of the crown is full of fine shoots, so it reads closer than the rim; from below, the
 * upper limbs are clothed along their length.
 */
const spurs: FrameBranchRule = {
	name: 'spur',
	role: 'branch',
	count: { every: 0.05, least: 2, most: 8 },
	along: [0.22, 0.94],
	stagger: 0.25,
	around: 'spiral',
	jitter: 20,
	apart: 0.003,
	angle: 50,
	from: 'parent',
	angleSpread: 8,
	length: { share: 0.06 },
	vary: 0.2,
	radius: 0.35,
	taper: 0.35,
	bends: [{ from: 0.3, to: 1, by: -24 }],
	sway: 14,
	elbows: 3,
	patch: bunch(0.1),
};

/** The common ash's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in bands from the top down, each at its own height.
	outline: evenOutline(
		[
			[0.265, 0.21],
			[0.305, 0.4],
			[0.345, 0.438],
			[0.385, 0.457],
			[0.464, 0.448],
			[0.543, 0.395],
			[0.583, 0.41],
			[0.623, 0.457],
			[0.662, 0.467],
			[0.702, 0.429],
			[0.742, 0.424],
			[0.782, 0.4],
			[0.821, 0.334],
			[0.861, 0.319],
			[0.901, 0.272],
			[0.94, 0.148],
			[0.98, 0.119],
			[1, 0],
		],
		// Still 01 looks across the wide side. The turning video: the crown is about 0.95 as wide
		// as tall at still 01's turn and about 0.72 a quarter turn on.
		0.78,
	),
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01, counted on the full-size picture: 0.10 wide at the soil, 0.054 at 0.02 of the
		// height, 0.051 at 0.05 and 0.044 at 0.15. Still 01: the leader thins to its top.
		width: [
			[0, 0.1],
			[0.008, 0.072],
			[0.02, 0.054],
			[0.05, 0.051],
			[0.15, 0.044],
			[0.32, 0.042],
			[0.68, 0.024],
		],
		// Still 01: the trunk carries on as a centre leader to about 0.68 of the height.
		length: { share: 0.68 },
		// Stills 01 and 17: no lean and no bend.
		sway: 1,
		elbows: 3,
		children: [
			{
				name: 'limb',
				role: 'limb',
				// Still 01: the first pair leaves at 0.315 of the height and the leader's own limbs from
				// 0.55. Still 07: near-opposite pairs, each level turned from the last. The shares
				// here are of the leader's own length.
				count: 4,
				along: [0.463, 0.81],
				stagger: 0.1,
				around: 'opposite',
				jitter: 8,
				// Stills 01 and 07: 30 to 45 degrees from plumb.
				angle: [
					[0, 38],
					[1, 30],
				],
				from: 'plumb',
				angleSpread: 4,
				// Stills 01 and 18: the wood reaches the crown's edge.
				length: { outline: 0.9 },
				vary: 0.05,
				// Still 01: 0.50 to 0.55 of the trunk at the first fork.
				radius: 0.52,
				taper: 0.22,
				// Still 01: the steep limbs run nearly straight for most of their length.
				bends: [{ from: 0.7, to: 1, by: -8 }],
				sway: 9,
				elbows: 5,
				patch: bunch(0.15),
				children: [branches, spurs],
			},
			{
				name: 'top',
				role: 'limb',
				// Still 01: at 0.68 of the height the leader divides.
				count: 2,
				along: [1, 1],
				around: 'opposite',
				jitter: 10,
				angle: 20,
				from: 'plumb',
				angleSpread: 4,
				length: { outline: 0.74 },
				vary: 0.05,
				radius: 0.62,
				taper: 0.25,
				bends: [{ from: 0.7, to: 1, by: -6 }],
				sway: 9,
				elbows: 4,
				patch: bunch(0.14),
				children: [branches, spurs],
			},
		],
	},
};

/** The share of the sockets that bear a bunch of keys: the record's 0.06 times 1,399 over 3,606. */
const KEYS_SHARE = 0.023;

/**
 * The common ash's record with the frame as its growth and the branch end of still 21 at each
 * socket. The shoot rows are working figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, {
		rows: { mean: 4, spread: 1 },
		fan: 45,
		piece: 'branch-end',
		// With every branch end's flat side to the sky, a crown seen from the side shows most of its
		// leaves slanted or edge on. Still 04: an ash's tip bunches face every way, so each piece
		// rolls up to a quarter turn either way about its own line and tilts a little off the wood's.
		turn: { roll: 90, tilt: 25 },
	}),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
	// The second card level keeps one of each four of the frame's cards, each grown inside the leaf
	// form's outline, where it kept one of each two: with each socket's branch end as a card of its
	// own, the smaller cards left more sky between them than the leaf form shows.
	lod: { ...record.lod, cardShare: [1, 0.5] as const },
	// The record's keys hang from a share of the shoot tips, and the old grower's tree has 1,399 of
	// them at seed 11, so the record means about 84 bunches. The frame carries a branch end at each
	// of about 3,600 sockets, so the same share would hang two and a half times as many. Until a
	// count of bunches from a picture exists, a socket bears keys at the share that keeps the
	// record's own total. A bunch is about 2,430 triangles and 51 kilobytes at every tier.
	extras: record.extras?.map((extra) =>
		extra.kind === 'fruit' && extra.at === 'shoot-tip' ? { ...extra, share: KEYS_SHARE } : extra,
	),
};
