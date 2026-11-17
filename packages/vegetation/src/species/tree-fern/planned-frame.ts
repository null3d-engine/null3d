// The tree fern as a frame: one stout fibrous trunk from the root mound to the growing point, and
// no children. The crown is the rosette's fronds, not a woody axis, so the frame states the trunk
// and the crown's outline that the fronds' own reach meets.
//
// The outline is picture 01's measured half width by height, left and right averaged, from the
// ground. The trunk's width is the still's 0.1606 of the height, nearly parallel; the foot's flare
// is the record's own base.
import type { Curve } from '../../core/types';
import { evenOutline, type FrameSpec } from '../../grow/frame';

/**
 * Picture 01's half width by height, from the ground: the root mound at the foot, the trunk's own
 * width to the crown's base at 0.385, then the crown's dome, widest at the middle third and ending
 * in a still-broad rounded top.
 */
const REACH: Curve = [
	[0, 0.178],
	[0.09, 0.15],
	[0.16, 0.084],
	[0.28, 0.078],
	[0.385, 0.078],
	[0.42, 0.4],
	[0.47, 0.461],
	[0.53, 0.484],
	[0.59, 0.49],
	[0.66, 0.497],
	[0.72, 0.486],
	[0.78, 0.472],
	[0.84, 0.462],
	[0.91, 0.39],
	[0.97, 0.28],
	[1, 0.08],
];

/**
 * The turning video's crown width runs 0.892 to 1.02 of the height; the narrow side is about 0.93
 * of the wide, and the record's `roundBand` 0.25 admits no narrower plant.
 */
const NARROW = 0.93;

/** The soft tree fern's frame. */
export const frame: FrameSpec = {
	outline: evenOutline(REACH, NARROW),
	stems: {
		name: 'trunk',
		count: 1,
		// Stills 01 and 17 and the video: one width from the mound to the crown, 0.16 of the height.
		width: [
			[0, 0.16],
			[0.1, 0.158],
			[0.7, 0.155],
			[1, 0.152],
		],
		// Picture 01: the growing point, where the fronds meet, at 0.72 of the height.
		length: { share: 0.73 },
		sway: 0.6,
		elbows: 1,
	},
};
