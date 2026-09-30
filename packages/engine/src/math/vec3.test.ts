import { describe, expect, it } from 'bun:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import * as vec3 from './vec3';

type Tuple = [number, number, number];
const A: Tuple = [1.5, -2.25, 3.125];
const B: Tuple = [-0.5, 4, 2.75];
const v = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]);
const xyz = (a: Vector3): Tuple => [a.x, a.y, a.z];

describe('vec3', () => {
	it('creates, sets and copies vectors, and returns the array it writes', () => {
		expect(vec3.create()).toEqual([0, 0, 0]);
		const out = vec3.create();
		expect(vec3.set(out, 1, 2, 3)).toBe(out);
		expect(out).toEqual([1, 2, 3]);
		const typed = new Float64Array(3);
		expect(vec3.copy(typed, A)).toBe(typed);
		expect([...typed]).toEqual([...A]);
	});

	it('gives reference values', () => {
		const out = vec3.create();
		expect(vec3.cross(out, [1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
		expect(vec3.dot([1, 2, 3], [4, -5, 6])).toBe(12);
		expect(vec3.length([3, 4, 12])).toBe(13);
		expect(vec3.distance([1, 1, 1], [4, 5, 1])).toBe(5);
		expect(vec3.normalize(out, [0, 0, 0])).toEqual([0, 0, 0]);
		expect(vec3.normalize(out, [0, -8, 0])).toEqual([0, -1, 0]);
		expect(vec3.angle([1, 0, 0], [0, 0, -2])).toBe(Math.PI / 2);
		expect(vec3.angle([1, 0, 0], [0, 0, 0])).toBe(Math.PI / 2);
		expect(vec3.angle([1, 1, 0], [-2, -2, 0])).toBe(Math.PI);
		expect(vec3.lerp(out, [0, 10, -4], [10, 20, 4], 0.25)).toEqual([2.5, 12.5, -2]);
		// A quarter turn about +Y takes +X to -Z.
		const turn = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
		vec3.transformQuat(out, [1, 0, 0], turn);
		for (const [i, value] of [0, 0, -1].entries()) expect(out[i]).toBeCloseTo(value, 15);
		const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
		expect(vec3.transformMat4(out, [1, 2, 3], translation)).toEqual([11, 22, 33]);
	});

	it('matches three.js for the calls they share', () => {
		const out = vec3.create();
		expect(vec3.add(out, A, B)).toEqual(xyz(v(A).add(v(B))));
		expect(vec3.sub(out, A, B)).toEqual(xyz(v(A).sub(v(B))));
		expect(vec3.multiply(out, A, B)).toEqual(xyz(v(A).multiply(v(B))));
		expect(vec3.scale(out, A, 1.75)).toEqual(xyz(v(A).multiplyScalar(1.75)));
		expect(vec3.scaleAndAdd(out, A, B, 0.3)).toEqual(xyz(v(A).addScaledVector(v(B), 0.3)));
		expect(vec3.negate(out, A)).toEqual(xyz(v(A).negate()));
		expect(vec3.cross(out, A, B)).toEqual(xyz(v(A).cross(v(B))));
		expect(vec3.normalize(out, A)).toEqual(xyz(v(A).normalize()));
		expect(vec3.lerp(out, A, B, 0.3)).toEqual(xyz(v(A).lerp(v(B), 0.3)));
		expect(vec3.min(out, A, B)).toEqual(xyz(v(A).min(v(B))));
		expect(vec3.max(out, A, B)).toEqual(xyz(v(A).max(v(B))));
		expect(vec3.dot(A, B)).toBe(v(A).dot(v(B)));
		expect(vec3.length(A)).toBe(v(A).length());
		expect(vec3.squaredLength(A)).toBe(v(A).lengthSq());
		expect(vec3.distance(A, B)).toBe(v(A).distanceTo(v(B)));
		expect(vec3.squaredDistance(A, B)).toBe(v(A).distanceToSquared(v(B)));
		expect(vec3.angle(A, B)).toBe(v(A).angleTo(v(B)));
		const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 2).normalize(), 0.7);
		expect(vec3.transformQuat(out, A, [q.x, q.y, q.z, q.w])).toEqual(xyz(v(A).applyQuaternion(q)));
		// A projection and a turn, so the perspective divide matters.
		const m = new Matrix4()
			.makePerspective(-1, 1, 1, -1, 0.5, 50)
			.multiply(new Matrix4().makeRotationY(0.4));
		expect(vec3.transformMat4(out, A, m.elements)).toEqual(xyz(v(A).applyMatrix4(m)));
	});

	it('writes into typed arrays and into an input it also reads', () => {
		const expected = xyz(v(A).cross(v(B)));
		const a = Float32Array.from(A);
		vec3.cross(a, a, B);
		expect([...a]).toEqual(expected.map(Math.fround));
		const b = [...B];
		vec3.cross(b, A, b);
		expect(b).toEqual(expected);
		const point = [...A];
		const m = new Matrix4().makeRotationZ(1.1).setPosition(1, 2, 3);
		expect(vec3.transformMat4(point, point, m.elements)).toEqual(xyz(v(A).applyMatrix4(m)));
		const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.8);
		const turned = [...A];
		expect(vec3.transformQuat(turned, turned, [q.x, q.y, q.z, q.w])).toEqual(
			xyz(v(A).applyQuaternion(q)),
		);
	});
});
