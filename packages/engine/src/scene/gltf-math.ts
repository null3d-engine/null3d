// The matrix arithmetic of glTF files that the parser (in the glTF worker) and the loader (on the
// sketch's thread) share: 3 × 4 matrices by rows from a position, a rotation and a scale, their
// products, boxes that they move, and the split of a matrix back into those three parts. It
// imports nothing.

/** A 3 × 4 matrix by rows from a position, a rotation and a scale. */
export function affineOf(t: ArrayLike<number>): Float64Array {
	const [px, py, pz, x, y, z, w, sx, sy, sz] = Array.from(t) as number[];
	const [x2, y2, z2] = [(x as number) * 2, (y as number) * 2, (z as number) * 2];
	const [xx, xy, xz] = [(x as number) * x2, (x as number) * y2, (x as number) * z2];
	const [yy, yz, zz] = [(y as number) * y2, (y as number) * z2, (z as number) * z2];
	const [wx, wy, wz] = [(w as number) * x2, (w as number) * y2, (w as number) * z2];
	return new Float64Array([
		(1 - (yy + zz)) * (sx as number),
		(xy - wz) * (sy as number),
		(xz + wy) * (sz as number),
		px as number,
		(xy + wz) * (sx as number),
		(1 - (xx + zz)) * (sy as number),
		(yz - wx) * (sz as number),
		py as number,
		(xz - wy) * (sx as number),
		(yz + wx) * (sy as number),
		(1 - (xx + yy)) * (sz as number),
		pz as number,
	]);
}

/** The product `a × b` of two 3 × 4 matrices by rows: `b` applies first. */
export function multiplyAffine(a: Float64Array, b: Float64Array): Float64Array {
	const out = new Float64Array(12);
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 4; c++)
			out[r * 4 + c] =
				(a[r * 4] as number) * (b[c] as number) +
				(a[r * 4 + 1] as number) * (b[4 + c] as number) +
				(a[r * 4 + 2] as number) * (b[8 + c] as number) +
				(c === 3 ? (a[r * 4 + 3] as number) : 0);
	return out;
}

/**
 * Grows the box `min`, `max` to hold the box `low`, `high` moved by the 3 × 4 matrix by rows `m`:
 * each of its eight corners.
 */
export function growBox(
	m: ArrayLike<number>,
	low: ArrayLike<number>,
	high: ArrayLike<number>,
	min: number[],
	max: number[],
): void {
	for (let corner = 0; corner < 8; corner++) {
		const x = corner & 1 ? (high[0] as number) : (low[0] as number);
		const y = corner & 2 ? (high[1] as number) : (low[1] as number);
		const z = corner & 4 ? (high[2] as number) : (low[2] as number);
		for (let r = 0; r < 3; r++) {
			const v =
				(m[r * 4] as number) * x +
				(m[r * 4 + 1] as number) * y +
				(m[r * 4 + 2] as number) * z +
				(m[r * 4 + 3] as number);
			if (v < (min[r] as number)) min[r] = v;
			if (v > (max[r] as number)) max[r] = v;
		}
	}
}

/**
 * Splits a 3 × 4 matrix by rows into position, rotation and scale, the 10 numbers a template node
 * or a skeleton joint takes, as three.js's `decompose` does.
 */
export function decomposeAffine(m: ArrayLike<number>, out = new Float32Array(10)): Float32Array {
	const e = (r: number, c: number) => m[r * 4 + c] as number;
	decomposeColumns(
		[
			e(0, 0),
			e(1, 0),
			e(2, 0),
			0,
			e(0, 1),
			e(1, 1),
			e(2, 1),
			0,
			e(0, 2),
			e(1, 2),
			e(2, 2),
			0,
			e(0, 3),
			e(1, 3),
			e(2, 3),
			1,
		],
		out,
	);
	return out;
}

/** Splits a matrix of 16 numbers, column by column, into position, rotation and scale, as three.js does. */
export function decomposeColumns(m: readonly number[], out: Float32Array): void {
	const [m11, m21, m31, , m12, m22, m32, , m13, m23, m33, , tx, ty, tz] = m as number[];
	let sx = Math.hypot(m11 as number, m21 as number, m31 as number);
	const sy = Math.hypot(m12 as number, m22 as number, m32 as number);
	const sz = Math.hypot(m13 as number, m23 as number, m33 as number);
	const det =
		(m11 as number) * ((m22 as number) * (m33 as number) - (m23 as number) * (m32 as number)) -
		(m12 as number) * ((m21 as number) * (m33 as number) - (m23 as number) * (m31 as number)) +
		(m13 as number) * ((m21 as number) * (m32 as number) - (m22 as number) * (m31 as number));
	if (det < 0) sx = -sx;
	out.set([tx as number, ty as number, tz as number], 0);
	out.set([sx, sy, sz], 7);
	if (sx === 0 || sy === 0 || sz === 0) return;
	const r11 = (m11 as number) / sx;
	const r21 = (m21 as number) / sx;
	const r31 = (m31 as number) / sx;
	const r12 = (m12 as number) / sy;
	const r22 = (m22 as number) / sy;
	const r32 = (m32 as number) / sy;
	const r13 = (m13 as number) / sz;
	const r23 = (m23 as number) / sz;
	const r33 = (m33 as number) / sz;
	const trace = r11 + r22 + r33;
	let q: [number, number, number, number];
	if (trace > 0) {
		const s = 0.5 / Math.sqrt(trace + 1);
		q = [(r32 - r23) * s, (r13 - r31) * s, (r21 - r12) * s, 0.25 / s];
	} else if (r11 > r22 && r11 > r33) {
		const s = 2 * Math.sqrt(1 + r11 - r22 - r33);
		q = [0.25 * s, (r12 + r21) / s, (r13 + r31) / s, (r32 - r23) / s];
	} else if (r22 > r33) {
		const s = 2 * Math.sqrt(1 + r22 - r11 - r33);
		q = [(r12 + r21) / s, 0.25 * s, (r23 + r32) / s, (r13 - r31) / s];
	} else {
		const s = 2 * Math.sqrt(1 + r33 - r11 - r22);
		q = [(r13 + r31) / s, (r23 + r32) / s, 0.25 * s, (r21 - r12) / s];
	}
	out.set(q, 3);
}
