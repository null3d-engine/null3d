import { describe, expect, it } from 'bun:test';
import { Euler, Matrix4, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import * as quat from './quat';
import type { EulerOrder } from './types';

const ORDERS: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];
const H = Math.SQRT1_2;
const xyzw = (q: Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];
const q3 = (q: readonly number[]) => new Quaternion(q[0], q[1], q[2], q[3]);
const A = xyzw(new Quaternion(0.3, -0.5, 0.2, 0.8).normalize());
const B = xyzw(new Quaternion(-0.6, 0.1, 0.7, 0.35).normalize());

function expectClose(actual: ArrayLike<number>, expected: readonly number[]): void {
	for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, 14);
}

describe('quat', () => {
	it('creates, sets and copies quaternions, and returns the array it writes', () => {
		expect(quat.create()).toEqual([0, 0, 0, 1]);
		const out = quat.create();
		expect(quat.set(out, 1, 2, 3, 4)).toBe(out);
		expect(quat.identity(out)).toEqual([0, 0, 0, 1]);
		const typed = new Float32Array(4);
		expect(quat.copy(typed, [0.5, 0.5, 0.5, 0.5])).toBe(typed);
		expect([...typed]).toEqual([0.5, 0.5, 0.5, 0.5]);
	});

	it('turns about an axis, and about one Euler axis in every order alike', () => {
		const out = quat.create();
		expectClose(quat.setAxisAngle(out, [0, 1, 0], Math.PI / 2), [0, H, 0, H]);
		for (const order of ORDERS)
			expectClose(quat.fromEuler(out, 0, Math.PI / 2, 0, order), [0, H, 0, H]);
		// The default order is XYZ.
		expect(quat.fromEuler(out, 0.3, -0.7, 1.1)).toEqual(
			quat.fromEuler(quat.create(), 0.3, -0.7, 1.1, 'XYZ'),
		);
	});

	it('matches three.js for Euler angles in every order, and for an axis and an angle', () => {
		const out = quat.create();
		for (const order of ORDERS)
			expect(quat.fromEuler(out, 0.3, -0.7, 1.1, order)).toEqual(
				xyzw(new Quaternion().setFromEuler(new Euler(0.3, -0.7, 1.1, order))),
			);
		const axis = new Vector3(1, -2, 2).normalize();
		expect(quat.setAxisAngle(out, [axis.x, axis.y, axis.z], 2.2)).toEqual(
			xyzw(new Quaternion().setFromAxisAngle(axis, 2.2)),
		);
	});

	it('matches three.js for the rotation of a matrix, on every branch of the formula', () => {
		const out = quat.create();
		// Each rotation makes a different element of the diagonal, or the trace, the largest.
		const rotations = [
			new Euler(0.2, 0.3, 0.1),
			new Euler(3, 0.1, 0.2),
			new Euler(0.1, 3, 0.2),
			new Euler(0.2, 0.1, 3),
		];
		for (const rotation of rotations) {
			const m = new Matrix4().makeRotationFromEuler(rotation);
			expect(quat.fromMat4(out, m.elements)).toEqual(
				xyzw(new Quaternion().setFromRotationMatrix(m)),
			);
		}
	});

	it("matches three.js's lookAt, for meshes and, with eye and target swapped, for cameras", () => {
		const out = quat.create();
		const cases: [eye: number[], target: number[], up?: number[]][] = [
			[
				[0, 0, 0],
				[5, 0, 0],
			],
			[
				[1, 2, 3],
				[-4, 0.5, 2],
			],
			[
				[140, 40, 0],
				[0, 0, 0],
			],
			// The view runs along the up axis, and the eye is on the target.
			[
				[0, 0, 0],
				[0, 7, 0],
			],
			[
				[0, 5, 0],
				[0, -5, 0],
			],
			[
				[2, 2, 2],
				[2, 2, 2],
			],
			[
				[0, 0, 0],
				[3, 1, 4],
				[0, 0, 1],
			],
			[
				[0, 0, 0],
				[0, 0, 9],
				[0, 0, 1],
			],
		];
		for (const [eye, target, up] of cases) {
			const mesh = new Object3D();
			const camera = new PerspectiveCamera();
			for (const object of [mesh, camera]) {
				if (up) object.up.set(up[0] as number, up[1] as number, up[2] as number);
				object.position.set(eye[0] as number, eye[1] as number, eye[2] as number);
				object.lookAt(target[0] as number, target[1] as number, target[2] as number);
			}
			expect(quat.lookAt(out, eye, target, up)).toEqual(xyzw(mesh.quaternion));
			expect(quat.lookAt(out, target, eye, up)).toEqual(xyzw(camera.quaternion));
		}
	});

	it('matches three.js for the rotation between two directions, opposite ones included', () => {
		const out = quat.create();
		const directions = [
			[new Vector3(1, 2, 3).normalize(), new Vector3(-2, 0.5, 1).normalize()],
			[new Vector3(1, 0.5, 0.25).normalize(), new Vector3(-1, -0.5, -0.25).normalize()],
			[new Vector3(0.25, 0.5, 1).normalize(), new Vector3(-0.25, -0.5, -1).normalize()],
		];
		for (const [from, to] of directions as [Vector3, Vector3][])
			expect(quat.rotationTo(out, [from.x, from.y, from.z], [to.x, to.y, to.z])).toEqual(
				xyzw(new Quaternion().setFromUnitVectors(from, to)),
			);
	});

	it('matches three.js for products, turns, inverses, lengths and dot products', () => {
		const out = quat.create();
		expect(quat.multiply(out, A, B)).toEqual(
			xyzw(new Quaternion().multiplyQuaternions(q3(A), q3(B))),
		);
		const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
		const turns = [quat.rotateX, quat.rotateY, quat.rotateZ];
		for (const [i, turn] of turns.entries())
			expectClose(
				turn(out, A, 0.9),
				xyzw(q3(A).multiply(new Quaternion().setFromAxisAngle(axes[i] as Vector3, 0.9))),
			);
		expect(quat.invert(out, A)).toEqual(xyzw(q3(A).invert()));
		expect(quat.normalize(out, [1, 2, 3, 4])).toEqual(xyzw(new Quaternion(1, 2, 3, 4).normalize()));
		expect(quat.normalize(out, [0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
		expect(quat.dot(A, B)).toBe(q3(A).dot(q3(B)));
	});

	it('matches three.js for slerp, along the shorter arc and between close rotations', () => {
		const out = quat.create();
		const close = xyzw(
			q3(A).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.01)),
		);
		const opposite = B.map((x) => -x);
		for (const b of [B, close, opposite])
			for (const t of [0, 0.25, 0.8, 1])
				expect(quat.slerp(out, A, b, t)).toEqual(
					xyzw(new Quaternion().slerpQuaternions(q3(A), q3(b), t)),
				);
	});

	it('rounds its result once when it writes into a Float32Array', () => {
		const typed = new Float32Array(4);
		const close = xyzw(
			q3(A).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.01)),
		);
		expect([...quat.slerp(typed, A, close, 0.3)]).toEqual(
			xyzw(new Quaternion().slerpQuaternions(q3(A), q3(close), 0.3)).map(Math.fround),
		);
		const from = new Vector3(1, 2, 3).normalize();
		const to = new Vector3(-2, 0.5, 1).normalize();
		expect([...quat.rotationTo(typed, [from.x, from.y, from.z], [to.x, to.y, to.z])]).toEqual(
			xyzw(new Quaternion().setFromUnitVectors(from, to)).map(Math.fround),
		);
	});

	it('writes into an input it also reads', () => {
		const expected = xyzw(new Quaternion().multiplyQuaternions(q3(A), q3(B)));
		const a = [...A];
		expect(quat.multiply(a, a, B)).toEqual(expected);
		const b = [...B];
		expect(quat.multiply(b, A, b)).toEqual(expected);
		const turned = [...A];
		expect(quat.slerp(turned, turned, B, 0.4)).toEqual(
			xyzw(new Quaternion().slerpQuaternions(q3(A), q3(B), 0.4)),
		);
	});
});
