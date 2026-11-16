// The road's mirror turns the camera about the road's plane, and draws its image upside down, which
// the ground's texture coordinates undo. These checks hold the turn to that: the mirror looks where
// the camera's view reflects to, keeps the camera's right on the right, and turns the camera's up
// over, so an image that the ground reads with its height turned about the middle lands upright.
import { expect, test } from 'bun:test';
import { type QuatLike, quat, type Vec3Like, vec3 } from '@null3d/engine';
import { mirrorTurn } from './reflection';

/** Turns to try: level, pitched, and rolled, as the flight and a drag on the seat's view give them. */
const TURNS = [
	[0, 0, 0],
	[0, 1.2, 0],
	[0.4, 0.7, 0],
	[0.2, -2.1, 0.6],
	[-0.9, 3.4, -1.1],
] as const;

/** The camera's own forward, right and up, as directions. */
const FORWARD = { x: 0, y: 0, z: -1 } as const;
const RIGHT = { x: 1, y: 0, z: 0 } as const;
const UP = { x: 0, y: 1, z: 0 } as const;

/** Writes the direction that a turn gives one of the camera's own axes into `out`. */
function along(out: Vec3Like, turn: QuatLike, axis: { x: number; y: number; z: number }): void {
	vec3.transformQuat(out, vec3.set(scratch, axis.x, axis.y, axis.z), turn);
}
const scratch = vec3.create();

/** True when two directions agree to within a millionth on each axis. */
function same(a: Vec3Like, b: readonly [number, number, number]): boolean {
	return [0, 1, 2].every((k) => Math.abs((a[k] as number) - b[k]) < 1e-6);
}

test("a mirrored turn reflects the camera's view and right, and turns its up over", () => {
	const turn = quat.create();
	const mirrored = quat.create();
	const [forward, right, up] = [vec3.create(), vec3.create(), vec3.create()];
	const [mirrorForward, mirrorRight, mirrorUp] = [vec3.create(), vec3.create(), vec3.create()];
	for (const [pitch, yaw, roll] of TURNS) {
		quat.fromEuler(turn, pitch, yaw, roll, 'YXZ');
		mirrorTurn(mirrored, turn);
		along(forward, turn, FORWARD);
		along(right, turn, RIGHT);
		along(up, turn, UP);
		along(mirrorForward, mirrored, FORWARD);
		along(mirrorRight, mirrored, RIGHT);
		along(mirrorUp, mirrored, UP);
		// The mirror looks down the reflected view, so the road shows what stands over it.
		expect(
			same(mirrorForward, [forward[0] as number, -(forward[1] as number), forward[2] as number]),
		).toBe(true);
		// Its right stays the reflected right, so the image reads the same way round.
		expect(same(mirrorRight, [right[0] as number, -(right[1] as number), right[2] as number])).toBe(
			true,
		);
		// Its up is the reflected up turned over, so the image stands upside down until the ground
		// turns its texture coordinates about both axes.
		expect(same(mirrorUp, [-(up[0] as number), up[1] as number, -(up[2] as number)])).toBe(true);
	}
});

test('a turn mirrored twice gives the turn again', () => {
	const turn = quat.create();
	const once = quat.create();
	const twice = quat.create();
	for (const [pitch, yaw, roll] of TURNS) {
		quat.fromEuler(turn, pitch, yaw, roll, 'YXZ');
		mirrorTurn(once, turn);
		mirrorTurn(twice, once);
		for (let k = 0; k < 4; k++) expect(twice[k] as number).toBeCloseTo(turn[k] as number, 6);
	}
});
