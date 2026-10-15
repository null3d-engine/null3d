// The night town's route must stay clear of the town's geometry ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route through the player's own interpolation, and fails when a sample
// comes within the clearance of a house or the tower, so a route edit cannot reintroduce a clip.
import { expect, test } from 'bun:test';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { LOTS, TOWER } from './houses';
import { SHOTS } from './sketch';

/** How far a route must keep from a surface, in meters, as the clearance guard does. */
const CLEARANCE = 0.5;
/** The height of one floor, as `houses.ts` builds it. */
const FLOOR = 3.1;

interface Box {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	height: number;
}

/** The houses' boxes: each lot's walls, turned a quarter or not, under its roof's ridge. */
function houseBoxes(): Box[] {
	return LOTS.map(([x, z, yaw, width, depth, floors]) => {
		const quarter = Math.abs(Math.sin(yaw)) > 0.5;
		const halfX = (quarter ? depth : width) / 2;
		const halfZ = (quarter ? width : depth) / 2;
		return {
			minX: x - halfX,
			maxX: x + halfX,
			minZ: z - halfZ,
			maxZ: z + halfZ,
			height: floors * FLOOR + depth * 0.42 + 0.7,
		};
	});
}

test('the night town route stays clear of its houses and its tower', () => {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const tower: Box = {
		minX: TOWER.x - TOWER.width / 2,
		maxX: TOWER.x + TOWER.width / 2,
		minZ: TOWER.z - TOWER.width / 2,
		maxZ: TOWER.z + TOWER.width / 2,
		height: TOWER.height + TOWER.width * 1.6,
	};
	const boxes = [...houseBoxes(), tower];
	for (let step = 0; step <= 400; step++) {
		// The sample through the player's own interpolation: what it plays is what is checked.
		routePosition(route, (step / 400) * route.total, pose);
		const at = [pose[0] as number, pose[1] as number, pose[2] as number];
		for (const box of boxes) {
			const inside =
				at[0] > box.minX - CLEARANCE &&
				at[0] < box.maxX + CLEARANCE &&
				at[2] > box.minZ - CLEARANCE &&
				at[2] < box.maxZ + CLEARANCE &&
				at[1] < box.height + CLEARANCE;
			// The report names the sample, so a new clip is easy to place.
			expect(
				inside,
				`the route passes through the box x ${box.minX.toFixed(1)}..${box.maxX.toFixed(1)}, z ${box.minZ.toFixed(1)}..${box.maxZ.toFixed(1)} at ${at.map((v) => v.toFixed(2)).join(', ')}`,
			).toBe(false);
		}
	}
});
