// Creek's route must stay clear of its trees and its cave ([D-170](../../../.dev/decisions/D-170-showcase-camera.md)).
// The test samples the whole route, as the player does each frame, and fails when a sample comes
// within the clearance of a tree's trunk or the cave rock, so a route edit cannot reintroduce a clip.
import { expect, test } from 'bun:test';
import type { Shot } from '../../lib/cinematic';
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

test('the creek route stays clear of its trees and its cave', () => {
	const starts: number[] = [];
	const seconds: number[] = [];
	let total = 0;
	for (const shot of SHOTS) {
		starts.push(total);
		seconds.push(shot.seconds);
		total += shot.seconds;
	}
	const cylinders: Cylinder[] = [
		...treeCylinders(),
		{ x: CAVE.x, z: CAVE.z, radius: CAVE.reach + CLEARANCE, height: 6 },
	];
	for (let step = 0; step <= 400; step++) {
		const at = place(SHOTS, starts, seconds, (step / 400) * total);
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
