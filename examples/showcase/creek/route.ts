// The creek's camera route, which `createCinematic` plays and the scene's own checks measure the
// ground and the walls against. It lives apart from the sketch so the tests read it without loading
// the scene.
import type { Shot } from '../../lib/cinematic';
import { streamHalf, streamZ } from './land';

/**
 * The cinematic route. It opens on the whole cliff from high at the front, looking down on the
 * garden as the concept picture does, and holds there only briefly, so a held frame lands on a
 * settled pose and the camera moves off it at once. It circles the cliff over the sea of cloud,
 * then comes down to the east lip and runs low along the creek, back toward the spring pool. On the
 * way the camera sinks under the surface and glides along the bed for about six seconds, between
 * the stones, then rises out of the water and runs on past the pool to the west lip, where the
 * creek leaves over the edge into the cloud. Last it climbs back to the opening view, which closes
 * the loop. The opening pose repeats in the second shot: a shot starts at its own pose, so without
 * the repeat the camera would snap when the hold ends.
 */
export const WIDE: readonly [number, number, number] = [20.5, 14.3, 42.9];
/** The point that the opening shot looks at, over the creek in front of the garden's middle. */
export const WIDE_LOOK: readonly [number, number, number] = [7.7, 1, 16];

/**
 * A point over the creek at x, at a height, and across it by a share of its half width: 0 on its
 * middle line, below 0 toward its north bank.
 */
const over = (x: number, y: number, across = 0): readonly [number, number, number] => [
	x,
	y,
	streamZ(x) + across * streamHalf(x),
];

/** The point that the orbit looks at, over the garden's middle. */
const MIDDLE: readonly [number, number, number] = [0, 1.5, 4];

export const SHOTS: readonly Shot[] = [
	// The opening: the whole cliff from high at the front. It holds briefly, so the image test's
	// held frame lands on a settled pose and the auto camera moves off it quickly.
	{ position: WIDE, target: WIDE_LOOK, seconds: 1, move: 'hold' },
	// The same pose, then round the cliff over the cloud, looking in at the garden.
	{ position: WIDE, target: WIDE_LOOK, seconds: 7 },
	{ position: [-15.7, 18, 43.2], target: MIDDLE, seconds: 7 },
	{ position: [-43.2, 18, 15.7], target: MIDDLE, seconds: 7 },
	// Low past the walls on the far side, where the cloud banks rise against the rock.
	{ position: [-37, 3, -22], target: [0, 2, 0], seconds: 7 },
	{ position: [-8, 19, -45.3], target: MIDDLE, seconds: 7 },
	{ position: [29.6, 18, -35.2], target: MIDDLE, seconds: 7 },
	{ position: [45.3, 15, -8], target: MIDDLE, seconds: 7 },
	// Down to the east lip, then low along the creek toward the pool. The camera sinks under the
	// surface and glides along the bed, between the stones, then rises out of the water again. The
	// dip passes through the surface on purpose.
	{ position: [34, 6, 24], target: over(12, 1.5), seconds: 7 },
	{ position: over(18, 1, -0.3), target: over(6, -0.1, -0.3), seconds: 4, through: true },
	{ position: over(12, -0.16, -0.35), target: over(0, -0.2, -0.2), seconds: 5, through: true },
	{ position: over(5.5, -0.18, -0.3), target: over(-6.5, -0.18), seconds: 4, through: true },
	{ position: over(-2.5, 1.5), target: over(-14.5, 0.5), seconds: 6 },
	// On past the pool toward the west lip, then out over the near bank, looking back at the lip
	// where the creek leaves over the edge into the cloud.
	{ position: over(-12, 1.8), target: over(-19.5, 0.4), seconds: 6 },
	{ position: [-17, 4.5, 24], target: [-19, 0.5, 14], seconds: 7 },
	// Up and round to the opening view, which closes the loop.
	{ position: [-14, 12, 40], target: [-4, 1.5, 12], seconds: 8 },
];
