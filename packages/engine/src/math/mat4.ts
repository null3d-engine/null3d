// 4 by 4 matrices in plain arrays of 16 numbers, stored column by column as in three.js and
// gl-matrix. A helper that makes a matrix writes it into `out` and returns `out`, so per-frame code
// allocates nothing. Each helper reads its inputs before it writes, so `out` may be one of them. The
// arithmetic follows three.js's, so the results match it. Helpers pass only arrays to other
// helpers, as the quaternion helpers explain.

import { fromMat4 } from './quat';
import type { Mat4Like, QuatLike, Vec3Like } from './types';

/** The rotation part of a matrix, without its scale, that `decompose` reads its quaternion from. */
const unscaled = new Float64Array(16);

/** A new identity matrix. It allocates, so create matrices once, outside per-frame code. */
export function create(): number[] {
	// The fraction makes the array store fractions from the start, as `vec3.create` explains.
	const out = [1.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	out[0] = 1;
	return out;
}

/** Sets `out` to the identity matrix, which changes nothing. */
export function identity<T extends Mat4Like>(out: T): T {
	for (let i = 0; i < 16; i++) out[i] = i % 5 === 0 ? 1 : 0;
	return out;
}

/** Copies `a` into `out`. */
export function copy<T extends Mat4Like>(out: T, a: Mat4Like): T {
	for (let i = 0; i < 16; i++) out[i] = a[i] as number;
	return out;
}

/**
 * The product of `a` and `b`, as three.js's `multiplyMatrices`. It transforms a point by `b` first,
 * then by `a`.
 */
export function multiply<T extends Mat4Like>(out: T, a: Mat4Like, b: Mat4Like): T {
	const a00 = a[0] as number;
	const a01 = a[1] as number;
	const a02 = a[2] as number;
	const a03 = a[3] as number;
	const a10 = a[4] as number;
	const a11 = a[5] as number;
	const a12 = a[6] as number;
	const a13 = a[7] as number;
	const a20 = a[8] as number;
	const a21 = a[9] as number;
	const a22 = a[10] as number;
	const a23 = a[11] as number;
	const a30 = a[12] as number;
	const a31 = a[13] as number;
	const a32 = a[14] as number;
	const a33 = a[15] as number;
	// Each column of `b` is read before the same column of `out` is written.
	for (let i = 0; i < 16; i += 4) {
		const b0 = b[i] as number;
		const b1 = b[i + 1] as number;
		const b2 = b[i + 2] as number;
		const b3 = b[i + 3] as number;
		out[i] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[i + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[i + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[i + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	}
	return out;
}

/**
 * The inverse of `a`, which undoes it, as three.js's `invert`. A matrix that has no inverse gives
 * all zeros.
 */
export function invert<T extends Mat4Like>(out: T, a: Mat4Like): T {
	const a00 = a[0] as number;
	const a01 = a[1] as number;
	const a02 = a[2] as number;
	const a03 = a[3] as number;
	const a10 = a[4] as number;
	const a11 = a[5] as number;
	const a12 = a[6] as number;
	const a13 = a[7] as number;
	const a20 = a[8] as number;
	const a21 = a[9] as number;
	const a22 = a[10] as number;
	const a23 = a[11] as number;
	const a30 = a[12] as number;
	const a31 = a[13] as number;
	const a32 = a[14] as number;
	const a33 = a[15] as number;
	const b00 = a00 * a11 - a01 * a10;
	const b01 = a00 * a12 - a02 * a10;
	const b02 = a00 * a13 - a03 * a10;
	const b03 = a01 * a12 - a02 * a11;
	const b04 = a01 * a13 - a03 * a11;
	const b05 = a02 * a13 - a03 * a12;
	const b06 = a20 * a31 - a21 * a30;
	const b07 = a20 * a32 - a22 * a30;
	const b08 = a20 * a33 - a23 * a30;
	const b09 = a21 * a32 - a22 * a31;
	const b10 = a21 * a33 - a23 * a31;
	const b11 = a22 * a33 - a23 * a32;
	const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (determinant === 0) {
		for (let i = 0; i < 16; i++) out[i] = 0;
		return out;
	}
	const d = 1 / determinant;
	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
	out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
	out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
	out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
	out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
	out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
	out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
	out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
	out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
	return out;
}

/**
 * The matrix that scales by `scale`, then turns by the quaternion `rotation`, then moves by
 * `position`, as three.js's `compose`.
 */
export function compose<T extends Mat4Like>(
	out: T,
	position: Vec3Like,
	rotation: QuatLike,
	scale: Vec3Like,
): T {
	const x = rotation[0] as number;
	const y = rotation[1] as number;
	const z = rotation[2] as number;
	const w = rotation[3] as number;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	const sx = scale[0] as number;
	const sy = scale[1] as number;
	const sz = scale[2] as number;
	out[0] = (1 - (yy + zz)) * sx;
	out[1] = (xy + wz) * sx;
	out[2] = (xz - wy) * sx;
	out[3] = 0;
	out[4] = (xy - wz) * sy;
	out[5] = (1 - (xx + zz)) * sy;
	out[6] = (yz + wx) * sy;
	out[7] = 0;
	out[8] = (xz + wy) * sz;
	out[9] = (yz - wx) * sz;
	out[10] = (1 - (xx + yy)) * sz;
	out[11] = 0;
	out[12] = position[0] as number;
	out[13] = position[1] as number;
	out[14] = position[2] as number;
	out[15] = 1;
	return out;
}

/**
 * Splits the matrix `m` into the position, rotation and scale that `compose` joins, as three.js's
 * `decompose`, and writes them into the first three arrays. A matrix that mirrors space gives a
 * negative X scale. A matrix that flattens space gives no rotation and a scale of 1.
 */
export function decompose(
	position: Vec3Like,
	rotation: QuatLike,
	scale: Vec3Like,
	m: Mat4Like,
): void {
	const m11 = m[0] as number;
	const m21 = m[1] as number;
	const m31 = m[2] as number;
	const m12 = m[4] as number;
	const m22 = m[5] as number;
	const m32 = m[6] as number;
	const m13 = m[8] as number;
	const m23 = m[9] as number;
	const m33 = m[10] as number;
	position[0] = m[12] as number;
	position[1] = m[13] as number;
	position[2] = m[14] as number;
	const determinant =
		m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31);
	if (determinant === 0) {
		rotation[0] = 0;
		rotation[1] = 0;
		rotation[2] = 0;
		rotation[3] = 1;
		scale[0] = 1;
		scale[1] = 1;
		scale[2] = 1;
		return;
	}
	let sx = Math.sqrt(m11 * m11 + m21 * m21 + m31 * m31);
	const sy = Math.sqrt(m12 * m12 + m22 * m22 + m32 * m32);
	const sz = Math.sqrt(m13 * m13 + m23 * m23 + m33 * m33);
	if (determinant < 0) sx = -sx;
	const kx = 1 / sx;
	const ky = 1 / sy;
	const kz = 1 / sz;
	unscaled[0] = m11 * kx;
	unscaled[1] = m21 * kx;
	unscaled[2] = m31 * kx;
	unscaled[4] = m12 * ky;
	unscaled[5] = m22 * ky;
	unscaled[6] = m32 * ky;
	unscaled[8] = m13 * kz;
	unscaled[9] = m23 * kz;
	unscaled[10] = m33 * kz;
	fromMat4(rotation, unscaled);
	scale[0] = sx;
	scale[1] = sy;
	scale[2] = sz;
}
