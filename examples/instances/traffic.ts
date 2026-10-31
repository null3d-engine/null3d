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
const SIZE = { halfWidth: 0.95, height: 0.51, halfLength: 1.62 };

/** How far a lane sits from its line, so the two directions keep to their own side. */
const SIDE = 2;
/** How many levels each line carries. */
const LEVELS = 5;

/**
 * The lanes of the field's sky, listed one by one: each line carries two directions at each of
 * `LEVELS` heights, each direction keeping to its own side, and each lane has one speed so its
 * cars keep their gaps.
 */
function laneList(): Lane[] {
	const lanes: Lane[] = [];
	for (const [i, line] of LINES.entries()) {
		const inner = 1 - i / Math.max(1, LINES.length - 1);
		for (let level = 0; level < LEVELS; level++) {
			const altitude = 16 + (level * (34 - 16)) / (LEVELS - 1);
			const speed = 26 + inner * 8 - level * 1.5;
			lanes.push({ heading: 0, across: line - SIDE, altitude, speed });
			lanes.push({ heading: 1, across: line + SIDE, altitude, speed });
		}
	}
	return lanes;
}

/** Builds the traffic of the field's sky. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	return createTrafficLanes(ctx, {
		mesh: createVehicleHull(ctx, SIZE),
		// The lanes are listed rather than laid out as a grid, so each keeps to its own side of a
		// line and carries one speed: the inner lines run faster, and each line's level above the
		// field is a little slower than the one below it.
		plan: { from: -1300, to: 1300, lanes: laneList() },
		counts: CARS,
		look: {
			body: '#2c3a52',
			tail: '#ff5a3c',
			nose: '#dfe9ff',
			skirt: '#3a7fb0',
			glow: 2,
			size: [SIZE.halfWidth, SIZE.height, SIZE.halfLength],
		},
		// The four nearest cars carry a real light, so the traffic washes the field below it.
		realLights: 4,
	});
}
