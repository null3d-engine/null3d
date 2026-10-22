// The sky lanes of Skyway, from the traffic-lanes add-on. The add-on owns the lane movement, the
// vehicles' own lights, their bounds and the real lights nearest the camera. This file gives it the
// city's plan, how many cars each preset draws, and the demo's car colours.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { createTrafficLanes, type TrafficLanes } from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';
import { carHull } from './hull';
import {
	BLOCKS,
	LANE_HIGH,
	LANE_LOW,
	LANE_OFFSET,
	LANE_SPAN,
	LANES_PER_STREET,
	streetLine,
} from './layout';

/** How many cars each preset draws. */
export const CARS: Record<QualityPreset, number> = {
	low: 30_000,
	medium: 50_000,
	high: 75_000,
	ultra: 100_000,
};

/** The streets of the plan, as the centre lines that carry lanes. */
const LINES = Array.from({ length: BLOCKS + 1 }, (_, k) => streetLine(k));

/** Builds the traffic of the sky lanes. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	return createTrafficLanes(ctx, {
		mesh: carHull(ctx),
		plan: {
			lines: LINES,
			from: -LANE_SPAN / 2,
			to: LANE_SPAN / 2,
			low: LANE_LOW,
			high: LANE_HIGH,
			levels: LANES_PER_STREET,
			offset: LANE_OFFSET,
		},
		counts: CARS,
		look: {
			body: '#20242c',
			tail: '#ff3a12',
			nose: '#cfe6ff',
			skirt: '#22c8ff',
			glow: 2.2,
			size: [0.96, 1.1, 2.0],
		},
		layers: EFFECT_LAYER,
		// Six of the nearest cars carry a real light, so the road around the camera catches them.
		realLights: 6,
	});
}
