// The creek's camera route, which `createCinematic` plays and the scene's own checks measure the
// plants and the ground against. It lives apart from the sketch so the placement and the tests read
// it without loading the scene.
import type { Shot } from '../../lib/cinematic';
import { streamZ } from './land';

/**
 * The cinematic route. It opens high over the whole valley, showing the stream, both banks and the
 * trees at once. It glides down behind the near bank's trees and runs along them to the end of the
 * line, facing across to the far bank, then turns back down the valley. It drops to the water and
 * traces the stream's own winding line back past the trees with no pause, then turns right to run
 * behind the far bank's trees, facing the near bank. Last it circles out around the creek's head to
 * the opening view, with the middle of the creek in frame, and zooms back to the opening distance.
 * The opening shot holds only briefly, so a held frame lands on a settled pose and the camera moves
 * off it at once; the low passes stay over the stream, so the camera never enters a tree or a bank.
 * The opening pose repeats in the second shot: a shot starts at its own pose, so without the repeat
 * the camera would snap when the hold ends.
 *
 * The valley's plants are placed by the vegetation add-on's rules, so the route is measured against
 * them ([`valley.ts`](valley.ts)): a plant that a pose would fly into is not placed. An edit here
 * therefore changes which plants stand, and `route.test.ts` holds the clearance.
 */
export const WIDE: readonly [number, number, number] = [-23, 13, 19];
/** The point that the opening shot looks at, over the middle of the creek. */
export const WIDE_LOOK: readonly [number, number, number] = [2, 0, 0];

export const SHOTS: readonly Shot[] = [
	// The opening: high over the valley with the whole stream in view. It holds briefly, so the
	// image test's held frame lands on a settled pose and the auto camera moves off it quickly.
	{ position: WIDE, target: WIDE_LOOK, seconds: 1, move: 'hold' },
	// The same pose, then the glide to the near bank: the repeat avoids a snap at the hold's end.
	{ position: WIDE, target: WIDE_LOOK, seconds: 7 },
	// Behind the near bank's trees, looking across to the far bank.
	{ position: [-17, 5, 12.5], target: [-11, 1, -7], seconds: 6 },
	// Along behind the near tree line, still facing the far bank.
	{ position: [6, 5, 14.5], target: [10, 1, -6], seconds: 6 },
	// The end of the near tree line: it turns to face back down the valley here.
	{ position: [26, 5, 15.5], target: [28, 1, -4], seconds: 7 },
	// Down to the water, tracing the stream's own winding line back down the valley. The camera
	// sinks under the surface and glides along the bed for about six seconds, between the stones,
	// then rises out of the water again. The dip passes through the surface on purpose.
	{ position: [26, 1, streamZ(26)], target: [14, -0.1, streamZ(14)], seconds: 4, through: true },
	{ position: [17, -0.15, streamZ(17)], target: [5, -0.2, streamZ(5)], seconds: 5, through: true },
	{ position: [8, -0.16, streamZ(8)], target: [-4, -0.16, streamZ(-4)], seconds: 4, through: true },
	{ position: [1.5, 1.8, streamZ(1.5)], target: [-10.5, 0.5, streamZ(-10.5)], seconds: 6 },
	{ position: [-12.5, 2.2, streamZ(-12.5)], target: [-22, 0.6, streamZ(-22)], seconds: 7 },
	// Right to the far bank, behind its trees and facing back over the water.
	{ position: [-12.5, 4.5, -18], target: [-6, 1, 6], seconds: 7 },
	// Along the back of the far bank's trees, all the way down the valley.
	{ position: [-22, 4.5, -18], target: [-16, 1, 6], seconds: 7 },
	// Circle out around the creek's head to the opening view, keeping the middle of the creek in
	// frame and zooming back to the opening distance, so the loop closes on the opening pose.
	{ position: [-27, 7, 2], target: [1, 0.5, 0], seconds: 8 },
];
