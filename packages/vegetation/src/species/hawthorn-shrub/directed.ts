// The hawthorn as a directed frame, in its shrub form: eight thin stems that leave the soil at one
// place and fan out, each a zigzag that gives off a limb at every turn, each limb a zigzag with its
// own twigs, all under one dome, and a straight leafy leading shoot at every end, which stands out
// of the mass. Each figure
// names the reference picture it was read on. Shares are of the plant's height. Still 01 and the
// whole-plant turning video are the one plant the frame follows.
import { type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { record } from './record';

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
 * The mass at a branch end. Stills 06 and 03: tufts fill the dome from its surface inward for about
 * 0.15 of the height.
 */
const mass = { kind: 'mass', width: 0.2, depth: 0.16 } as const;

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
	name: 'twig',
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
	outline: [
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
	plan: { narrow: 0.85, turn: 0 },
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

/**
 * The hawthorn's record with the frame as its growth. A socket holds four shoot rows that fan 45
 * degrees from its line. These two are working figures, not measured ones: they stand until the
 * species' branch pieces are placed at its sockets, which then state what a socket holds.
 */
export const directed = framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45 });
