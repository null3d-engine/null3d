// The sky lanes of Skyway, from the traffic-lanes add-on. The add-on owns the lane movement, the
// vehicles' own lights, their bounds and the real lights nearest the camera. This file gives it the
// city's plan, how many cars each preset draws, and the demo's car colours.
import type { MeshGeometry, QualityPreset, SketchContext, Vec3Like } from '@null3d/engine';
import {
	createFlyingCarHull,
	createTrafficLanes,
	type HullDetail,
	type TrafficLanes,
} from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';
import { LANE_SPAN, skyLanes } from './layout';

/**
 * How many cars each preset draws. A count spreads over every lane of the plan, about half of which
 * runs past the city into the haze. At High a car in the city follows the one ahead by about 90 m,
 * the gap of a busy road at the lanes' speeds.
 */
export const CARS: Record<QualityPreset, number> = {
	low: 6_000,
	medium: 9_000,
	high: 12_000,
	ultra: 16_000,
};

/** The vehicle's half width, height and half length, which the hull and the material's lights share. */
const VEHICLE = { halfWidth: 0.96, height: 1.1, halfLength: 2.0 };

/** The colours of the traffic's cars, which the roaming cars share. */
export const CAR_LOOK = {
	body: '#20242c',
	tail: '#ff3a12',
	nose: '#cfe6ff',
	neon: '#22c8ff',
	windows: '#2a5a70',
} as const;

/** The lanes of every street. */
const LANES = skyLanes();

/**
 * The hull each preset draws. Low is the preset that phones run, where the lanes' cars are the
 * largest cost of the frame, so it takes the light hull: the same silhouette and lights from a third
 * of the vertices. The presets above keep the full hull, whose faceted panels the close pictures
 * show.
 */
const detailOf = (preset: QualityPreset): HullDetail => (preset === 'low' ? 'light' : 'full');

/** Builds the traffic of the sky lanes, with the hull that its preset asks for. */
export function createTraffic(ctx: SketchContext): TrafficLanes {
	let detail = detailOf(ctx.quality.preset);
	let hull = createFlyingCarHull(ctx, VEHICLE, detail);
	let lanes = build(ctx, hull);

	/** Builds one set of lanes around `mesh`. */
	function build(context: SketchContext, mesh: MeshGeometry): TrafficLanes {
		return createTrafficLanes(context, {
			mesh,
			plan: { from: -LANE_SPAN / 2, to: LANE_SPAN / 2, lanes: LANES },
			counts: CARS,
			look: {
				body: CAR_LOOK.body,
				tail: CAR_LOOK.tail,
				nose: CAR_LOOK.nose,
				skirt: CAR_LOOK.neon,
				glow: 2.2,
				size: [0.96, 1.1, 2.0],
				// Tinted windows, a deep teal, over each car's lit cabin.
				windows: CAR_LOOK.windows,
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
				hull = createFlyingCarHull(ctx, VEHICLE, wanted);
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
