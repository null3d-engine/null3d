// Rotations as quaternions (x, y, z, w) in plain arrays, in the style of gl-matrix: a helper that
// makes a rotation writes it into `out` and returns `out`, so per-frame code allocates nothing. Each
// helper reads its inputs before it writes, so `out` may be one of them. Angles are in radians, and
// the arithmetic follows three.js's, so the results match it.
//
// Each helper here uses exact arithmetic only, so a deterministic simulation can import this module
// through the maths entry (`@null3d/engine/math/quat`). The helpers that turn by an angle need a
// sine and a cosine, and live in create-math.ts; the main entry's `quat` namespace
// (namespaces/quat.ts) adds them, built on the browser's `Math`.
//
// Each helper does its own arithmetic and passes only arrays to other helpers. A fraction passed to
// or returned from a call that the browser does not inline becomes a new number object, and a large
// sketch function can use up the browser's inlining budget.

import type { Mat4Like, QuatLike, Vec3Like } from './types';

/** The up direction that `lookAt` uses when a call gives none. */
const UP: Vec3Like = [0, 1, 0];

/** The rotation matrix that `lookAt` builds before it reads its quaternion. */
const basis = new Float64Array(16);

/**
 * A quaternion that `rotationTo` builds before it scales it to length 1. It keeps full precision,
 * where `out` may be a Float32Array.
 */
const unscaled = new Float64Array(4);

/**
 * A new quaternion (0, 0, 0, 1), which turns nothing. It allocates, so create quaternions once,
 * outside per-frame code.
 */
export function create(): [number, number, number, number] {
	// The fraction makes the array store fractions from the start, as `vec3.create` explains.
	const out: [number, number, number, number] = [0.5, 0, 0, 1];
	out[0] = 0;
	return out;
}

/** Sets the components of `out`. */
export function set<T extends QuatLike>(out: T, x: number, y: number, z: number, w: number): T {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	out[3] = w;
	return out;
}

/** Copies `a` into `out`. */
export function copy<T extends QuatLike>(out: T, a: QuatLike): T {
	out[0] = a[0] as number;
	out[1] = a[1] as number;
	out[2] = a[2] as number;
	out[3] = a[3] as number;
	return out;
}

/** Sets `out` to (0, 0, 0, 1), which turns nothing. */
export function identity<T extends QuatLike>(out: T): T {
	out[0] = 0;
	out[1] = 0;
	out[2] = 0;
	out[3] = 1;
	return out;
}

/**
 * The rotation of the matrix `m`, whose upper 3 by 3 part must hold no scale, as three.js's
 * `setFromRotationMatrix`. To read the rotation of a matrix with scale, use `mat4.decompose`.
 */
export function fromMat4<T extends QuatLike>(out: T, m: Mat4Like): T {
	const m11 = m[0] as number;
	const m21 = m[1] as number;
	const m31 = m[2] as number;
	const m12 = m[4] as number;
	const m22 = m[5] as number;
	const m32 = m[6] as number;
	const m13 = m[8] as number;
	const m23 = m[9] as number;
	const m33 = m[10] as number;
	const trace = m11 + m22 + m33;
	if (trace > 0) {
		const s = 0.5 / Math.sqrt(trace + 1);
		out[0] = (m32 - m23) * s;
		out[1] = (m13 - m31) * s;
		out[2] = (m21 - m12) * s;
		out[3] = 0.25 / s;
	} else if (m11 > m22 && m11 > m33) {
		const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
		out[0] = 0.25 * s;
		out[1] = (m12 + m21) / s;
		out[2] = (m13 + m31) / s;
		out[3] = (m32 - m23) / s;
	} else if (m22 > m33) {
		const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
		out[0] = (m12 + m21) / s;
		out[1] = 0.25 * s;
		out[2] = (m23 + m32) / s;
		out[3] = (m13 - m31) / s;
	} else {
		const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
		out[0] = (m13 + m31) / s;
		out[1] = (m23 + m32) / s;
		out[2] = 0.25 * s;
		out[3] = (m21 - m12) / s;
	}
	return out;
}

/**
 * The rotation that turns an object at `eye` so that its +Z axis points at `target`, with its +Y
 * axis as close to `up` as it can be, or to +Y without `up`. A mesh looks at a point this way, in
 * null3D and in three.js. Cameras and lights look down their -Z axis instead: for them, swap `eye`
 * and `target`.
 */
export function lookAt<T extends QuatLike>(
	out: T,
	eye: Vec3Like,
	target: Vec3Like,
	up?: Vec3Like,
): T {
	let zx = (target[0] as number) - (eye[0] as number);
	let zy = (target[1] as number) - (eye[1] as number);
	let zz = (target[2] as number) - (eye[2] as number);
	if (zx * zx + zy * zy + zz * zz === 0) zz = 1;
	let k = 1 / (Math.sqrt(zx * zx + zy * zy + zz * zz) || 1);
	zx *= k;
	zy *= k;
	zz *= k;
	const upward = up ?? UP;
	const ux = upward[0] as number;
	const uy = upward[1] as number;
	const uz = upward[2] as number;
	let xx = uy * zz - uz * zy;
	let xy = uz * zx - ux * zz;
	let xz = ux * zy - uy * zx;
	if (xx * xx + xy * xy + xz * xz === 0) {
		// The object would look along the up axis: tilt the view slightly, as three.js does.
		if (Math.abs(uz) === 1) zx += 0.0001;
		else zz += 0.0001;
		k = 1 / (Math.sqrt(zx * zx + zy * zy + zz * zz) || 1);
		zx *= k;
		zy *= k;
		zz *= k;
		xx = uy * zz - uz * zy;
		xy = uz * zx - ux * zz;
		xz = ux * zy - uy * zx;
	}
	k = 1 / (Math.sqrt(xx * xx + xy * xy + xz * xz) || 1);
	basis[0] = xx * k;
	basis[1] = xy * k;
	basis[2] = xz * k;
	basis[4] = zy * basis[2] - zz * basis[1];
	basis[5] = zz * basis[0] - zx * basis[2];
	basis[6] = zx * basis[1] - zy * basis[0];
	basis[8] = zx;
	basis[9] = zy;
	basis[10] = zz;
	return fromMat4(out, basis);
}

/**
 * The shortest rotation that turns the direction `a` onto the direction `b`, as three.js's
 * `setFromUnitVectors`. Both vectors must have length 1.
 */
export function rotationTo<T extends QuatLike>(out: T, a: Vec3Like, b: Vec3Like): T {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	const bx = b[0] as number;
	const by = b[1] as number;
	const bz = b[2] as number;
	const r = ax * bx + ay * by + az * bz + 1;
	if (r < 1e-8) {
		// Opposite directions: turn half a circle about an axis at right angles to `a`.
		const alongX = Math.abs(ax) > Math.abs(az);
		unscaled[0] = alongX ? -ay : 0;
		unscaled[1] = alongX ? ax : -az;
		unscaled[2] = alongX ? 0 : ay;
		unscaled[3] = 0;
	} else {
		unscaled[0] = ay * bz - az * by;
		unscaled[1] = az * bx - ax * bz;
		unscaled[2] = ax * by - ay * bx;
		unscaled[3] = r;
	}
	return normalize(out, unscaled);
}

/**
 * The product of `a` and `b`, as three.js's `multiplyQuaternions`. It turns a vector by `b` first,
 * then by `a`.
 */
export function multiply<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike): T {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	const aw = a[3] as number;
	const bx = b[0] as number;
	const by = b[1] as number;
	const bz = b[2] as number;
	const bw = b[3] as number;
	out[0] = ax * bw + aw * bx + ay * bz - az * by;
	out[1] = ay * bw + aw * by + az * bx - ax * bz;
	out[2] = az * bw + aw * bz + ax * by - ay * bx;
	out[3] = aw * bw - ax * bx - ay * by - az * bz;
	return out;
}

/** The rotation that undoes `a`, a quaternion of length 1, as three.js's `invert`. */
export function invert<T extends QuatLike>(out: T, a: QuatLike): T {
	out[0] = -(a[0] as number);
	out[1] = -(a[1] as number);
	out[2] = -(a[2] as number);
	out[3] = a[3] as number;
	return out;
}

/** Scales `a` to length 1. A zero quaternion becomes (0, 0, 0, 1). */
export function normalize<T extends QuatLike>(out: T, a: QuatLike): T {
	const x = a[0] as number;
	const y = a[1] as number;
	const z = a[2] as number;
	const w = a[3] as number;
	const length = Math.sqrt(x * x + y * y + z * z + w * w);
	if (length === 0) return identity(out);
	const k = 1 / length;
	out[0] = x * k;
	out[1] = y * k;
	out[2] = z * k;
	out[3] = w * k;
	return out;
}

/** The dot product of `a` and `b`. */
export function dot(a: QuatLike, b: QuatLike): number {
	return (
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number) +
		(a[3] as number) * (b[3] as number)
	);
}
