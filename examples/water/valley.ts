// The Water demo's valley: the river's course, the lake, the stream that runs out of it, the
// ground that holds them, the boulders along the banks, and the camera's tour. The tour is one loop with no cut: the camera drifts down
// the river, dips under the lake and swims below its surface, rises, turns to face back over the
// scene, and circles the valley back to where it started.
import { math } from '@null3d/engine';
import type { Shot } from '../lib/cinematic';

/** The lake's middle and its two radii, in meters. */
export const LAKE = { x: 54, z: 0, rx: 34, rz: 24 } as const;
/** Where the river starts, near the ground's west edge, and where it meets the lake. */
export const FROM = -250;
export const TO = LAKE.x - LAKE.rx + 3;
/** Where the stream that leaves the lake starts, inside its east shore, and where it ends. */
export const OUT_FROM = LAKE.x + LAKE.rx - 3;
export const OUT_TO = 250;
/** The stretch of the river that holds the boulders, and the foam map that covers it. */
export const ROCKS_FROM = -150;

/** The z of the valley's stream at x, and the half width of its water there. */
export const middleZ = (x: number) => 1.8 * Math.sin(x * 0.07 + 0.4) + 0.6 * Math.sin(x * 0.17);
export const halfWidth = (x: number) => 2.6 + 0.4 * Math.sin(x * 0.11 + 1.2);
/** How far a point lies from the lake's middle, in radii: 1 at its shore. */
const fromLake = (x: number, z: number) => Math.hypot((x - LAKE.x) / LAKE.rx, z / LAKE.rz);

/** The height of the ground at a point: a stream's channel down the whole valley, which deepens
 * into a lake basin. */
export function ground(x: number, z: number): number {
	const across = Math.abs(z - middleZ(x)) / halfWidth(x);
	const river = 1 - math.smoothstep(across, 0.9, 1.5);
	const lake = 1 - math.smoothstep(fromLake(x, z), 0.9, 1.1);
	const basin = Math.max(river, lake);
	const bed = -1.2 - 2.6 * lake;
	const bank =
		0.5 +
		0.4 * Math.sin(x * 0.045 + 1) * Math.sin(z * 0.05) +
		0.03 * Math.max(0, Math.abs(z) - 24) ** 1.4;
	return bank + (bed - bank) * math.smoothstep(basin, 0, 1);
}

/** The boulders along the river's banks, which break the water: each one's place and size. */
export const STONES = Array.from({ length: 18 }, (_, i) => {
	const x = ROCKS_FROM + 12 + (i / 18) * (TO - ROCKS_FROM - 16);
	const side = i % 2 === 0 ? 1 : -1;
	return { x, z: middleZ(x) + side * (halfWidth(x) - 0.5), r: 0.55 + (i % 3) * 0.18 };
});

/**
 * The camera's tour, one loop of shots. The first shot is the camera's starting pose, which the
 * held frame shows, and the loop comes back to it.
 */
export const SHOTS: readonly Shot[] = [
	{ position: [-42, 2.4, 12], target: [-12, 0, 1], seconds: 10 },
	// Down the river along its bank, a few meters from the boulders, then over the water past the
	// last of them.
	{ position: [-20, 2.2, 8.5], target: [6, 0, 1], seconds: 10 },
	{ position: [-2, 2, 7.5], target: [22, 0, 1.5], seconds: 9 },
	{ position: [14, 1.6, 6], target: [38, -0.3, 1], seconds: 7 },
	// Into the lake, and under its surface.
	{ position: [28, 0.3, 1], target: [50, -0.8, 0], seconds: 6 },
	{ position: [38, -1.2, 0], target: [58, -2.2, 1], seconds: 9 },
	{ position: [50, -1.5, 1], target: [68, -2, 2], seconds: 9 },
	{ position: [60, -0.9, 1], target: [78, -0.6, 1], seconds: 6 },
	// Up through the surface in the middle of the lake, rising as it turns left to face back over
	// the scene.
	{ position: [67, 1.5, 0], target: [95, 2, 3], seconds: 9 },
	{ position: [72, 4.5, 3], target: [66, 3, 40], seconds: 9 },
	{ position: [70, 7, 10], target: [24, 0, 2], seconds: 10 },
	// A slow circle round the valley to the start.
	{ position: [58, 8, 38], target: [14, 0, 0], seconds: 14 },
	{ position: [20, 9, 50], target: [6, 0, 0], seconds: 14 },
	{ position: [-20, 8, 44], target: [-8, 0, 2], seconds: 14 },
	{ position: [-46, 5, 26], target: [-16, 0, 2], seconds: 12 },
];
