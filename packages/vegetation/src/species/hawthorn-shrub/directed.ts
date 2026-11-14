// The hawthorn as a directed frame, in its shrub form: eight thin stems that leave the soil at one
// place and fan out, each a zigzag that gives off a limb at every turn, each limb a zigzag with its
// own twigs, all under one dome, and a straight leafy leading shoot at every end, which stands out
// of the mass. Each figure
// names the reference picture it was read on. Shares are of the plant's height. Still 01 and the
// whole-plant turning video are the one plant the frame follows.
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { pieceRecord } from '../../leaf/piece';
import { PIECE_LEAF, PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a mass, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 0.37 m long and 0.33 m wide on a shrub 4 m tall; the sockets stand a
 * little over its width apart over the mass's surface, so a twig's end stands inside the piece it
 * carries, and a branch end's reach inside the surface.
 */
const ENDS = { pitch: 0.36 / 4, reach: 0.37 / 4 } as const;

/**
 * A leading shoot: a straight leafy shoot that carries on from a branch end and stands outside the
 * mass. Still 01: about 22 stand on the outline, each 0.07 to 0.12 of the height beyond the mass,
 * along the line from the base. It is clothed along its whole run and ends in a thorn.
 */
const shoot: FrameBranchRule = {
	name: 'shoot',
	role: 'shoot',
	count: 1,
	along: [1, 1],
	around: 'ring',
	angle: 6,
	from: 'parent',
	angleSpread: 4,
	// Still 01: the shoots' tips are the outline.
	length: { outline: 1 },
	vary: 0.04,
	least: 0.07,
	most: 0.14,
	radius: 0.7,
	taper: 0.35,
	sway: 3,
	elbows: 2,
	patch: { kind: 'shoot', width: 0.05, depth: 0.05, along: 0 },
};

/**
 * The mass at a branch end, which fine wood clothes. Stills 06 and 03: tufts fill the dome from its
 * surface inward for about 0.15 of the height. Still 01 and the turning video: the masses join into
 * one mound leafy to the ground, so each is about two fifths of the height across; smaller ones
 * stand apart with sky between.
 */
const mass = { kind: 'mass', width: 0.42, depth: 0.32, fill: ENDS } as const;

/**
 * What every side axis of the wood shares. Stills 18 and 08: the wood forks every 0.10 to 0.15 of
 * the height at about 60 degrees between the arms. Stills 17, 06 and 21: each fork turns the wood
 * 15 to 30 degrees, to one side and the other in turn, so every axis zigzags. Still 01: the leafy
 * mass ends 0.07 to 0.12 of the height inside the shoots' tips.
 */
const side = {
	stagger: 0.25,
	jitter: 25,
	angle: 55,
	from: 'parent',
	angleSpread: 8,
	length: { outline: 0.86 },
	vary: 0.06,
	radius: 0.7,
	taper: 0.35,
	sway: 24,
	patch: mass,
} as const;

/** The twigs of a limb, each with its own leading shoot. */
const twig: FrameBranchRule = {
	...side,
	name: 'side',
	role: 'branch',
	count: { every: 0.2, least: 1, most: 2 },
	along: [0.35, 0.8],
	around: 'sides',
	least: 0.06,
	most: 0.25,
	elbows: 2,
	children: [shoot],
};

/** The limbs of a stem, on every side of it in turn. */
const limb: FrameBranchRule = {
	...side,
	name: 'limb',
	role: 'limb',
	count: { every: 0.15, least: 3, most: 4 },
	along: [0.24, 0.85],
	around: 'spiral',
	least: 0.1,
	most: 0.45,
	elbows: 3,
	children: [twig, shoot],
};

/** The hawthorn's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in bands from the top down: the leading shoots' tips.
	outline: evenOutline(
		[
			[0.05, 0.5],
			[0.146, 0.7],
			[0.188, 0.705],
			[0.229, 0.735],
			[0.313, 0.78],
			[0.479, 0.785],
			[0.521, 0.765],
			[0.646, 0.745],
			[0.688, 0.715],
			[0.729, 0.65],
			[0.771, 0.605],
			[0.813, 0.56],
			[0.854, 0.505],
			[0.896, 0.385],
			[0.938, 0.28],
			[0.979, 0.265],
			[1, 0],
		],
		// The dome is built nearly round. Still 01 looks across the wide side.
		0.85,
	),
	stems: {
		name: 'stem',
		// Stills 01 and 18: 6 to 10 stems; one stands plumb at the middle.
		count: 8,
		inner: 1,
		// Stills 07, 14 and 17: the stems leave the soil separately, within two stem widths.
		ring: [
			[0, 0],
			[0.14, 0.03],
			[1, 0.03],
		],
		// Still 01: a fan from plumb at the middle to 55 degrees at the sides.
		lean: [
			[0, 0],
			[0.14, 42],
			[1, 54],
		],
		// Still 01: 0.019 to 0.030 of the height wide, with no flare. Stills 01 and 17: the first
		// fork stands at 0.15 to 0.25 of the height, and the stem thins at each fork after it.
		width: [
			[0, 0.026],
			[0.22, 0.022],
			[0.9, 0.007],
		],
		// A stem runs on through its forks to the mass's surface, as its limbs do. Still 01: the
		// mass's top stands a tenth of the height under the tips of the shoots over it.
		length: { outline: 0.86 },
		most: 0.9,
		sway: 24,
		elbows: 5,
		patch: mass,
		children: [limb, shoot],
	},
};

/** The old grower's shoot tips over the frame's sockets at seed 11: 3,762 over 2,425. */
const TIP_SHARE = 1.55;

/**
 * The hawthorn's record with the frame as its growth and the branch end of still 21 at each socket,
 * wearing the leaf on the stalk the pieces were measured with. The shoot rows are working figures,
 * not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...pieceRecord(
		framedRecord(record, frame, {
			rows: { mean: 4, spread: 1 },
			fan: 45,
			piece: 'branch-end',
			// With every branch end's flat side to the sky, a mound seen from the side shows most of
			// its leaves slanted or edge on. Stills 03 and 06: the tufts face every way, so each piece
			// rolls up to a quarter turn either way about its own line and tilts a little off the
			// wood's.
			turn: { roll: 90, tilt: 35 },
		}),
		PIECE_LEAF,
	),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
	// The mound of pieces leaves its card levels more sky than its leaf form shows: read over the
	// crown's outline at the medium tier, the first card level stands at 0.191 of sky against the
	// leaf form's 0.118. A card grows about its middle inside the leaf form's hull to recover the
	// cover the dropped fine wood made, which brings the first level to 0.121 and the second to
	// 0.127, inside the review's band.
	lod: { ...record.lod, cardGrow: 1.2 },
	// The record's haws and blossom stand at a share of the shoot tips, and the old grower's shrub
	// has 3,762 of them at seed 11, where the frame has a socket for each of about 2,425 branch
	// ends; each share is raised to keep the record's own totals until a count from a picture
	// exists. Each branch end draws its own thorns, so the record's thorns at the nodes are left
	// out.
	extras: [
		...(record.extras ?? [])
			.filter((extra) => extra.kind !== 'thorn')
			.map((extra) =>
				extra.at === 'shoot-tip'
					? { ...extra, share: Math.min(1, extra.share * TIP_SHARE) }
					: extra,
			),
		// The leading shoots carry no branch end, so the record's thorn stands at their tips, where
		// it reads as the photographs' spikes past the mass.
		...(record.extras ?? [])
			.filter((extra) => extra.kind === 'thorn')
			.map((extra) => ({ ...extra, at: 'shoot-tip' as const, share: 0.5, tipShare: 1 })),
	],
};
