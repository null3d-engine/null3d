// The giant sequoia as a directed frame: the trunk, the limb levels and each limb's course, read
// from the reference set and stated here. Shares are of the tree's height. Still 01 and the
// whole-tree turning video are one tree, and every figure is that tree's unless its line says
// another still.
import type { BaseSpec, Species } from '../../core/record';
import { record } from './record';

/** The giant sequoia's record with the directed frame in place of the grown one. */
export const directed: Species = {
	...record,
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
			// the height, and its top, 0.055 of the height apart.
			levels: [0.33, 0.385, 0.44, 0.495, 0.55, 0.605, 0.66, 0.715, 0.77, 0.825, 0.88, 0.935],
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
			end: [
				[0.31, 50],
				[0.65, 60],
				[0.97, 75],
			],
			riseOver: 0.01,
			endOver: 0.4,
			// Still 01, the crown's half width by height.
			reach: [
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
			],
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
		// Still 01: separate rounded clumps 0.04 to 0.06 of the height across, one on each end.
		patch: { kind: 'dome', each: 'end', width: [0.04, 0.06], depth: 1 },
	},
	base: {
		...(record.base as BaseSpec),
		// Still 01: the foot is 0.296 of the height across at the ground and 0.173 at 0.06 of the
		// height, on its root lobes.
		flare: { amount: 0.56, height: 1.2 },
	},
};
