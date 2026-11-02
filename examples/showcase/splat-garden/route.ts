// The splat garden's camera route. It opens wide over the glade, with the blossoming tree and the
// lantern in view, then glides down to the lantern and along the fallen log over the moss, turns
// under the tree and rises into the blossom, passes out through the canopy's edge and climbs back
// to the opening view. The opening shot holds, so the image test's held frame lands on the view of
// the whole garden.
import type { Shot } from '../../lib/cinematic';

/** The point that the opening view and the Manual camera turn around. */
export const WIDE_LOOK: readonly [number, number, number] = [0.5, 1.9, 0];

export const SHOTS: readonly Shot[] = [
	// The opening: high over the glade, showing the tree, the lantern and the ring of mountains.
	{ position: [8.0, 3.0, 11.0], target: WIDE_LOOK, seconds: 0.9, move: 'hold' },
	// The same pose again, so the camera does not snap when the hold ends.
	{ position: [8.0, 3.0, 11.0], target: WIDE_LOOK, seconds: 6 },
	{ position: [6.6, 2.6, 9.2], target: [0.4, 1.9, 0.2], seconds: 5 },
	// Down to the lantern, which glows under its mossy roof.
	{ position: [6.0, 2.6, 7.4], target: [2.6, 1.6, 1.8], seconds: 5 },
	{ position: [3.4, 2.0, 4.8], target: [3.2, 1.45, 1.2], seconds: 4 },
	// Low over the moss and the fallen log, then a turn toward the tree.
	{ position: [1.4, 2.0, 3.2], target: [0.2, 0.8, 1.6], seconds: 4 },
	{ position: [-0.6, 2.2, 2.8], target: [-2.6, 1.2, -1.0], seconds: 5 },
	{ position: [-0.9, 2.8, 2.0], target: [-2.8, 3.4, -1.8], seconds: 5 },
	// Among the blossom, under the canopy.
	{ position: [1.4, 4.2, 1.4], target: [-2.0, 4.1, -1.2], seconds: 5 },
	// Out through the canopy's edge and up, back to the opening view.
	{ position: [5.6, 5.4, 6.6], target: [-0.6, 3.2, -0.6], seconds: 5 },
	{ position: [8.6, 5.2, 11.0], target: [0.2, 2.1, 0], seconds: 6 },
	{ position: [8.0, 3.0, 11.0], target: WIDE_LOOK, seconds: 4 },
];
