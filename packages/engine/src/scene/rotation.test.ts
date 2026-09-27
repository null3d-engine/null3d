import { describe, expect, it } from 'bun:test';
import { type EulerOrder, quaternionFromEuler, quaternionLookAt } from './rotation';

const H = Math.SQRT1_2;
function close(actual: ArrayLike<number>, expected: number[]): void {
	for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, 6);
}

/** Rotates a vector by a quaternion. */
function rotate(q: number[], v: [number, number, number]): number[] {
	const [x, y, z, w] = q as [number, number, number, number];
	const [vx, vy, vz] = v;
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

describe('quaternionFromEuler', () => {
	it('turns about one axis in every order alike', () => {
		const out = [0, 0, 0, 0];
		for (const order of ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as EulerOrder[]) {
			quaternionFromEuler(out, 0, Math.PI / 2, 0, order);
			close(out, [0, H, 0, H]);
		}
	});

	it('matches three.js for mixed angles in every order', () => {
		// three.js 0.186.1: new Quaternion().setFromEuler(new Euler(0.3, -0.7, 1.1, order)).
		const expected: Record<EulerOrder, number[]> = {
			XYZ: [-0.05754, -0.36242, 0.4418, 0.818629],
			YXZ: [-0.05754, -0.36242, 0.52917, 0.765062],
			ZXY: [0.296892, -0.215672, 0.4418, 0.818629],
			ZYX: [0.296892, -0.215672, 0.52917, 0.765062],
			YZX: [-0.05754, -0.215672, 0.52917, 0.818629],
			XZY: [0.296892, -0.36242, 0.4418, 0.765062],
		};
		const out = [0, 0, 0, 0];
		for (const [order, values] of Object.entries(expected)) {
			quaternionFromEuler(out, 0.3, -0.7, 1.1, order as EulerOrder);
			for (const [i, value] of values.entries()) expect(out[i]).toBeCloseTo(value, 5);
		}
	});
});

describe('quaternionLookAt', () => {
	it('points a camera-style -Z axis at the target', () => {
		const q = [0, 0, 0, 0];
		quaternionLookAt(q, [0, 0, 10], [0, 0, 0], true);
		close(q, [0, 0, 0, 1]);
		quaternionLookAt(q, [10, 0, 0], [0, 0, 0], true);
		close(q, [0, H, 0, H]);
		quaternionLookAt(q, [140, 40, 0], [0, 0, 0], true);
		const forward = rotate(q, [0, 0, -1]);
		const length = Math.hypot(140, 40);
		close(forward, [-140 / length, -40 / length, 0]);
	});

	it('points other objects +Z axis at the target', () => {
		const q = [0, 0, 0, 0];
		quaternionLookAt(q, [0, 0, 0], [5, 0, 0], false);
		close(rotate(q, [0, 0, 1]), [1, 0, 0]);
	});
});
