import { describe, expect, it } from 'bun:test';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import * as mat4 from './mat4';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const xyz = (v: Vector3) => [v.x, v.y, v.z];
const xyzw = (q: Quaternion) => [q.x, q.y, q.z, q.w];

/** A matrix that moves, turns and scales unevenly, and one with a perspective row. */
const TRS = new Matrix4().compose(
	new Vector3(4, -2, 7.5),
	new Quaternion().setFromEuler(new Euler(0.4, -1.2, 2.1)),
	new Vector3(1.5, 0.25, 3),
);
const PROJECTION = new Matrix4().makePerspective(-0.8, 1.2, 0.9, -1.1, 0.25, 90);

describe('mat4', () => {
	it('creates, copies and resets matrices, and returns the array it writes', () => {
		expect(mat4.create()).toEqual(IDENTITY);
		const out = mat4.create();
		expect(mat4.copy(out, TRS.elements)).toBe(out);
		expect(out).toEqual(TRS.elements);
		const typed = new Float64Array(16).fill(9);
		expect(mat4.identity(typed)).toBe(typed);
		expect([...typed]).toEqual(IDENTITY);
	});

	it('matches three.js for products and inverses', () => {
		const out = mat4.create();
		expect(mat4.multiply(out, PROJECTION.elements, TRS.elements)).toEqual(
			new Matrix4().multiplyMatrices(PROJECTION, TRS).elements,
		);
		for (const m of [TRS, PROJECTION])
			expect(mat4.invert(out, m.elements)).toEqual(m.clone().invert().elements);
		// A matrix that flattens space has no inverse.
		const flat = new Matrix4().makeScale(1, 0, 1);
		expect(mat4.invert(out, flat.elements)).toEqual(new Array(16).fill(0));
	});

	it('matches three.js when it joins and splits a position, a rotation and a scale', () => {
		const out = mat4.create();
		const position = new Vector3(-3, 0.5, 12);
		const rotation = new Quaternion().setFromEuler(new Euler(-0.3, 2.5, 0.9));
		const scale = new Vector3(2, 0.5, 1.25);
		expect(mat4.compose(out, xyz(position), xyzw(rotation), xyz(scale))).toEqual(
			new Matrix4().compose(position, rotation, scale).elements,
		);
		// A mirror gives a negative X scale; a flat matrix gives no rotation and a scale of 1.
		const mirrored = TRS.clone().multiply(new Matrix4().makeScale(1, -1, 1));
		const flat = new Matrix4().makeScale(2, 0, 2).setPosition(1, 2, 3);
		for (const m of [TRS, mirrored, flat]) {
			const [p, r, s] = [
				[0, 0, 0],
				[0, 0, 0, 1],
				[0, 0, 0],
			];
			mat4.decompose(p, r, s, m.elements);
			const expected = [new Vector3(), new Quaternion(), new Vector3()] as const;
			m.decompose(...expected);
			expect([p, r, s]).toEqual([xyz(expected[0]), xyzw(expected[1]), xyz(expected[2])]);
		}
	});

	it('composes the matrix that transforms a point by scale, then rotation, then position', () => {
		const m = mat4.compose(
			mat4.create(),
			[10, 0, 0],
			[0, Math.SQRT1_2, 0, Math.SQRT1_2],
			[2, 2, 2],
		);
		// Scaled to (2, 0, 0), turned a quarter about +Y to (0, 0, -2), then moved.
		const point = new Vector3(1, 0, 0).applyMatrix4(new Matrix4().fromArray(m));
		for (const [i, value] of [10, 0, -2].entries()) expect(xyz(point)[i]).toBeCloseTo(value, 14);
	});

	it('writes into an input it also reads', () => {
		const expected = new Matrix4().multiplyMatrices(PROJECTION, TRS).elements;
		const a = [...PROJECTION.elements];
		expect(mat4.multiply(a, a, TRS.elements)).toEqual(expected);
		const b = [...TRS.elements];
		expect(mat4.multiply(b, PROJECTION.elements, b)).toEqual(expected);
		const inverse = [...TRS.elements];
		expect(mat4.invert(inverse, inverse)).toEqual(TRS.clone().invert().elements);
	});
});
