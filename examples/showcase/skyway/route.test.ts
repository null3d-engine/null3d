// The skyway's route must stay inside the streets of the city plan ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole loop through the player's own interpolation, and fails when a sample
// enters a building or drops below the lanes, so a route edit cannot reintroduce a clip.
import { expect, test } from 'bun:test';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { cityBuildings } from './layout';
import { SHOTS } from './sketch';

/** How many points of the loop the check samples: a spline bulges between the shots. */
const SAMPLES = 2000;
/** How far a route must keep from a surface, in meters. */
const CLEARANCE = 1;
/** The lowest that the camera may fly, in meters. */
const FLOOR = 8;

test('the skyway route keeps to the streets and above the lanes', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const buildings = cityBuildings();
	/** The first sample that breaks a rule, as a sentence that names where it stands. */
	let broken = '';
	samples: for (let step = 0; step <= SAMPLES; step++) {
		// The sample through the player's own interpolation: what it plays is what is checked.
		routePosition(route, (step / SAMPLES) * route.total, pose);
		const [x, y, z] = [pose[0] as number, pose[1] as number, pose[2] as number];
		if (y <= FLOOR) {
			broken = `the camera drops to ${y.toFixed(2)} m at ${x.toFixed(1)}, ${z.toFixed(1)}`;
			break;
		}
		for (const building of buildings) {
			if (
				Math.abs(x - building.x) < building.width / 2 + CLEARANCE &&
				Math.abs(z - building.z) < building.depth / 2 + CLEARANCE &&
				y < building.height + CLEARANCE
			) {
				broken = `the route passes through a ${building.height.toFixed(0)} m building at ${building.x.toFixed(1)}, ${building.z.toFixed(1)}: the sample stands at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
				break samples;
			}
		}
	}
	expect(broken).toBe('');
});
