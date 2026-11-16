// Deterministic transcendental functions, vectors and quaternions for the plant core. `Math.sin` and
// its kin may differ in the last bit between script engines, so a plant grown with them would differ
// between Bun, Chrome, Safari and Firefox. These functions use only the four operations and
// `Math.sqrt`, which the standard rounds exactly, and `Math.round`, `Math.floor` and `Math.abs`,
// which are exact. Every value that reaches geometry comes from them, so a plant's bytes are the same
// on every engine.
//
// Each function reduces its argument to a small range and sums a Taylor series there, far enough
// that the error stays near the last bit of a double. Accuracy holds for arguments up to about a
// million radians; beyond that the reduction loses bits, but the result stays the same everywhere.

/** A double from its two 32-bit halves, so a constant has exactly the bits it names. */
function fromBits(high: number, low: number): number {
	const view = new DataView(new ArrayBuffer(8));
	view.setUint32(0, high >>> 0);
	view.setUint32(4, low >>> 0);
	return view.getFloat64(0);
}

/** One scratch view for reading and writing a double's bits. */
const BITS = new DataView(new ArrayBuffer(8));

/**
 * Pi.
 *
 * @category api/vegetation
 */
export const PI = Math.PI;
const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
/** Pi over two in two parts: the first has 33 bits, so a whole multiple of it up to 2^20 is exact. */
const PIO2_HI = fromBits(0x3ff921fb, 0x54400000);
const PIO2_LO = fromBits(0x3dd0b461, 0x1a626331);
/** The natural log of two in two parts, the first with its low bits clear. */
const LN2_HI = fromBits(0x3fe62e42, 0xfee00000);
const LN2_LO = fromBits(0x3dea39ef, 0x35793c76);
const LN2 = Math.LN2;
const SQRT2 = Math.SQRT2;

/** Inverse factorials and odd reciprocals, made once with exact division. */
function factorialSeries(first: number, count: number, step: number): number[] {
	const out: number[] = [];
	let factorial = 1;
	let n = 1;
	for (let i = 0; i < first + count * step; i++) {
		factorial *= n;
		n++;
		if (i + 1 >= first && (i + 1 - first) % step === 0 && out.length < count) out.push(factorial);
	}
	return out;
}
/** 3!, 5!, ... 17! for sine. */
const SIN_DIVISORS = factorialSeries(3, 8, 2);
/** 2!, 4!, ... 18! for cosine. */
const COS_DIVISORS = factorialSeries(2, 9, 2);
/** 2!, 3!, ... 14! for the exponential. */
const EXP_DIVISORS = factorialSeries(2, 13, 1);

/** Sine of `r` in [-pi/4, pi/4]. */
function sinKernel(r: number): number {
	const z = r * r;
	let sum = 0;
	for (let i = SIN_DIVISORS.length - 1; i >= 0; i--) {
		const term = (i % 2 === 0 ? -1 : 1) / (SIN_DIVISORS[i] as number);
		sum = term + z * sum;
	}
	return r + r * z * sum;
}

/** Cosine of `r` in [-pi/4, pi/4]. */
function cosKernel(r: number): number {
	const z = r * r;
	let sum = 0;
	for (let i = COS_DIVISORS.length - 1; i >= 0; i--) {
		const term = (i % 2 === 0 ? -1 : 1) / (COS_DIVISORS[i] as number);
		sum = term + z * sum;
	}
	return 1 + z * sum;
}

/** The quadrant of `x` and its remainder in [-pi/4, pi/4], written into `reduced`. */
const reduced = { quadrant: 0, rest: 0 };
function reduce(x: number): void {
	const k = Math.round(x / HALF_PI);
	reduced.rest = x - k * PIO2_HI - k * PIO2_LO;
	reduced.quadrant = ((k % 4) + 4) % 4;
}

/**
 * The sine of `x` in radians, the same on every script engine.
 *
 * @param x The angle in radians.
 * @returns Its sine.
 * @category api/vegetation
 */
export function sin(x: number): number {
	if (!Number.isFinite(x)) return Number.NaN;
	if (Math.abs(x) <= QUARTER_PI) return sinKernel(x);
	reduce(x);
	const r = reduced.rest;
	switch (reduced.quadrant) {
		case 0:
			return sinKernel(r);
		case 1:
			return cosKernel(r);
		case 2:
			return -sinKernel(r);
		default:
			return -cosKernel(r);
	}
}

/**
 * The cosine of `x` in radians, the same on every script engine.
 *
 * @param x The angle in radians.
 * @returns Its cosine.
 * @category api/vegetation
 */
export function cos(x: number): number {
	if (!Number.isFinite(x)) return Number.NaN;
	if (Math.abs(x) <= QUARTER_PI) return cosKernel(x);
	reduce(x);
	const r = reduced.rest;
	switch (reduced.quadrant) {
		case 0:
			return cosKernel(r);
		case 1:
			return -sinKernel(r);
		case 2:
			return -cosKernel(r);
		default:
			return sinKernel(r);
	}
}

/**
 * The tangent of `x` in radians, the same on every script engine.
 *
 * @param x The angle in radians.
 * @returns Its tangent.
 * @category api/vegetation
 */
export function tan(x: number): number {
	return sin(x) / cos(x);
}

/** Two to the whole power `k`, from its bits, for `k` from -1022 to 1023. */
function pow2(k: number): number {
	BITS.setUint32(0, ((k + 1023) << 20) >>> 0);
	BITS.setUint32(4, 0);
	return BITS.getFloat64(0);
}

/** `value` times two to the whole power `k`, in steps that stay normal. */
function scaleBy2(value: number, k: number): number {
	let v = value;
	let e = k;
	while (e > 1023) {
		v *= pow2(1023);
		e -= 1023;
	}
	while (e < -1022) {
		v *= pow2(-1022);
		e += 1022;
	}
	return v * pow2(e);
}

/**
 * e to the power `x`, the same on every script engine.
 *
 * @param x The exponent.
 * @returns e to the power `x`.
 * @category api/vegetation
 */
export function exp(x: number): number {
	if (Number.isNaN(x)) return Number.NaN;
	if (x > 709.782712893384) return Number.POSITIVE_INFINITY;
	if (x < -745.1332191019412) return 0;
	const k = Math.round(x / LN2);
	const r = x - k * LN2_HI - k * LN2_LO;
	let sum = 0;
	for (let i = EXP_DIVISORS.length - 1; i >= 0; i--)
		sum = 1 / (EXP_DIVISORS[i] as number) + r * sum;
	const value = 1 + r + r * r * sum;
	return k === 0 ? value : scaleBy2(value, k);
}

/**
 * The natural logarithm of `x`, the same on every script engine.
 *
 * @param x A positive number.
 * @returns Its natural logarithm; minus infinity at 0, and NaN below it.
 * @category api/vegetation
 */
export function log(x: number): number {
	if (Number.isNaN(x) || x < 0) return Number.NaN;
	if (x === 0) return Number.NEGATIVE_INFINITY;
	if (x === Number.POSITIVE_INFINITY) return x;
	let value = x;
	let e = 0;
	if (value < 2.2250738585072014e-308) {
		value *= pow2(54);
		e -= 54;
	}
	BITS.setFloat64(0, value);
	const high = BITS.getUint32(0);
	e += ((high >>> 20) & 0x7ff) - 1023;
	BITS.setUint32(0, ((high & 0x800fffff) | 0x3ff00000) >>> 0);
	let m = BITS.getFloat64(0);
	if (m > SQRT2) {
		m /= 2;
		e += 1;
	}
	const s = (m - 1) / (m + 1);
	const z = s * s;
	let sum = 0;
	for (let n = 23; n >= 3; n -= 2) sum = 1 / n + z * sum;
	const logM = 2 * s + 2 * s * z * sum;
	return e * LN2_HI + (logM + e * LN2_LO);
}

/**
 * `x` to the power `y`, the same on every script engine. A negative `x` takes only a whole `y`.
 *
 * @param x The base.
 * @param y The exponent.
 * @returns `x` to the power `y`.
 * @category api/vegetation
 */
export function pow(x: number, y: number): number {
	if (y === 0 || x === 1) return 1;
	if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
	if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
	if (x > 0) return exp(y * log(x));
	if (Math.floor(y) !== y) return Number.NaN;
	const magnitude = exp(y * log(-x));
	return Math.abs(y % 2) === 1 ? -magnitude : magnitude;
}

/** Arctangent of `t` in [0, 1]: two halvings of the angle, then the series. */
function atanUnit(t: number): number {
	const once = t / (1 + Math.sqrt(1 + t * t));
	const twice = once / (1 + Math.sqrt(1 + once * once));
	const z = twice * twice;
	let sum = 0;
	for (let n = 25; n >= 3; n -= 2) sum = (((n - 1) / 2) % 2 === 0 ? 1 : -1) / n + z * sum;
	return 4 * (twice + twice * z * sum);
}

/**
 * The arctangent of `x` in radians, the same on every script engine.
 *
 * @param x The tangent.
 * @returns The angle, from -pi/2 to pi/2.
 * @category api/vegetation
 */
export function atan(x: number): number {
	if (Number.isNaN(x)) return Number.NaN;
	const t = Math.abs(x);
	const angle = t <= 1 ? atanUnit(t) : HALF_PI - atanUnit(1 / t);
	return x < 0 ? -angle : angle;
}

/**
 * The angle of the point (x, y) from the +x axis, in radians, the same on every script engine.
 *
 * @param y The point's y.
 * @param x The point's x.
 * @returns The angle, from -pi to pi.
 * @category api/vegetation
 */
export function atan2(y: number, x: number): number {
	if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
	if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
	const angle = atan(y / x);
	if (x > 0) return angle;
	return y >= 0 ? angle + PI : angle - PI;
}

/**
 * The arcsine of `x`, the same on every script engine.
 *
 * @param x A sine, from -1 to 1.
 * @returns The angle, from -pi/2 to pi/2.
 * @category api/vegetation
 */
export function asin(x: number): number {
	return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

/**
 * The arccosine of `x`, the same on every script engine.
 *
 * @param x A cosine, from -1 to 1.
 * @returns The angle, from 0 to pi.
 * @category api/vegetation
 */
export function acos(x: number): number {
	return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

/**
 * Degrees in radians.
 *
 * @param degrees An angle in degrees.
 * @returns The angle in radians.
 * @category api/vegetation
 */
export function radians(degrees: number): number {
	return (degrees * PI) / 180;
}

/**
 * A mutable three-number vector, for the setup code that grows and meshes plants.
 *
 * @category api/vegetation
 */
export type Vector3 = [number, number, number];

/**
 * The length of a vector.
 *
 * @param x The vector's x.
 * @param y The vector's y.
 * @param z The vector's z.
 * @returns Its length.
 * @category api/vegetation
 */
export function length3(x: number, y: number, z: number): number {
	return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Scales a vector to unit length in place; a zero vector becomes +Y.
 *
 * @param v The vector.
 * @returns The same vector.
 * @category api/vegetation
 */
export function normalize3(v: Vector3): Vector3 {
	const length = length3(v[0], v[1], v[2]);
	if (length === 0) {
		v[0] = 0;
		v[1] = 1;
		v[2] = 0;
		return v;
	}
	v[0] /= length;
	v[1] /= length;
	v[2] /= length;
	return v;
}

/**
 * The cross product of two vectors.
 *
 * @param a The first vector.
 * @param b The second vector.
 * @param out The vector to write; it may be `a` or `b`.
 * @returns `out`.
 * @category api/vegetation
 */
export function cross3(a: Readonly<Vector3>, b: Readonly<Vector3>, out: Vector3): Vector3 {
	const x = a[1] * b[2] - a[2] * b[1];
	const y = a[2] * b[0] - a[0] * b[2];
	const z = a[0] * b[1] - a[1] * b[0];
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

/**
 * Writes the unit quaternion that turns by `angle` radians about a unit axis, as x, y, z, w.
 *
 * @param axis The unit axis.
 * @param angle The angle in radians.
 * @param out The array to write.
 * @param offset Where in `out` to write.
 * @category api/vegetation
 */
export function quatAxisAngle(
	axis: Readonly<Vector3>,
	angle: number,
	out: Float32Array | number[],
	offset = 0,
): void {
	const half = angle / 2;
	const s = sin(half);
	out[offset] = axis[0] * s;
	out[offset + 1] = axis[1] * s;
	out[offset + 2] = axis[2] * s;
	out[offset + 3] = cos(half);
}

/**
 * Writes the unit quaternion of a frame whose +Y is `up` and whose +Z lies toward `toward`, as x, y,
 * z, w. A bud site's frame uses it: +Y the shoot's direction, +Z the side toward the sky.
 *
 * @param up The frame's +Y, a unit vector.
 * @param toward A direction that +Z leans toward; any vector not along `up`.
 * @param out The array to write.
 * @param offset Where in `out` to write.
 * @category api/vegetation
 */
export function quatFromFrame(
	up: Readonly<Vector3>,
	toward: Readonly<Vector3>,
	out: Float32Array | number[],
	offset = 0,
): void {
	const x = cross3(up, toward, [0, 0, 0]);
	if (length3(x[0], x[1], x[2]) < 1e-9) {
		cross3(up, Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], x);
	}
	normalize3(x);
	const z = cross3(x, up, [0, 0, 0]);
	// The rotation's columns are x, up and z.
	const m00 = x[0];
	const m11 = up[1];
	const m22 = z[2];
	const trace = m00 + m11 + m22;
	let qx: number;
	let qy: number;
	let qz: number;
	let qw: number;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		qw = s / 4;
		qx = (up[2] - z[1]) / s;
		qy = (z[0] - x[2]) / s;
		qz = (x[1] - up[0]) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		qw = (up[2] - z[1]) / s;
		qx = s / 4;
		qy = (up[0] + x[1]) / s;
		qz = (z[0] + x[2]) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		qw = (z[0] - x[2]) / s;
		qx = (up[0] + x[1]) / s;
		qy = s / 4;
		qz = (z[1] + up[2]) / s;
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		qw = (x[1] - up[0]) / s;
		qx = (z[0] + x[2]) / s;
		qy = (z[1] + up[2]) / s;
		qz = s / 4;
	}
	out[offset] = qx;
	out[offset + 1] = qy;
	out[offset + 2] = qz;
	out[offset + 3] = qw;
}

/**
 * Turns a vector by a unit quaternion.
 *
 * @param q The quaternion's array.
 * @param offset Where the quaternion starts in `q`, as x, y, z, w.
 * @param v The vector.
 * @param out The vector to write; it may be `v`.
 * @returns `out`.
 * @category api/vegetation
 */
export function quatRotate(
	q: ArrayLike<number>,
	offset: number,
	v: Readonly<Vector3>,
	out: Vector3,
): Vector3 {
	const qx = q[offset] as number;
	const qy = q[offset + 1] as number;
	const qz = q[offset + 2] as number;
	const qw = q[offset + 3] as number;
	// t = 2 q.xyz x v; v' = v + w t + q.xyz x t
	const tx = 2 * (qy * v[2] - qz * v[1]);
	const ty = 2 * (qz * v[0] - qx * v[2]);
	const tz = 2 * (qx * v[1] - qy * v[0]);
	const x = v[0] + qw * tx + (qy * tz - qz * ty);
	const y = v[1] + qw * ty + (qz * tx - qx * tz);
	const z = v[2] + qw * tz + (qx * ty - qy * tx);
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

/**
 * The product of two quaternions: `a` after `b`.
 *
 * @param a The first quaternion's array.
 * @param ao Where it starts in `a`.
 * @param b The second quaternion's array.
 * @param bo Where it starts in `b`.
 * @param out The array to write.
 * @param offset Where in `out` to write.
 * @category api/vegetation
 */
export function quatMultiply(
	a: ArrayLike<number>,
	ao: number,
	b: ArrayLike<number>,
	bo: number,
	out: Float32Array | number[],
	offset = 0,
): void {
	const ax = a[ao] as number;
	const ay = a[ao + 1] as number;
	const az = a[ao + 2] as number;
	const aw = a[ao + 3] as number;
	const bx = b[bo] as number;
	const by = b[bo + 1] as number;
	const bz = b[bo + 2] as number;
	const bw = b[bo + 3] as number;
	out[offset] = aw * bx + ax * bw + ay * bz - az * by;
	out[offset + 1] = aw * by - ax * bz + ay * bw + az * bx;
	out[offset + 2] = aw * bz + ax * by - ay * bx + az * bw;
	out[offset + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
