import { describe, expect, it } from 'bun:test';
import { transformQuat } from '../math/vec3';
import { quaternionLookAt } from './rotation';

const H = Math.SQRT1_2;
function close(actual: ArrayLike<number>, expected: number[]): void {
	for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, 6);
}

describe('quaternionLookAt', () => {
	it('points a camera-style -Z axis at the target', () => {
		const q = [0, 0, 0, 0];
		quaternionLookAt(q, [0, 0, 10], [0, 0, 0], true);
		close(q, [0, 0, 0, 1]);
		quaternionLookAt(q, [10, 0, 0], [0, 0, 0], true);
		close(q, [0, H, 0, H]);
		quaternionLookAt(q, [140, 40, 0], [0, 0, 0], true);
		const length = Math.hypot(140, 40);
		close(transformQuat([0, 0, 0], [0, 0, -1], q), [-140 / length, -40 / length, 0]);
	});

	it("points other objects' +Z axis at the target", () => {
		const q = [0, 0, 0, 0];
		quaternionLookAt(q, [0, 0, 0], [5, 0, 0], false);
		close(transformQuat([0, 0, 0], [0, 0, 1], q), [1, 0, 0]);
	});
});
