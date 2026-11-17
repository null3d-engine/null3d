import { describe, expect, it } from 'bun:test';
import { createMath, type MathFunctions } from './create-math';
import * as mat4Exact from './mat4';
import * as numbersExact from './math';
import * as math from './namespaces/math';
import * as quat from './namespaces/quat';
import * as vec3 from './namespaces/vec3';
import * as quatExact from './quat';
import type { EulerOrder } from './types';
import * as vec3Exact from './vec3';

const ORDERS: EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

/** The browser's own functions, which createMath must turn into the main entry's helpers. */
const BROWSER: MathFunctions = { sin: Math.sin, cos: Math.cos, acos: Math.acos, exp: Math.exp };

/** Numbers from -4 to 4 from a fixed seed, so a failure names the same inputs on every run. */
function numbers(count: number): number[] {
	let s = 7;
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		out.push((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 8 - 4);
	}
	return out;
}

/** `count` unit quaternions from a fixed seed. */
function rotations(count: number): number[][] {
	const n = numbers(count * 4);
	return Array.from({ length: count }, (_, i) =>
		quat.normalize([0, 0, 0, 1], n.slice(i * 4, i * 4 + 4)),
	);
}

/** The exact bits of each number, so two results compare bit for bit, -0 and NaN included. */
const bits = (values: ArrayLike<number>) =>
	Array.from(values, (v) => {
		const view = new DataView(new ArrayBuffer(8));
		view.setFloat64(0, v);
		return view.getBigUint64(0).toString(16);
	});

describe('createMath', () => {
	it("gives the main entry's results bit for bit when it gets the browser's functions", () => {
		const built = createMath(BROWSER);
		const n = numbers(400);
		const qs = rotations(100);
		for (let i = 0; i < 100; i++) {
			const [x, y, z, rad] = n.slice(i * 4, i * 4 + 4) as [number, number, number, number];
			const axis = vec3.normalize(vec3.create(), [x, y, z]);
			const a = qs[i] as number[];
			const b = qs[(i * 7 + 3) % 100] as number[];
			expect(bits(built.quat.setAxisAngle([0, 0, 0, 0], axis, rad))).toEqual(
				bits(quat.setAxisAngle([0, 0, 0, 0], axis, rad)),
			);
			for (const order of ORDERS)
				expect(bits(built.quat.fromEuler([0, 0, 0, 0], x, y, z, order))).toEqual(
					bits(quat.fromEuler([0, 0, 0, 0], x, y, z, order)),
				);
			expect(bits(built.quat.fromEuler([0, 0, 0, 0], x, y, z))).toEqual(
				bits(quat.fromEuler([0, 0, 0, 0], x, y, z, 'XYZ')),
			);
			expect(bits(built.quat.rotateX([0, 0, 0, 0], a, rad))).toEqual(
				bits(quat.rotateX([0, 0, 0, 0], a, rad)),
			);
			expect(bits(built.quat.rotateY([0, 0, 0, 0], a, rad))).toEqual(
				bits(quat.rotateY([0, 0, 0, 0], a, rad)),
			);
			expect(bits(built.quat.rotateZ([0, 0, 0, 0], a, rad))).toEqual(
				bits(quat.rotateZ([0, 0, 0, 0], a, rad)),
			);
			// A fraction from 0 to 1, and b itself and a rotation next to a, for both of slerp's ways.
			const t = (x + 4) / 8;
			for (const to of [b, a, quat.rotateY([0, 0, 0, 0], a, 1e-4)])
				expect(bits(built.quat.slerp([0, 0, 0, 0], a, to, t))).toEqual(
					bits(quat.slerp([0, 0, 0, 0], a, to, t)),
				);
			expect(bits([built.vec3.angle([x, y, z], [z, rad, y])])).toEqual(
				bits([vec3.angle([x, y, z], [z, rad, y])]),
			);
			expect(bits([built.math.damp(x, y, Math.abs(z) * 4, rad * rad)])).toEqual(
				bits([math.damp(x, y, Math.abs(z) * 4, rad * rad)]),
			);
		}
		expect(built.vec3.angle([0, 0, 0], [1, 0, 0])).toBe(Math.PI / 2);
	});

	it('builds every helper on the functions it gets, and on no others', () => {
		// Stand-ins that differ from the browser's: each adds a step to the true value and counts
		// its calls. A helper that reached Math instead would match the browser and count nothing.
		const calls = { sin: 0, cos: 0, acos: 0, exp: 0 };
		const built = createMath({
			sin: (x) => {
				calls.sin++;
				return Math.sin(x) + 1;
			},
			cos: (x) => {
				calls.cos++;
				return Math.cos(x) + 1;
			},
			acos: (x) => {
				calls.acos++;
				return Math.acos(x) + 1;
			},
			exp: (x) => {
				calls.exp++;
				return Math.exp(x) + 1;
			},
		});
		const [a, b] = rotations(2) as [number[], number[]];
		const check = (name: string, ours: ArrayLike<number>, theirs: ArrayLike<number>) =>
			expect({ name, same: bits(ours).join() === bits(theirs).join() }).toEqual({
				name,
				same: false,
			});
		check(
			'setAxisAngle',
			built.quat.setAxisAngle([0, 0, 0, 0], [0, 1, 0], 0.5),
			quat.setAxisAngle([0, 0, 0, 0], [0, 1, 0], 0.5),
		);
		check(
			'fromEuler',
			built.quat.fromEuler([0, 0, 0, 0], 0.1, 0.2, 0.3, 'ZYX'),
			quat.fromEuler([0, 0, 0, 0], 0.1, 0.2, 0.3, 'ZYX'),
		);
		check('rotateX', built.quat.rotateX([0, 0, 0, 0], a, 0.5), quat.rotateX([0, 0, 0, 0], a, 0.5));
		check('rotateY', built.quat.rotateY([0, 0, 0, 0], a, 0.5), quat.rotateY([0, 0, 0, 0], a, 0.5));
		check('rotateZ', built.quat.rotateZ([0, 0, 0, 0], a, 0.5), quat.rotateZ([0, 0, 0, 0], a, 0.5));
		check('slerp', built.quat.slerp([0, 0, 0, 0], a, b, 0.3), quat.slerp([0, 0, 0, 0], a, b, 0.3));
		check('angle', [built.vec3.angle([1, 2, 3], [3, -1, 2])], [vec3.angle([1, 2, 3], [3, -1, 2])]);
		check('damp', [built.math.damp(0, 1, 5, 0.1)], [math.damp(0, 1, 5, 0.1)]);
		expect(calls.sin).toBeGreaterThan(0);
		expect(calls.cos).toBeGreaterThan(0);
		expect(calls.acos).toBe(2);
		expect(calls.exp).toBe(1);
	});

	it('reads the four functions once, when it is called', () => {
		const functions = { ...BROWSER };
		const built = createMath(functions);
		functions.sin = () => 2;
		expect(built.quat.setAxisAngle([0, 0, 0, 0], [0, 1, 0], 1)).toEqual(
			quat.setAxisAngle([0, 0, 0, 0], [0, 1, 0], 1),
		);
	});

	it('names each function that it did not get, with E1213', () => {
		expect(() => createMath({ sin: Math.sin, cos: Math.cos } as unknown as MathFunctions)).toThrow(
			'E1213: createMath() got no function for acos, exp.',
		);
		expect(() => createMath({ ...BROWSER, cos: 1 } as unknown as MathFunctions)).toThrow(
			'E1213: createMath() got no function for cos.',
		);
		expect(() => createMath(undefined as unknown as MathFunctions)).toThrow(
			'E1213: createMath() got no function for sin, cos, acos, exp.',
		);
	});
});

describe('the namespaces and the maths entry', () => {
	// The helpers of each namespace of the main entry, which every release keeps.
	const NAMESPACES = {
		vec3: [
			'create',
			'set',
			'copy',
			'add',
			'sub',
			'multiply',
			'scale',
			'scaleAndAdd',
			'negate',
			'dot',
			'cross',
			'length',
			'squaredLength',
			'distance',
			'squaredDistance',
			'normalize',
			'lerp',
			'min',
			'max',
			'angle',
			'transformQuat',
			'transformMat4',
		],
		quat: [
			'create',
			'set',
			'copy',
			'identity',
			'setAxisAngle',
			'fromEuler',
			'fromMat4',
			'lookAt',
			'rotationTo',
			'multiply',
			'rotateX',
			'rotateY',
			'rotateZ',
			'invert',
			'normalize',
			'dot',
			'slerp',
		],
		math: [
			'clamp',
			'lerp',
			'inverseLerp',
			'mapLinear',
			'damp',
			'smoothstep',
			'degToRad',
			'radToDeg',
			'euclideanModulo',
			'random',
			'seed',
			'randFloat',
			'randInt',
			'randFloatSpread',
		],
	};
	/** The helpers that need a function that differs between JavaScript engines, or hidden state. */
	const LEFT_OUT = new Set([
		'angle',
		'setAxisAngle',
		'fromEuler',
		'rotateX',
		'rotateY',
		'rotateZ',
		'slerp',
		'damp',
		'random',
		'seed',
		'randFloat',
		'randInt',
		'randFloatSpread',
	]);
	const sorted = (names: readonly string[]) => [...names].sort();

	it("keeps every helper of the main entry's namespaces", () => {
		expect(sorted(Object.keys(vec3))).toEqual(sorted(NAMESPACES.vec3));
		expect(sorted(Object.keys(quat))).toEqual(sorted(NAMESPACES.quat));
		expect(sorted(Object.keys(math))).toEqual(sorted(NAMESPACES.math));
	});

	it('gives the maths entry every other helper, and none of those', () => {
		const exact = (names: readonly string[]) => sorted(names.filter((name) => !LEFT_OUT.has(name)));
		expect(sorted(Object.keys(vec3Exact))).toEqual(exact(NAMESPACES.vec3));
		expect(sorted(Object.keys(quatExact))).toEqual(exact(NAMESPACES.quat));
		expect(sorted(Object.keys(numbersExact))).toEqual(exact(NAMESPACES.math));
		// The main entry's mat4 is the maths entry's module itself.
		expect(Object.keys(mat4Exact).length).toBe(7);
		// Each helper of the maths entry is the main entry's own function, so the two never differ.
		const differing = (whole: object, exact: object) => {
			const functions = new Map(Object.entries(whole));
			return Object.entries(exact).filter(([name, fn]) => functions.get(name) !== fn);
		};
		expect(differing(vec3, vec3Exact)).toEqual([]);
		expect(differing(quat, quatExact)).toEqual([]);
		expect(differing(math, numbersExact)).toEqual([]);
	});
});
