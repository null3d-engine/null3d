// Each showcase scene's Auto route against its Manual camera's bounds and its shadow range
// ([D-170](../../.dev/decisions/D-170-showcase-camera.md), owner, 20 October 2026). Every pose of
// the route lies inside the bounds, so taking the camera over at any moment never moves it, and the
// sun's shadow range reaches past the scene's core from every pose, so the core's shadows never
// vanish as the route draws back.
import { describe, expect, it } from 'bun:test';
import * as creekLand from '../showcase/creek/land';
import * as creek from '../showcase/creek/sketch';
import * as townLand from '../showcase/night-town/land';
import * as town from '../showcase/night-town/sketch';
import {
	BOUNDED_POLAR_ANGLE,
	type CameraBounds,
	keepInside,
	routePosition,
	routeTimeline,
} from './cinematic';
import { mountainRing } from './mountains';
import { shadowStep } from './showcase-effects';

/** How many points of the loop the checks sample, finely enough for the spline's bends. */
const SAMPLES = 2000;

const SCENES = [
	{ name: 'night town', land: townLand, sketch: town },
	{ name: 'creek', land: creekLand, sketch: creek },
];

for (const { name, land, sketch } of SCENES) {
	describe(`the ${name}'s route`, () => {
		const ring = mountainRing(land.mountainSettings(160, 32));
		const bounds: CameraBounds = {
			...sketch.BOUNDS,
			ground: (x, z) => Math.max(land.groundHeight(x, z), ring.heightAt(x, z)),
		};
		const route = routeTimeline(sketch.SHOTS);
		const pose = new Float32Array(6);
		const at = (step: number) => {
			routePosition(route, (step / SAMPLES) * route.total, pose);
			return {
				position: [pose[0], pose[1], pose[2]] as number[],
				target: [pose[3], pose[4], pose[5]] as number[],
			};
		};

		it('stays inside the Manual camera’s bounds, so a takeover never moves the camera', () => {
			for (let step = 0; step <= SAMPLES; step++) {
				const { position, target } = at(step);
				const where = position.map((v) => v.toFixed(2)).join(', ');
				const [ox, oy, oz] = position.map((v, k) => v - (target[k] as number)) as number[];
				const distance = Math.hypot(ox as number, oy as number, oz as number);
				expect(distance, `the route stands ${distance.toFixed(1)} m back at ${where}`).toBeLessThan(
					bounds.distance,
				);
				const polar = Math.acos((oy as number) / distance);
				expect(polar, `the route looks up too steeply at ${where}`).toBeLessThan(
					BOUNDED_POLAR_ANGLE,
				);
				expect(
					keepInside(bounds, [...target], [...position]),
					`the bounds move the camera at ${where}`,
				).toBe(false);
			}
		});

		it('keeps the scene’s core inside the shadow range from every pose', () => {
			const { center, radius, distance } = sketch.SHADOW_REACH;
			let held = distance;
			for (let step = 0; step <= SAMPLES; step++) {
				const { position, target } = at(step);
				const look = target.map((v, k) => v - (position[k] as number));
				const length = Math.hypot(...look);
				const need =
					look.reduce(
						(sum, v, k) => sum + (v / length) * ((center[k] as number) - (position[k] as number)),
						0,
					) + radius;
				held = shadowStep(need, held, distance);
				expect(held).toBeGreaterThanOrEqual(need);
			}
		});
	});
}
