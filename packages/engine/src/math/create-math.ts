// The math helpers that need a sine, a cosine, an arc cosine or an exponential, each written once in
// a function that takes those functions and returns the helper built on them, and `createMath`,
// which builds every one of them on the functions that a caller gives.
//
// Two callers share each implementation. The main entry's namespaces (namespaces/*.ts) build each
// helper once, when they load, on the browser's `Math.sin`, `Math.cos`, `Math.acos` and `Math.exp`,
// and export the helper itself. Those functions are implementation-defined, so their results can
// differ between JavaScript engines in the last bit. `createMath` builds the same helpers on
// functions that the caller passes, such as an exact math library's, for a simulation that must give
// the same bits on every engine. This module never names `Math.sin` or the others, so a simulation
// that imports it holds none of them.
//
// A helper reads its functions from the scope that its maker ran in, and the namespaces export it
// with no wrapper around it. Built so, each helper runs as fast as the same helper written against
// `Math` in Chrome, Firefox, Node and Bun; a wrapper that called it cost Firefox up to 4%, and passing
// the functions as arguments cost JavaScriptCore 11% on `slerp` (D-368). Each helper does its own
// arithmetic and passes only arrays to other helpers, as quat.ts explains.

import { normalize } from './quat';
import type { EulerOrder, QuatLike, Vec3Like } from './types';

/** A function of one number, such as a sine. */
type NumberFunction = (x: number) => number;

/** A quaternion that `slerp` builds before it scales it to length 1, in full precision. */
const unscaled = new Float64Array(4);

/** The signs of the cross terms of each Euler order, the only part of the formula that differs between orders. */
const EULER_SIGNS: Readonly<Record<EulerOrder, readonly number[]>> = {
	XYZ: [1, -1, 1, -1],
	YXZ: [1, -1, -1, 1],
	ZXY: [-1, 1, 1, -1],
	ZYX: [-1, 1, -1, 1],
	YZX: [1, 1, -1, -1],
	XZY: [-1, -1, 1, 1],
};

/** `quat.setAxisAngle`, built on `sin` and `cos`: the one implementation of the helper. */
export function makeSetAxisAngle(
	sin: NumberFunction,
	cos: NumberFunction,
): QuatHelpers['setAxisAngle'] {
	return function setAxisAngle<T extends QuatLike>(out: T, axis: Vec3Like, rad: number): T {
		const half = rad / 2;
		const s = sin(half);
		out[0] = (axis[0] as number) * s;
		out[1] = (axis[1] as number) * s;
		out[2] = (axis[2] as number) * s;
		out[3] = cos(half);
		return out;
	};
}

/** `quat.fromEuler`, built on `sin` and `cos`: the one implementation of the helper. */
export function makeFromEuler(sin: NumberFunction, cos: NumberFunction): QuatHelpers['fromEuler'] {
	return function fromEuler<T extends QuatLike>(
		out: T,
		x: number,
		y: number,
		z: number,
		order: EulerOrder = 'XYZ',
	): T {
		const c1 = cos(x / 2);
		const c2 = cos(y / 2);
		const c3 = cos(z / 2);
		const s1 = sin(x / 2);
		const s2 = sin(y / 2);
		const s3 = sin(z / 2);
		const signs = EULER_SIGNS[order];
		out[0] = s1 * c2 * c3 + (signs[0] as number) * c1 * s2 * s3;
		out[1] = c1 * s2 * c3 + (signs[1] as number) * s1 * c2 * s3;
		out[2] = c1 * c2 * s3 + (signs[2] as number) * s1 * s2 * c3;
		out[3] = c1 * c2 * c3 + (signs[3] as number) * s1 * s2 * s3;
		return out;
	};
}

/** `quat.rotateX`, built on `sin` and `cos`: the one implementation of the helper. */
export function makeRotateX(sin: NumberFunction, cos: NumberFunction): QuatHelpers['rotateX'] {
	return function rotateX<T extends QuatLike>(out: T, a: QuatLike, rad: number): T {
		const ax = a[0] as number;
		const ay = a[1] as number;
		const az = a[2] as number;
		const aw = a[3] as number;
		const bx = sin(rad / 2);
		const bw = cos(rad / 2);
		out[0] = ax * bw + aw * bx;
		out[1] = ay * bw + az * bx;
		out[2] = az * bw - ay * bx;
		out[3] = aw * bw - ax * bx;
		return out;
	};
}

/** `quat.rotateY`, built on `sin` and `cos`: the one implementation of the helper. */
export function makeRotateY(sin: NumberFunction, cos: NumberFunction): QuatHelpers['rotateY'] {
	return function rotateY<T extends QuatLike>(out: T, a: QuatLike, rad: number): T {
		const ax = a[0] as number;
		const ay = a[1] as number;
		const az = a[2] as number;
		const aw = a[3] as number;
		const by = sin(rad / 2);
		const bw = cos(rad / 2);
		out[0] = ax * bw - az * by;
		out[1] = ay * bw + aw * by;
		out[2] = az * bw + ax * by;
		out[3] = aw * bw - ay * by;
		return out;
	};
}

/** `quat.rotateZ`, built on `sin` and `cos`: the one implementation of the helper. */
export function makeRotateZ(sin: NumberFunction, cos: NumberFunction): QuatHelpers['rotateZ'] {
	return function rotateZ<T extends QuatLike>(out: T, a: QuatLike, rad: number): T {
		const ax = a[0] as number;
		const ay = a[1] as number;
		const az = a[2] as number;
		const aw = a[3] as number;
		const bz = sin(rad / 2);
		const bw = cos(rad / 2);
		out[0] = ax * bw + ay * bz;
		out[1] = ay * bw - ax * bz;
		out[2] = az * bw + aw * bz;
		out[3] = aw * bw - az * bz;
		return out;
	};
}

/** `quat.slerp`, built on `sin` and `acos`: the one implementation of the helper. */
export function makeSlerp(sin: NumberFunction, acos: NumberFunction): QuatHelpers['slerp'] {
	return function slerp<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number): T {
		const ax = a[0] as number;
		const ay = a[1] as number;
		const az = a[2] as number;
		const aw = a[3] as number;
		let bx = b[0] as number;
		let by = b[1] as number;
		let bz = b[2] as number;
		let bw = b[3] as number;
		let cosine = ax * bx + ay * by + az * bz + aw * bw;
		if (cosine < 0) {
			// q and -q are the same rotation: take the one on the shorter arc.
			bx = -bx;
			by = -by;
			bz = -bz;
			bw = -bw;
			cosine = -cosine;
		}
		const s = 1 - t;
		if (cosine < 0.9995) {
			const theta = acos(cosine);
			const sine = sin(theta);
			const sa = sin(s * theta) / sine;
			const sb = sin(t * theta) / sine;
			out[0] = ax * sa + bx * sb;
			out[1] = ay * sa + by * sb;
			out[2] = az * sa + bz * sb;
			out[3] = aw * sa + bw * sb;
			return out;
		}
		// Close rotations blend in a straight line, which shortens the result, so scale it back.
		unscaled[0] = ax * s + bx * t;
		unscaled[1] = ay * s + by * t;
		unscaled[2] = az * s + bz * t;
		unscaled[3] = aw * s + bw * t;
		return normalize(out, unscaled);
	};
}

/** `vec3.angle`, built on `acos`: the one implementation of the helper. */
export function makeAngle(acos: NumberFunction): Vec3Helpers['angle'] {
	return function angle(a: Vec3Like, b: Vec3Like): number {
		const ax = a[0] as number;
		const ay = a[1] as number;
		const az = a[2] as number;
		const bx = b[0] as number;
		const by = b[1] as number;
		const bz = b[2] as number;
		const denominator = Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz));
		if (denominator === 0) return Math.PI / 2;
		// Rounding can put the cosine just past 1 or -1, where it has no angle.
		return acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / denominator)));
	};
}

/** `math.damp`, built on `exp`: the one implementation of the helper. */
export function makeDamp(exp: NumberFunction): NumberHelpers['damp'] {
	return function damp(x: number, y: number, lambda: number, dt: number): number {
		const t = 1 - exp(-lambda * dt);
		return (1 - t) * x + t * y;
	};
}

/**
 * The four functions that `createMath` builds its helpers on, each taking and giving radians where
 * it takes an angle. An exact math library that gives the same bits on every JavaScript engine has
 * them, under these names or others. The helpers call each one as a plain function, with no `this`.
 *
 * @category api/math
 */
export interface MathFunctions {
	/** The sine of an angle in radians. */
	sin(x: number): number;
	/** The cosine of an angle in radians. */
	cos(x: number): number;
	/** The angle in radians, from 0 to π, whose cosine is `x`. */
	acos(x: number): number;
	/** e raised to the power `x`. */
	exp(x: number): number;
}

/**
 * The quaternion helpers that `createMath` builds: the ones that turn by an angle. Each takes the
 * same arguments as the `quat` helper of its name, and does the same arithmetic with the functions
 * that `createMath` got.
 *
 * @category api/math
 */
export interface QuatHelpers {
	/** The rotation of `rad` radians about `axis`, a vector of length 1, as `quat.setAxisAngle`. */
	setAxisAngle<T extends QuatLike>(out: T, axis: Vec3Like, rad: number): T;
	/** The rotation of Euler angles in radians, applied in `order`, as `quat.fromEuler`. */
	fromEuler<T extends QuatLike>(out: T, x: number, y: number, z: number, order?: EulerOrder): T;
	/** Turns the rotation `a` by `rad` radians about its own X axis, as `quat.rotateX`. */
	rotateX<T extends QuatLike>(out: T, a: QuatLike, rad: number): T;
	/** Turns the rotation `a` by `rad` radians about its own Y axis, as `quat.rotateY`. */
	rotateY<T extends QuatLike>(out: T, a: QuatLike, rad: number): T;
	/** Turns the rotation `a` by `rad` radians about its own Z axis, as `quat.rotateZ`. */
	rotateZ<T extends QuatLike>(out: T, a: QuatLike, rad: number): T;
	/** The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, as `quat.slerp`. */
	slerp<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number): T;
}

/**
 * The vector helper that `createMath` builds, with the same arguments and arithmetic as `vec3.angle`.
 *
 * @category api/math
 */
export interface Vec3Helpers {
	/** The angle between `a` and `b` in radians, from 0 to π, as `vec3.angle`. */
	angle(a: Vec3Like, b: Vec3Like): number;
}

/**
 * The number helper that `createMath` builds, with the same arguments and arithmetic as `math.damp`.
 *
 * @category api/math
 */
export interface NumberHelpers {
	/** Moves `x` toward `y` by an amount that suits the step `dt` in seconds, as `math.damp`. */
	damp(x: number, y: number, lambda: number, dt: number): number;
}

/**
 * The helpers that `createMath` returns, grouped and named as the main entry's namespaces group
 * and name them.
 *
 * @category api/math
 */
export interface MathHelpers {
	/** `setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`. */
	readonly quat: QuatHelpers;
	/** `angle`. */
	readonly vec3: Vec3Helpers;
	/** `damp`. */
	readonly math: NumberHelpers;
}

/** The names that `createMath` reads from its argument, in the order that its error lists them. */
const FUNCTION_NAMES = ['sin', 'cos', 'acos', 'exp'] as const;

/**
 * The math helpers that need a sine, a cosine, an arc cosine or an exponential, built on the four
 * functions given: `quat.setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`,
 * `vec3.angle` and `math.damp`. Each does the same arithmetic as the main entry's helper of its name,
 * which uses the browser's `Math`. Pass an exact math library's functions, and a deterministic
 * simulation gets the same bits on every JavaScript engine. Call it once, outside per-frame code: it
 * allocates the helpers. Throws E1213 when one of the four is not a function.
 *
 * @category api/math
 */
export function createMath(functions: MathFunctions): MathHelpers {
	const missing = FUNCTION_NAMES.filter((name) => typeof functions?.[name] !== 'function');
	if (missing.length > 0)
		throw new Error(
			`E1213: createMath() got no function for ${missing.join(', ')}. Pass an object with the functions sin, cos, acos and exp, such as an exact math library's.`,
		);
	// The functions are read once, so a later change to the object changes no helper.
	const { sin, cos, acos, exp } = functions;
	return {
		quat: {
			setAxisAngle: makeSetAxisAngle(sin, cos),
			fromEuler: makeFromEuler(sin, cos),
			rotateX: makeRotateX(sin, cos),
			rotateY: makeRotateY(sin, cos),
			rotateZ: makeRotateZ(sin, cos),
			slerp: makeSlerp(sin, acos),
		},
		vec3: { angle: makeAngle(acos) },
		math: { damp: makeDamp(exp) },
	};
}
