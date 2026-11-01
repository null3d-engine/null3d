// Each showcase scene's Auto route against its Manual camera's bounds and its shadow range
// ([D-170](../../.dev/decisions/D-170-showcase-camera.md), owner's ruling). Every pose of
// the route lies inside the bounds, so taking the camera over at any moment never moves it, and the
// sun's shadow range reaches past the scene's core from every pose, so the core's shadows never
// vanish as the route draws back.
import { describe, expect, it } from 'bun:test';
import * as creekLand from '../showcase/creek/land';
import * as creek from '../showcase/creek/sketch';
import * as islandPlan from '../showcase/island/plan';
import * as island from '../showcase/island/sketch';
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

/** The most acceleration of a route, in meters per second squared. A step at a join reads in the hundreds. */
const MOST_ACCELERATION = 20;
/** The most that the camera's speed changes between two frames at 60 frames a second, in meters a second. */
const MOST_SPEED_STEP = MOST_ACCELERATION / 60;
/** The most that the turning rate changes in a second, in degrees per second. */
const MOST_TURN_CHANGE = 60;

/** Each scene's route, its camera's bounds and the ground under them: an island has no mountains. */
const creekRing = mountainRing(creekLand.mountainSettings(160, 32));
const SCENES = [
	{
		name: 'island',
		sketch: island,
		ground: (x: number, z: number) => Math.max(islandPlan.groundHeight(x, z), 0),
	},
	{
		name: 'creek',
		sketch: creek,
		ground: (x: number, z: number) =>
			Math.max(creekLand.groundHeight(x, z), creekRing.heightAt(x, z)),
	},
];

for (const { name, ground, sketch } of SCENES) {
	describe(`the ${name}'s route`, () => {
		const bounds: CameraBounds = {
			...sketch.BOUNDS,
			ground,
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

		it('changes its speed and its turning smoothly, with no step at a join between shots', () => {
			const dt = 1 / 60;
			const frames = Math.round(route.total / dt);
			const speeds: number[] = [];
			const turns: number[] = [];
			const aim = (p: Float32Array) => {
				const d = [p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!];
				const size = Math.hypot(d[0]!, d[1]!, d[2]!);
				return d.map((v) => v / size);
			};
			routePosition(route, 0, pose);
			let [place, facing] = [[pose[0]!, pose[1]!, pose[2]!], aim(pose)];
			for (let k = 1; k <= frames; k++) {
				routePosition(route, k * dt, pose);
				const here = [pose[0]!, pose[1]!, pose[2]!];
				const looks = aim(pose);
				speeds.push(
					Math.hypot(here[0]! - place[0]!, here[1]! - place[1]!, here[2]! - place[2]!) / dt,
				);
				const cosine = looks[0]! * facing[0]! + looks[1]! * facing[1]! + looks[2]! * facing[2]!;
				turns.push((Math.acos(Math.min(1, cosine)) * (180 / Math.PI)) / dt);
				[place, facing] = [here, looks];
			}
			for (let k = 1; k < speeds.length; k++) {
				const at = `at ${(k * dt).toFixed(2)} s`;
				expect(Math.abs(speeds[k]! - speeds[k - 1]!), `the speed steps ${at}`).toBeLessThan(
					MOST_SPEED_STEP,
				);
				expect(Math.abs(turns[k]! - turns[k - 1]!) / dt, `the turning steps ${at}`).toBeLessThan(
					MOST_TURN_CHANGE,
				);
			}
		});

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
