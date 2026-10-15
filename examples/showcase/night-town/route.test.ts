// The night town's route must stay clear of the town's geometry ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route, as the player does each frame, and fails when a sample comes
// within the clearance of a house or the tower, so a route edit cannot reintroduce a clip.
import { expect, test } from 'bun:test';
import type { Shot } from '../../lib/cinematic';
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

/** The route's position at a phase, as `cinematic.ts` interpolates it. */
function place(
	shots: readonly Shot[],
	starts: readonly number[],
	seconds: readonly number[],
	phase: number,
): [number, number, number] {
	const total = starts[starts.length - 1]! + seconds[seconds.length - 1]!;
	const a = ((phase % total) + total) % total;
	let index = 0;
	for (let k = 0; k < shots.length; k++) if (a >= (starts[k] as number)) index = k;
	const shot = shots[index] as Shot;
	const next = shots[(index + 1) % shots.length] as Shot;
	const along = (a - (starts[index] as number)) / (seconds[index] as number);
	const f = shot.move === 'hold' ? 0 : along * along * (3 - 2 * along);
	return [
		(shot.position[0] as number) +
			((next.position[0] as number) - (shot.position[0] as number)) * f,
		(shot.position[1] as number) +
			((next.position[1] as number) - (shot.position[1] as number)) * f,
		(shot.position[2] as number) +
			((next.position[2] as number) - (shot.position[2] as number)) * f,
	];
}

test('the night town route stays clear of its houses and its tower', () => {
	const starts: number[] = [];
	const seconds: number[] = [];
	let total = 0;
	for (const shot of SHOTS) {
		starts.push(total);
		seconds.push(shot.seconds);
		total += shot.seconds;
	}
	const tower: Box = {
		minX: TOWER.x - TOWER.width / 2,
		maxX: TOWER.x + TOWER.width / 2,
		minZ: TOWER.z - TOWER.width / 2,
		maxZ: TOWER.z + TOWER.width / 2,
		height: TOWER.height + TOWER.width * 1.6,
	};
	const boxes = [...houseBoxes(), tower];
	for (let step = 0; step <= 400; step++) {
		const at = place(SHOTS, starts, seconds, (step / 400) * total);
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
