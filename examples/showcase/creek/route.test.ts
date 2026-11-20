// Creek's route must stay clear of the cliff's ground and walls, above the cloud's tops past the
// rim, and dip under the water only along the creek ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route through the player's own interpolation, and fails when a sample
// comes too near the ground, the rock or the cloud, or when the dip reaches the bed or a stone. A
// route edit therefore cannot reintroduce a clip.
import { expect, test } from 'bun:test';
import { waveHeight } from '@null3d/water';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import {
	bearingOf,
	CLOUD_TOP,
	cameraFloor,
	groundHeight,
	rimRadius,
	streamCurrent,
	streamZ,
	WATER,
} from './land';
import { SHOTS } from './route';
import { ROCK_REACH, rockPlaces } from './stones';

/** The height of the creek's surface at a point and time, as the water's shape gives its current. */
const surfaceHeight = (x: number, z: number, t: number) =>
	waveHeight(x, z, t, WATER, streamCurrent(x, z), 1);

/** How many points of the loop the check samples. A spline bends between the shots, so the
 * checks sample finely enough to catch a bulge that a shot's own pose does not show. */
const SAMPLES = 2000;
/** How far above the ground the route keeps out of the water, in meters. */
const GROUND_CLEARANCE = 0.8;
/** How far past the rim the walls' rock can reach, in meters, which the route keeps beyond. */
const WALL_REACH = 3;
/** How far above the cloud's tops the route keeps past the rim, in meters. */
const CLOUD_CLEARANCE = 4;

test('the creek route keeps clear of the ground and the walls, and above the cloud past the rim', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	for (let step = 0; step <= SAMPLES; step++) {
		const t = (step / SAMPLES) * route.total;
		// The sample through the player's own interpolation: what it plays is what is checked.
		routePosition(route, t, pose);
		const [x, y, z] = [pose[0] as number, pose[1] as number, pose[2] as number];
		const where = `${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
		const reach = Math.hypot(x, z) - rimRadius(bearingOf(x, z));
		if (reach > WALL_REACH) {
			expect(y, `the route sinks toward the cloud at ${where}`).toBeGreaterThan(
				CLOUD_TOP + CLOUD_CLEARANCE,
			);
			continue;
		}
		// Within the walls' reach the route stays over the ground, so it never passes beside the
		// rock below the rim. Over the creek it may run low, and the dip under the water has its own
		// test below.
		const ground = groundHeight(x, z);
		if (ground < WATER) continue;
		expect(y, `the route nears the ground or the wall at ${where}`).toBeGreaterThan(
			ground + GROUND_CLEARANCE,
		);
	}
});

/** How far above the stream's bed the dip keeps, in meters. */
const BED_CLEARANCE = 0.12;
/** How far past a stone's edge the dip keeps, in meters. */
const STONE_CLEARANCE = 0.25;

test('the creek route dips under the water for five to seven seconds, clear of the bed and the stones', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const step = route.total / SAMPLES;
	let under = 0;
	for (let k = 0; k <= SAMPLES; k++) {
		const t = k * step;
		routePosition(route, t, pose);
		const [x, y, z] = [pose[0] as number, pose[1] as number, pose[2] as number];
		if (y >= surfaceHeight(x, z, t)) continue;
		under += step;
		const where = `${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
		expect(y, `the dip runs into the bed at ${where}`).toBeGreaterThan(
			groundHeight(x, z) + BED_CLEARANCE,
		);
		for (const rock of rockPlaces()) {
			const top = groundHeight(rock.x, rock.z) + rock.size;
			const reach = Math.hypot(x - rock.x, z - rock.z);
			expect(
				reach > ROCK_REACH * rock.size + STONE_CLEARANCE || y > top + STONE_CLEARANCE,
				`the dip runs into the stone at ${rock.x.toFixed(1)}, ${rock.z.toFixed(1)} at ${where}`,
			).toBe(true);
		}
	}
	expect(under).toBeGreaterThanOrEqual(5);
	expect(under).toBeLessThanOrEqual(7);
	// The water level the dip measures against is the stream's own.
	expect(WATER).toBe(0);
});

test("past the rim the Manual camera keeps above the water's level, and over the creek it may dip", () => {
	// The water's view from under its surface turns on from the camera's height alone, so the floor
	// past the rim, with the camera's clearance, keeps the camera clear of the water's level there.
	for (let degrees = 0; degrees < 360; degrees += 3) {
		const bearing = (degrees * Math.PI) / 180;
		for (const out of [0.05, 1, 3, 8, 20, 45]) {
			const r = rimRadius(bearing) + out;
			const [x, z] = [Math.cos(bearing) * r, Math.sin(bearing) * r];
			expect(cameraFloor(x, z), `the floor at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeGreaterThan(
				WATER + 0.3,
			);
		}
	}
	// Over the creek's middle the floor is its bed, under the water, so the dip stays possible.
	for (const x of [-15, -2, 6, 12])
		expect(cameraFloor(x, streamZ(x))).toBeLessThan(WATER - BED_CLEARANCE - 0.2);
});
