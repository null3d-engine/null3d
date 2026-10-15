// Creek's route must stay clear of its trees and its cave ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route through the player's own interpolation, and fails when a sample
// comes within the clearance of a tree's trunk or the cave rock, so a route edit cannot reintroduce
// a clip.
import { expect, test } from 'bun:test';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { TREES } from './flora';
import { streamZ } from './land';
import { SHOTS } from './sketch';
import { CAVE } from './stones';

/** How far a route must keep from a surface, in meters, as the clearance guard does. */
const CLEARANCE = 0.5;

interface Cylinder {
	x: number;
	z: number;
	radius: number;
	height: number;
}

/** A tree's trunk and crown, as a rough cylinder: the model is about 11 m tall at size 1. */
function treeCylinders(): Cylinder[] {
	// A tree's second value is its bank offset, dz, so its world z is streamZ(x) + dz.
	return TREES.map(([x, dz, , size]) => ({
		x,
		z: streamZ(x) + dz,
		radius: 2.2 * size + CLEARANCE,
		height: 11 * size,
	}));
}

test('the creek route stays clear of its trees and its cave', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const cylinders: Cylinder[] = [
		...treeCylinders(),
		{ x: CAVE.x, z: CAVE.z, radius: CAVE.reach + CLEARANCE, height: 6 },
	];
	for (let step = 0; step <= 400; step++) {
		// The sample through the player's own interpolation: what it plays is what is checked.
		routePosition(route, (step / 400) * route.total, pose);
		const at = [pose[0] as number, pose[1] as number, pose[2] as number];
		for (const cylinder of cylinders) {
			const inside =
				Math.hypot(at[0] - cylinder.x, at[2] - cylinder.z) < cylinder.radius &&
				at[1] < cylinder.height + CLEARANCE;
			expect(
				inside,
				`the route passes into the cylinder at ${cylinder.x}, ${cylinder.z} (r ${cylinder.radius.toFixed(2)}) at ${at.map((v) => v.toFixed(2)).join(', ')}`,
			).toBe(false);
		}
	}
});
