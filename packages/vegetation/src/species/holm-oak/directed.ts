// The holm oak as a directed frame, in its clump form: eight slender stems from one swollen base
// that spread like the ribs of a vase, each with one slow S-bend, each forking three times under one
// shared dome. Each figure names the reference picture it was read on. Shares are of the plant's
// height. Still 01 and the whole-plant turning video are the one plant the frame follows.
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { record } from './record';

/**
 * The twigs that end a stem's wood: three from each second fork, each to the dome's shell, where it
 * carries a mass of foliage. Still 05: the bare wood ends at the crown's underside and the twigs
 * fill the dome above it. Still 21: a branch piece's leafy top is 0.6 m across.
 */
const twigs: FrameBranchRule = {
	name: 'twig',
	role: 'branch',
	count: 3,
	along: [1, 1],
	around: 'ring',
	jitter: 25,
	// Still 21: about 30 degrees each side of the axis.
	angle: 30,
	from: 'parent',
	angleSpread: 6,
	// A mass's foliage stands a twentieth of the height outside the twig's end. Still 09: a
	// twig spray is half a metre long at the least.
	length: { outline: 0.88 },
	vary: 0.06,
	least: 0.06,
	most: 0.4,
	radius: 0.65,
	taper: 0.3,
	// Still 01: the dome's rim droops a little.
	bends: [{ from: 0.4, to: 1, by: 12 }],
	sway: 14,
	elbows: 4,
	patch: { kind: 'mass', width: 0.16, depth: 0.1 },
};

/** A fork of a stem's wood. Still 08: 55 degrees between the arms, each 0.6 to 0.7 of the stem. */
function fork(name: string, length: number, children: readonly FrameBranchRule[]): FrameBranchRule {
	return {
		name,
		role: 'limb',
		// Stills 01 and 18: a stem forks into two, sometimes three.
		count: 2,
		along: [1, 1],
		around: 'ring',
		jitter: 25,
		angle: 27,
		from: 'parent',
		angleSpread: 5,
		length: { share: length },
		vary: 0.15,
		radius: 0.65,
		taper: 0.7,
		// Stills 05 and 18: the arms keep bending.
		sway: 16,
		elbows: 2,
		children,
	};
}

/** The holm oak's frame. */
export const frame: FrameSpec = {
	// Still 01, the dome's half width in bands from the top down to its flat foot.
	outline: evenOutline(
		[
			[0.34, 0.45],
			[0.354, 0.475],
			[0.396, 0.56],
			[0.438, 0.6],
			[0.479, 0.62],
			[0.521, 0.62],
			[0.563, 0.61],
			[0.604, 0.605],
			[0.688, 0.595],
			[0.729, 0.545],
			[0.771, 0.505],
			[0.813, 0.465],
			[0.854, 0.445],
			[0.896, 0.345],
			[0.938, 0.275],
			[0.979, 0.18],
			[1, 0],
		],
		// The dome is built nearly round. Still 01 looks across the wide side.
		0.8,
	),
	stems: {
		name: 'stem',
		// Still 01: eight stems, two of them near the middle.
		count: 8,
		inner: 2,
		// Still 01: the stool is 0.08 of the height wide, and the stems part at 0.07.
		ring: [
			[0, 0.008],
			[0.15, 0.01],
			[0.28, 0.03],
			[1, 0.03],
		],
		// Still 01: the inner stems lean 5 to 15 degrees and the outer ones 28 to 35.
		lean: [
			[0, 6],
			[0.15, 13],
			[0.28, 28],
			[1, 35],
		],
		// Stills 01 and 17: a stem is 0.04 of the height wide and holds its width to its fork.
		width: [
			[0, 0.05],
			[0.03, 0.04],
			[0.5, 0.036],
		],
		// Stills 01 and 18: a stem forks at 0.35 to 0.45, the middle ones highest.
		length: {
			height: [
				[0, 0.44],
				[0.28, 0.41],
				[1, 0.36],
			],
		},
		// Stills 01 and 06: one slow S to a stem. It leans out farther above the stool and stands
		// steeper under the crown, as a vase's rib does.
		bends: [
			{ from: 0.08, to: 0.45, by: 12 },
			{ from: 0.45, to: 1, by: -22 },
		],
		sway: 16,
		elbows: 2,
		children: [fork('arm', 0.12, [fork('fork', 0.13, [twigs])])],
	},
};

/**
 * The holm oak's record with the frame as its growth. A socket holds four shoot rows that fan 45
 * degrees from its line. These two are working figures, not measured ones: they stand until the
 * species' branch pieces are placed at its sockets, which then state what a socket holds.
 */
export const directed = framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45 });
