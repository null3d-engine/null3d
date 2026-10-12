// Vector and buffer helpers that do three.js's arithmetic in three.js's order, so the generators
// give the same numbers as three.js. A normalize multiplies by the reciprocal of the length, as
// three.js's divideScalar does.

import type { Vec3Like } from '@null3d/engine';
import type { Vec2Like } from './types';

/** A new 2D tuple. */
export type Tuple2 = [number, number];

/** A new 3D tuple. */
export type Tuple3 = [number, number, number];

/** True when a point has two components. Points that the curves make are plain tuples. */
export function is2D(p: Vec2Like): boolean {
	return (p as ArrayLike<number>).length === 2;
}

/** The distance between two points of two or three components, as three.js's distanceTo. */
export function distanceBetween(a: Vec2Like, b: Vec2Like, twoD: boolean): number {
	const dx = (a[0] as number) - (b[0] as number);
	const dy = (a[1] as number) - (b[1] as number);
	if (twoD) return Math.sqrt(dx * dx + dy * dy);
	const dz = (a[2] as number) - (b[2] as number);
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The squared distance between two 3D points, as three.js's distanceToSquared. */
export function distanceSquared3(a: Vec3Like, b: Vec3Like): number {
	const dx = (a[0] as number) - (b[0] as number);
	const dy = (a[1] as number) - (b[1] as number);
	const dz = (a[2] as number) - (b[2] as number);
	return dx * dx + dy * dy + dz * dz;
}

/** True when two points of two or three components are equal, as three.js's equals. */
export function equals(a: Vec2Like, b: Vec2Like, twoD: boolean): boolean {
	return a[0] === b[0] && a[1] === b[1] && (twoD || a[2] === b[2]);
}

/** Scales a 3D vector in place to length 1. A zero vector stays zero. */
export function normalize3(v: Vec3Like): void {
	const x = v[0] as number;
	const y = v[1] as number;
	const z = v[2] as number;
	const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
	v[0] = x * s;
	v[1] = y * s;
	v[2] = z * s;
}

/** Writes the cross product of `a` and `b` into `out`. `out` may be `a` or `b`. */
export function cross3(out: Vec3Like, a: Vec3Like, b: Vec3Like): void {
	const ax = a[0] as number;
	const ay = a[1] as number;
	const az = a[2] as number;
	const bx = b[0] as number;
	const by = b[1] as number;
	const bz = b[2] as number;
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
}

/** The dot product of two 3D vectors. */
export function dot3(a: Vec3Like, b: Vec3Like): number {
	return (
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number)
	);
}

/** Clamps a number to a range, as three.js's MathUtils.clamp. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Turns a 3D vector in place about a unit axis. It builds three.js's makeRotationAxis matrix and
 * applies it as applyMatrix4 does, with the perspective divide, so the result matches exactly.
 */
export function rotateAboutAxis(v: Vec3Like, axis: Vec3Like, angle: number): void {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const t = 1 - c;
	const x = axis[0] as number;
	const y = axis[1] as number;
	const z = axis[2] as number;
	const tx = t * x;
	const ty = t * y;
	const vx = v[0] as number;
	const vy = v[1] as number;
	const vz = v[2] as number;
	const w = 1 / (0 * vx + 0 * vy + 0 * vz + 1);
	v[0] = ((tx * x + c) * vx + (tx * y - s * z) * vy + (tx * z + s * y) * vz + 0) * w;
	v[1] = ((tx * y + s * z) * vx + (ty * y + c) * vy + (ty * z - s * x) * vz + 0) * w;
	v[2] = ((tx * z - s * y) * vx + (ty * z + s * x) * vy + (t * z * z + c) * vz + 0) * w;
}

/**
 * Normalizes each vector of a normal array in place, as three.js's normalizeNormals. The array is
 * 32-bit, so each value rounds as it does in three.js's attribute.
 */
export function normalizeNormals(normals: Float32Array): void {
	for (let i = 0; i < normals.length; i += 3) {
		const x = normals[i] as number;
		const y = normals[i + 1] as number;
		const z = normals[i + 2] as number;
		const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
		normals[i] = x * s;
		normals[i + 1] = y * s;
		normals[i + 2] = z * s;
	}
}

/**
 * The normals of a mesh without indices, as three.js's computeVertexNormals makes them: each
 * triangle's three vertices get its face normal. It reads the 32-bit positions, as three.js reads
 * its attribute.
 */
export function faceNormals(positions: Float32Array): Float32Array {
	const normals = new Float32Array(positions.length);
	const end = positions.length - (positions.length % 9);
	for (let i = 0; i < end; i += 9) {
		const ax = positions[i] as number;
		const ay = positions[i + 1] as number;
		const az = positions[i + 2] as number;
		const bx = positions[i + 3] as number;
		const by = positions[i + 4] as number;
		const bz = positions[i + 5] as number;
		const cbx = (positions[i + 6] as number) - bx;
		const cby = (positions[i + 7] as number) - by;
		const cbz = (positions[i + 8] as number) - bz;
		const abx = ax - bx;
		const aby = ay - by;
		const abz = az - bz;
		const nx = cby * abz - cbz * aby;
		const ny = cbz * abx - cbx * abz;
		const nz = cbx * aby - cby * abx;
		for (let k = i; k < i + 9; k += 3) {
			normals[k] = nx;
			normals[k + 1] = ny;
			normals[k + 2] = nz;
		}
	}
	normalizeNormals(normals);
	return normals;
}

/**
 * A new index array of the given length. It holds 32-bit indices when the largest index reaches
 * 65535, as three.js's setIndex chooses, and 16-bit indices otherwise.
 */
export function indexArray(count: number, maxIndex: number): Uint16Array | Uint32Array {
	return maxIndex >= 65535 ? new Uint32Array(count) : new Uint16Array(count);
}

/**
 * The indices of a grid of rows of `columns + 1` vertices, as three.js's torus knot and tube
 * make them: two triangles per cell.
 */
export function gridIndices(rows: number, columns: number): Uint16Array | Uint32Array {
	const rowCount = rows >= 1 ? Math.floor(rows) : 0;
	const columnCount = columns >= 1 ? Math.floor(columns) : 0;
	const count = rowCount * columnCount * 6;
	const indices = indexArray(count, count > 0 ? (columns + 1) * rowCount + columnCount : 0);
	let o = 0;
	for (let j = 1; j <= rows; j++) {
		for (let i = 1; i <= columns; i++) {
			const a = (columns + 1) * (j - 1) + (i - 1);
			const b = (columns + 1) * j + (i - 1);
			const c = (columns + 1) * j + i;
			const d = (columns + 1) * (j - 1) + i;
			indices[o++] = a;
			indices[o++] = b;
			indices[o++] = d;
			indices[o++] = b;
			indices[o++] = c;
			indices[o++] = d;
		}
	}
	return indices;
}
