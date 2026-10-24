// The sky lanes of Skyway, from the traffic-lanes add-on. The add-on owns the lane movement, the
// vehicles' own lights, their bounds and the real lights nearest the camera. This file gives it the
// city's plan, how many cars each preset draws, and the demo's car colours.
import type { MeshGeometry, QualityPreset, SketchContext, Vec3Like } from '@null3d/engine';
import {
	createTrafficLanes,
	createVehicleHull,
	type HullDetail,
	type TrafficLanes,
} from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';
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

/** The vehicle's half width, height and half length, which the hull and the material's lights share. */
const VEHICLE = { halfWidth: 0.96, height: 1.1, halfLength: 2.0 };

/** The streets of the plan, as the centre lines that carry lanes. */
const LINES = Array.from({ length: BLOCKS + 1 }, (_, k) => streetLine(k));

/**
 * The hull each preset draws. Low is the preset that phones run, where a lane of 30,000 cars is the
 * largest cost of the frame, so it takes the light hull: the same silhouette and lights from a third
 * of the vertices. The presets above keep the full hull, whose faceted panels the close pictures
 * show.
 */
const detailOf = (preset: QualityPreset): HullDetail => (preset === 'low' ? 'light' : 'full');

/** Builds the traffic of the sky lanes, with the hull that its preset asks for. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	let detail = detailOf(ctx.quality.preset);
	let hull = createVehicleHull(ctx, VEHICLE, detail);
	let lanes = build(ctx, hull);

	/** Builds one set of lanes around `mesh`. */
	function build(context: SketchContext, mesh: MeshGeometry): TrafficLanes {
		return createTrafficLanes(context, {
			mesh,
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

	return {
		fit(preset) {
			// A preset that changes the hull builds the lanes again around the other one.
			const wanted = detailOf(preset);
			if (wanted !== detail) {
				lanes.dispose();
				hull.destroy();
				detail = wanted;
				hull = createVehicleHull(ctx, VEHICLE, wanted);
				lanes = build(ctx, hull);
			}
			lanes.fit(preset);
		},
		setCount(count) {
			lanes.setCount(count);
		},
		get count() {
			return lanes.count;
		},
		update(eye: Vec3Like, time: number) {
			lanes.update(eye, time);
		},
		dispose() {
			lanes.dispose();
			hull.destroy();
		},
	};
}
