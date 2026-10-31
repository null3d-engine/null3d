// Hover traffic above the field, from the traffic-lanes add-on. The lanes surround the field, so
// the cars stay a layer above the horizon and none passes near the lens. The add-on moves them in
// the vertex shader, so a frame's work is the same at 30,000 cars and at 100,000.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import {
	createTrafficLanes,
	createVehicleHull,
	type Lane,
	type TrafficLanes,
} from '../addons/traffic-lanes/index';

/** How many cars each preset draws. */
export const CARS: Record<QualityPreset, number> = {
	low: 30_000,
	medium: 50_000,
	high: 75_000,
	ultra: 100_000,
};

/** The lines that carry lanes, in meters from the field's middle, and the cars' size. */
const LINES = [-75, -55, -35, 35, 55, 75];
const SIZE = { halfWidth: 0.7, height: 0.38, halfLength: 1.2 };

/** How far a lane sits from its line, so every direction keeps to its own side. */
const SIDE = 4;
/**
 * The height of each level, in meters. The gaps grow with height, so the lanes sit closer
 * together low down and the rows pack toward the horizon.
 */
const HEIGHTS = [16, 17.2, 18.7, 20.6, 23, 26, 29.5, 34];

/**
 * The four directions, each on its own right-hand side of a line: the heading's index and the sign
 * of the side it keeps to.
 */
const HEADINGS = [
	{ heading: 0, side: 1 },
	{ heading: 1, side: -1 },
	{ heading: 2, side: -1 },
	{ heading: 3, side: 1 },
] as const;

/**
 * The lanes of the field's sky, listed one by one: each line carries four directions at each of
 * `HEIGHTS` levels, each direction keeping to its own side, and each lane has one speed so its
 * cars keep their gaps. Every heading lists its own rows, so the cars spread as widely as the grid
 * plan spread them and stay short against the sky.
 */
function laneList(): Lane[] {
	const lanes: Lane[] = [];
	for (const [i, line] of LINES.entries()) {
		const inner = 1 - i / Math.max(1, LINES.length - 1);
		for (const [level, height] of HEIGHTS.entries()) {
			// A small lift that changes from line to line keeps the rows from aligning.
			const lift = (((i * 5 + level * 3) % 7) - 3) * 0.25;
			for (const { heading, side } of HEADINGS) {
				const speed = 24 + inner * 10 + ((level * 3 + i) % 5) - (heading % 2) * 1.5;
				lanes.push({ heading, across: line + side * SIDE, altitude: height + lift, speed });
			}
		}
	}
	return lanes;
}

/** Builds the traffic of the field's sky. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	return createTrafficLanes(ctx, {
		mesh: createVehicleHull(ctx, SIZE),
		// The lanes are listed rather than laid out as a grid, so each keeps to its own side of a
		// line and carries one speed: the inner lines run faster, and the four directions keep
		// their own pace.
		plan: { from: -1300, to: 1300, lanes: laneList() },
		counts: CARS,
		look: {
			body: '#2c3a52',
			tail: '#ff5a3c',
			nose: '#dfe9ff',
			skirt: '#3a7fb0',
			glow: 0.5,
			size: [SIZE.halfWidth, SIZE.height, SIZE.halfLength],
		},
		// The four nearest cars carry a real light, so the traffic washes the field below it.
		realLights: 4,
	});
}
