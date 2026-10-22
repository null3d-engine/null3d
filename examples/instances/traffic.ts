// Hover traffic above the field, from the traffic-lanes add-on. The lanes surround the field, so
// the cars stay a layer above the horizon and none passes near the lens. The add-on moves them in
// the vertex shader, so a frame's work is the same at 30,000 cars and at 100,000.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import {
	createTrafficLanes,
	createVehicleHull,
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

/** Builds the traffic of the field's sky. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	return createTrafficLanes(ctx, {
		mesh: createVehicleHull(ctx, SIZE),
		plan: {
			lines: LINES,
			// The lanes run on past the field, so the cars stream in from the haze.
			from: -1300,
			to: 1300,
			low: 16,
			high: 34,
			levels: 4,
			offset: 4,
		},
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
