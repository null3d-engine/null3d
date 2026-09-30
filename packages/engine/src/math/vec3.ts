// Vectors (x, y, z) in plain arrays, in the style of gl-matrix: a helper that makes a vector writes
// it into `out` and returns `out`, so per-frame code allocates nothing. Each helper reads its inputs
// before it writes, so `out` may be one of them. Where three.js has the same operation, the
// arithmetic follows three.js's, so the results match it. Each helper does its own arithmetic, as
// the quaternion helpers explain.

import type { Mat4Like, QuatLike, Vec3Like } from './types';

/** A new vector (0, 0, 0). It allocates, so create vectors once, outside per-frame code. */
export function create(): [number, number, number] {
	// A fraction in the literal makes the array store fractions from the start. An array of whole
	// numbers changes its storage at the first fraction written into it. In Chrome, a helper that
	// has seen that change then makes a number object for each fraction it writes, into any array.
	const out: [number, number, number] = [0.5, 0, 0];
	out[0] = 0;
	return out;
}

/** Sets the components of `out`. */
export function set<T extends Vec3Like>(out: T, x: number, y: number, z: number): T {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

/** Copies `a` into `out`. */
export function copy<T extends Vec3Like>(out: T, a: Vec3Like): T {
	out[0] = a[0] as number;
	out[1] = a[1] as number;
	out[2] = a[2] as number;
	return out;
}

/** Adds `a` and `b`. */
export function add<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	out[0] = (a[0] as number) + (b[0] as number);
	out[1] = (a[1] as number) + (b[1] as number);
	out[2] = (a[2] as number) + (b[2] as number);
	return out;
}

/** Subtracts `b` from `a`. */
export function sub<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	out[0] = (a[0] as number) - (b[0] as number);
	out[1] = (a[1] as number) - (b[1] as number);
	out[2] = (a[2] as number) - (b[2] as number);
	return out;
}

/** Multiplies `a` and `b` component by component. */
export function multiply<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	out[0] = (a[0] as number) * (b[0] as number);
	out[1] = (a[1] as number) * (b[1] as number);
	out[2] = (a[2] as number) * (b[2] as number);
	return out;
}

/** Multiplies `a` by the number `s`. */
export function scale<T extends Vec3Like>(out: T, a: Vec3Like, s: number): T {
	out[0] = (a[0] as number) * s;
	out[1] = (a[1] as number) * s;
	out[2] = (a[2] as number) * s;
	return out;
}

/** Adds `b` times the number `s` to `a`, as three.js's `addScaledVector`. */
export function scaleAndAdd<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like, s: number): T {
	out[0] = (a[0] as number) + (b[0] as number) * s;
	out[1] = (a[1] as number) + (b[1] as number) * s;
	out[2] = (a[2] as number) + (b[2] as number) * s;
	return out;
}

/** Reverses the direction of `a`. */
export function negate<T extends Vec3Like>(out: T, a: Vec3Like): T {
	out[0] = -(a[0] as number);
	out[1] = -(a[1] as number);
	out[2] = -(a[2] as number);
	return out;
}

/** The dot product of `a` and `b`. */
export function dot(a: Vec3Like, b: Vec3Like): number {
	return (
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number)
	);
}

/** The cross product of `a` and `b`: a vector at right angles to both. */
export function cross<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	const bx = b[0] as number;
	const by = b[1] as number;
	const bz = b[2] as number;
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
	return out;
}

/** The length of `a`. */
export function length(a: Vec3Like): number {
	const x = a[0] as number;
	const y = a[1] as number;
	const z = a[2] as number;
	return Math.sqrt(x * x + y * y + z * z);
}

/** The squared length of `a`. It skips the square root, so use it to compare lengths. */
export function squaredLength(a: Vec3Like): number {
	const x = a[0] as number;
	const y = a[1] as number;
	const z = a[2] as number;
	return x * x + y * y + z * z;
}

/** The distance between the points `a` and `b`. */
export function distance(a: Vec3Like, b: Vec3Like): number {
	const x = (a[0] as number) - (b[0] as number);
	const y = (a[1] as number) - (b[1] as number);
	const z = (a[2] as number) - (b[2] as number);
	return Math.sqrt(x * x + y * y + z * z);
}

/** The squared distance between the points `a` and `b`. It skips the square root, so use it to compare distances. */
export function squaredDistance(a: Vec3Like, b: Vec3Like): number {
	const x = (a[0] as number) - (b[0] as number);
	const y = (a[1] as number) - (b[1] as number);
	const z = (a[2] as number) - (b[2] as number);
	return x * x + y * y + z * z;
}

/** Scales `a` to length 1. A zero vector stays zero. */
export function normalize<T extends Vec3Like>(out: T, a: Vec3Like): T {
	const x = a[0] as number;
	const y = a[1] as number;
	const z = a[2] as number;
	const k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
	out[0] = x * k;
	out[1] = y * k;
	out[2] = z * k;
	return out;
}

/** The point a fraction `t` of the way from `a` to `b`. */
export function lerp<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like, t: number): T {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	out[0] = ax + ((b[0] as number) - ax) * t;
	out[1] = ay + ((b[1] as number) - ay) * t;
	out[2] = az + ((b[2] as number) - az) * t;
	return out;
}

/** The smaller of `a` and `b` on each axis. */
export function min<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	out[0] = Math.min(a[0] as number, b[0] as number);
	out[1] = Math.min(a[1] as number, b[1] as number);
	out[2] = Math.min(a[2] as number, b[2] as number);
	return out;
}

/** The larger of `a` and `b` on each axis. */
export function max<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T {
	out[0] = Math.max(a[0] as number, b[0] as number);
	out[1] = Math.max(a[1] as number, b[1] as number);
	out[2] = Math.max(a[2] as number, b[2] as number);
	return out;
}

/** The angle between `a` and `b` in radians, from 0 to π. It is π / 2 when either vector is zero. */
export function angle(a: Vec3Like, b: Vec3Like): number {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	const bx = b[0] as number;
	const by = b[1] as number;
	const bz = b[2] as number;
	const denominator = Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz));
	if (denominator === 0) return Math.PI / 2;
	// Rounding can put the cosine just past 1 or -1, where it has no angle.
	return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / denominator)));
}

/** Turns `a` by the rotation `q`, a quaternion of length 1, as three.js's `applyQuaternion`. */
export function transformQuat<T extends Vec3Like>(out: T, a: Vec3Like, q: QuatLike): T {
	const vx = a[0] as number;
	const vy = a[1] as number;
	const vz = a[2] as number;
	const qx = q[0] as number;
	const qy = q[1] as number;
	const qz = q[2] as number;
	const qw = q[3] as number;
	const tx = 2 * (qy * vz - qz * vy);
	const ty = 2 * (qz * vx - qx * vz);
	const tz = 2 * (qx * vy - qy * vx);
	out[0] = vx + qw * tx + qy * tz - qz * ty;
	out[1] = vy + qw * ty + qz * tx - qx * tz;
	out[2] = vz + qw * tz + qx * ty - qy * tx;
	return out;
}

/**
 * Transforms the point `a` by the matrix `m`, with the perspective divide, as three.js's
 * `applyMatrix4`.
 */
export function transformMat4<T extends Vec3Like>(out: T, a: Vec3Like, m: Mat4Like): T {
	const x = a[0] as number;
	const y = a[1] as number;
	const z = a[2] as number;
	const w =
		1 / ((m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number));
	out[0] =
		((m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number)) * w;
	out[1] =
		((m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number)) * w;
	out[2] =
		((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number)) * w;
	return out;
}
