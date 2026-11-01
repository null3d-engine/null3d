// The Water demo's tour is one loop with no cut. The test samples it through the player's own
// interpolation and fails when the camera comes near the ground or a boulder, when it skips the
// dip under the lake, or when it turns faster than a slow tour should, so a shot edit cannot bring
// back a clip or a jump.
import { expect, test } from 'bun:test';
import { routePosition, routeTimeline } from '../lib/cinematic';
import { ground, LAKE, SHOTS, STONES } from './valley';

/** The seconds between two samples of the loop. */
const STEP = 0.02;
/** How far the camera keeps from the ground, in meters. */
const CLEARANCE = 0.5;
/** How far it keeps from a boulder, in meters: closer, the foam map's texels show as blocks. */
const STONE_CLEARANCE = 3;

test('the water tour stays clear of the ground and the boulders, dips under the lake, and turns slowly', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	let under = 0;
	let turn = 0;
	let fastest = 0;
	let last = Number.NaN;
	for (let t = 0; t < route.total; t += STEP) {
		routePosition(route, t, pose);
		const [x, y, z, tx, , tz] = pose as unknown as [number, number, number, number, number, number];
		expect(y - ground(x, z)).toBeGreaterThan(CLEARANCE);
		for (const stone of STONES) {
			const gap = Math.hypot(x - stone.x, y + stone.r * 0.35, z - stone.z) - stone.r * 1.5;
			expect(gap).toBeGreaterThan(STONE_CLEARANCE);
		}
		if (y < -0.3) {
			under += STEP;
			// The camera swims only in the lake.
			expect(Math.hypot((x - LAKE.x) / LAKE.rx, z / LAKE.rz)).toBeLessThan(1);
		}
		const yaw = Math.atan2(tz - z, tx - x);
		if (!Number.isNaN(last)) {
			const step = Math.atan2(Math.sin(yaw - last), Math.cos(yaw - last));
			turn += step;
			fastest = Math.max(fastest, Math.abs(step) / STEP);
		}
		last = yaw;
	}
	expect(under).toBeGreaterThan(15);
	// One full turn round the valley in each loop, never faster than 30 degrees a second.
	expect(Math.abs(turn)).toBeCloseTo(2 * Math.PI, 1);
	expect(fastest).toBeLessThan((30 * Math.PI) / 180);
});
