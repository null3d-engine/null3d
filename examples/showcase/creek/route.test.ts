// Creek's route must stay clear of its trees and its cave ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route through the player's own interpolation, and fails when a sample
// comes within the clearance of a tree's trunk or the cave rock, so a route edit cannot reintroduce
// a clip.
import { expect, test } from 'bun:test';
import { waveHeight } from '@null3d/water';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { TREES } from './flora';
import { groundHeight, streamCurrent, streamZ, WATER } from './land';
import { SHOTS } from './sketch';
import { CAVE, rockPlaces } from './stones';

/** The height of the creek's surface at a point and time, as the water's shape gives its current. */
const surfaceHeight = (x: number, z: number, t: number) =>
	waveHeight(x, z, t, WATER, streamCurrent(x), 1);

/** How many points of the loop the check samples. A spline bends between the shots, so the
 * checks sample finely enough to catch a bulge that a shot's own pose does not show. */
const SAMPLES = 2000;
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
	for (let step = 0; step <= SAMPLES; step++) {
		// The sample through the player's own interpolation: what it plays is what is checked.
		routePosition(route, (step / SAMPLES) * route.total, pose);
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

/** How far above the stream's bed the dip keeps, in meters. */
const BED_CLEARANCE = 0.12;
/** How far past a stone's edge the dip keeps, in meters. A stone reaches about 1.6 times its size. */
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
				reach > 1.6 * rock.size + STONE_CLEARANCE || y > top + STONE_CLEARANCE,
				`the dip runs into the stone at ${rock.x.toFixed(1)}, ${rock.z.toFixed(1)} at ${where}`,
			).toBe(true);
		}
	}
	expect(under).toBeGreaterThanOrEqual(5);
	expect(under).toBeLessThanOrEqual(7);
	// The water level the dip measures against is the stream's own.
	expect(WATER).toBe(0);
});
