// The giant sequoia as a directed frame: the trunk, the limb levels and each limb's course, read
// from the reference set and stated here. Shares are of the tree's height. Still 01 and the
// whole-tree turning video are one tree, and every figure is that tree's unless its line says
// another still.
import type { BarkSpec, BaseSpec, Species } from '../../core/record';
import { curveAt } from '../../core/types';
import { PIECES } from './pieces';
import { record } from './record';

/** The record's stem base without its surface roots. */
const { roots: _roots, ...foot } = record.base as BaseSpec;

/**
 * Still 01, the crown's half width by height: the far edge of the longest limb's foliage at that
 * height. The limbs reach to it and the inner body takes its share of it.
 */
const CROWN_REACH = [
	[0.34, 0.115],
	[0.38, 0.135],
	[0.46, 0.153],
	[0.54, 0.152],
	[0.62, 0.14],
	[0.7, 0.128],
	[0.78, 0.114],
	[0.86, 0.093],
	[0.94, 0.063],
	[0.98, 0.039],
] as const;

/**
 * The inner body's share of the crown's reach: the shaded depth of the crown, which stands behind
 * the boughs so that the gaps between the clumps show the crown's own shade and never open sky.
 */
const BODY = 0.66;

/**
 * The inner body's half width at each height, as a share of the plant's height: the crown's own
 * share of its measured reach. Its foot stands inside the trunk at the crown's base, so no free rim
 * shows below the lowest boughs, and it closes to nothing at the tip.
 */
const BODY_RADIUS: readonly (readonly [number, number])[] = [
	[0.31, 0.045],
	[0.36, 0.075],
	[0.4, 0.1],
	[0.46, curveAt(CROWN_REACH, 0.46) * BODY],
	[0.54, curveAt(CROWN_REACH, 0.54) * BODY],
	[0.62, curveAt(CROWN_REACH, 0.62) * BODY],
	[0.7, curveAt(CROWN_REACH, 0.7) * BODY],
	[0.78, curveAt(CROWN_REACH, 0.78) * BODY],
	[0.86, curveAt(CROWN_REACH, 0.86) * BODY],
	[0.94, curveAt(CROWN_REACH, 0.94) * BODY],
	[0.98, curveAt(CROWN_REACH, 0.98) * BODY],
	[1, 0],
];

/**
 * The inner body's tint on its bark: the drawn foliage's linear colour over the drawn bole's, a
 * third of it, since the crown's shade is a third of its lit leaves. The foliage is still 21's
 * studio spray and the bole still 01's trunk, both as the engine draws them.
 */
const BODY_TINT = [0.22, 0.86, 0.9] as const;

/**
 * The species' leaf at the top of its stated 3 to 6 mm: still 21's cord is a rope of scales 6 to 7 mm
 * thick. The old record keeps the leaf for the crown it grows; this plant takes the cord's own size.
 */
const foliage: Species['foliage'] =
	record.foliage.kind === 'needle'
		? {
				...record.foliage,
				needle: {
					...record.foliage.needle,
					length: { mean: 0.006, spread: 0.001 },
					width: 0.0035,
				},
			}
		: record.foliage;

/** The giant sequoia's record with the directed frame in place of the grown one. */
export const directed: Species = {
	...record,
	pieces: PIECES,
	foliage,
	// Still 01: the trunk is 0.21 of the height across at breast height, on its flare.
	size: { ...record.size, dbh: 12 },
	growth: {
		model: 'conifer',
		trunk: {
			// Still 01, the run of wood through the trunk's line: 0.173 at 0.06 of the height, 0.138
			// at 0.10, 0.121 at 0.14, 0.103 at 0.22, 0.092 at 0.30 and 0.087 at 0.44. The foot's own
			// widening below 0.06 is the stem base's. Above half the height the foliage hides the
			// trunk, so the taper to the tip is a straight line, not a measure.
			width: [
				[0, 0.19],
				[0.06, 0.173],
				[0.1, 0.138],
				[0.14, 0.121],
				[0.22, 0.103],
				[0.3, 0.092],
				[0.44, 0.087],
				[1, 0.012],
			],
			// Stills 01 and 18: the trunk runs to the top as one leader, under a rounded crown.
			dividesAt: 1,
			wander: 0.3,
		},
		limbs: {
			// Still 01: twelve limb levels show at the outline between the crown's base, at 0.31 of
			// the height, and its top, about 0.055 of the height apart. A lower limb dips before it
			// hooks up and its clump is a ball on its end, so the lowest level stands above the
			// crown's base and its clumps' floors fall to it.
			levels: [0.395, 0.447, 0.499, 0.551, 0.603, 0.655, 0.707, 0.759, 0.811, 0.863, 0.915, 0.97],
			// Twelve levels show on each side and about eight clumps stand before the trunk: four or
			// five limbs a level. The count is worked out, not counted on a picture.
			count: 54,
			// Still 05: the limbs leave one at a time at many heights.
			stagger: 0.02,
			jitter: 15,
			// Still 01, limbs read on a grid: the lower limbs leave 18 to 35 degrees below level, the
			// middle ones level within 15 degrees, the upper ones 20 to 45 degrees above level and
			// the top ones about 60.
			leave: [
				[0.31, -27],
				[0.5, -10],
				[0.65, 0],
				[0.8, 30],
				[0.97, 60],
			],
			// Stills 05, 06 and 16: a limb dips along its run and hooks up at its end. Still 06's
			// limb bends up about 90 degrees.
			run: [
				[0.31, -32],
				[0.5, -18],
				[0.65, -8],
				[0.8, 22],
				[0.97, 55],
			],
			// The top limbs run up under the crown's rounded top, so they end no higher than the
			// pictures' top limbs leave, and their hook stays inside the crown.
			end: [
				[0.31, 50],
				[0.65, 60],
				[0.97, 60],
			],
			riseOver: 0.01,
			endOver: 0.4,
			// Still 01, the crown's half width by height.
			reach: CROWN_REACH,
			// The crown is round within 5 per cent through the turning video, so the limbs of a level
			// reach alike.
			reachShare: [
				[0, 0.85],
				[1, 1],
			],
			plan: { narrow: 0.95, turn: 0 },
			// Still 01: a limb is 0.10 of the trunk's width at its base. Still 05, from below: one
			// sixth to one eighth.
			radius: [0.1, 0.15],
			// Still 07: a swollen collar, with thick trunk bark lapping onto the limb.
			collar: { swell: 1.5, over: 0.01 },
			// No picture shows a limb's outer part, so its taper is a working figure.
			taper: 0.6,
			wander: 4,
			// Stills 01 and 05: a limb carries two to four clumps. Still 08: a fork of about 50
			// degrees.
			arms: { count: 2, angle: 25, radius: 0.7 },
		},
		// Still 01: the crown is one continuous column of clumps, not separate tiers of them, so its
		// sockets tile the whole measured outline from the crown's foot to its top.
		patch: {
			kind: 'shell',
			each: 'limb',
			width: [0.04, 0.06],
			depth: 1,
			sockets: { piece: 'bough', pitch: 0.55, rise: 0.55, lift: 20 },
		},
		// The crown's shaded depth behind the boughs: the clumps stand on it, and the sky between
		// them is the photograph's dark interior rather than open air.
		body: { radius: BODY_RADIUS },
	},
	lod: {
		...record.lod,
		// A bough's card holds its whole bough, as the pine's does, so the boughs draw whole from
		// the size at which the pine's do.
		switchPixels: [320, record.lod.switchPixels[1], record.lod.switchPixels[2]],
		// A cord's brush picture is many times longer than wide, and a bough carries about eighty
		// cords: each takes one stretch, three quads, so the bough's brushes cost a few hundred
		// triangles.
		cardCuts: { most: 1 },
		// A socket's twig leaves a limb or an arm, so each level keeps the wood its rows stand on:
		// the arms at the first and the limbs at the second.
		woodOrders: [2, 1],
		// Each card draws its own stalk from the wood it stands on to its foliage, four triangles of
		// its ten, so no branch under it is drawn to join it.
		cardStalk: 1,
		cardStalkToFoliage: true,
		// The second level keeps every second of its cards, each grown by the root of two, and keeps
		// the cards' area within a hundredth.
		cardShare: [1, 0.5],
		// Still 21: a bough carries two cones 6.5 cm long, under a pixel or a few at the card levels'
		// distances, where drawing them would cost 66,572 triangles of the first level's 152,000.
		extrasFrom: 1,
	},
	base: {
		...foot,
		// Stills 01 and 02: 8 to 9 root lobes show across the front of the foot, about 17 round it,
		// and no root runs out over the ground beyond the flare. The trunk's width and the flare
		// already make the foot 0.296 of the height across at the ground, so the lobes ridge it
		// rather than widen it.
		...(foot.buttress
			? { buttress: { ...foot.buttress, lobes: { mean: 17, spread: 1 }, amount: 0.06 } }
			: {}),
		// Still 01: the foot is 0.296 of the height across at the ground and 0.173 at 0.06 of the
		// height, on its root lobes.
		flare: { amount: 0.15, height: 0.8 },
	},
	bark: {
		...(record.bark as BarkSpec),
		zones: [
			...((record.bark as BarkSpec).zones ?? []),
			// The inner body takes the crown's shade. Its radius stands well above the trunk's through
			// the crown and falls below the trunk's only above the crown's shoulders, so two radius
			// bands hold it and no trunk or limb: the body's own column, and its tip. Each band holds
			// from above the trunk's thickest radius at the crown's base of the shortest plant drawn,
			// up past the tallest plant's top.
			{
				layer: 0,
				by: 'radius',
				from: 3,
				to: 8,
				blend: 0.02,
				tint: BODY_TINT,
				second: { from: 15, to: 62, blend: 0.02 },
			},
			{
				layer: 0,
				by: 'radius',
				from: 1.2,
				to: 3,
				blend: 0.02,
				tint: BODY_TINT,
				second: { from: 48, to: 62, blend: 0.02 },
			},
		],
	},
};
