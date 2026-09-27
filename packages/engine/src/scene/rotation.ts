// Rotations as quaternions (x, y, z, w), computed into output arrays so hot paths allocate
// nothing. The formulas and axis-order names are three.js's.

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

type Out = { [index: number]: number };

/** The quaternion of Euler angles in radians, applied in three.js's order convention. */
export function quaternionFromEuler(
	out: Out,
	x: number,
	y: number,
	z: number,
	order: EulerOrder = 'XYZ',
): void {
	const c1 = Math.cos(x / 2);
	const c2 = Math.cos(y / 2);
	const c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2);
	const s2 = Math.sin(y / 2);
	const s3 = Math.sin(z / 2);
	// Each order differs only in the signs of the cross terms.
	const signs: Record<EulerOrder, [number, number, number, number]> = {
		XYZ: [1, -1, 1, -1],
		YXZ: [1, -1, -1, 1],
		ZXY: [-1, 1, 1, -1],
		ZYX: [-1, 1, -1, 1],
		YZX: [1, 1, -1, -1],
		XZY: [-1, -1, 1, 1],
	};
	const [sx, sy, sz, sw] = signs[order];
	out[0] = s1 * c2 * c3 + sx * c1 * s2 * s3;
	out[1] = c1 * s2 * c3 + sy * s1 * c2 * s3;
	out[2] = c1 * c2 * s3 + sz * s1 * s2 * c3;
	out[3] = c1 * c2 * c3 + sw * s1 * s2 * s3;
}

const axisX = new Float64Array(3);
const axisY = new Float64Array(3);
const axisZ = new Float64Array(3);

function normalize(v: Float64Array): number {
	const length = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
	if (length > 0) for (let i = 0; i < 3; i++) v[i] = (v[i] as number) / length;
	return length;
}

function cross(out: Float64Array, a: Float64Array, b: Float64Array): void {
	const [ax, ay, az] = a as unknown as [number, number, number];
	const [bx, by, bz] = b as unknown as [number, number, number];
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
}

/**
 * The rotation that turns an object at `eye` toward `target`, with +Y up, as three.js's
 * `lookAt`: cameras and lights point their -Z axis at the target, other objects their +Z axis.
 */
export function quaternionLookAt(
	out: Out,
	eye: ArrayLike<number>,
	target: ArrayLike<number>,
	minusZForward: boolean,
): void {
	// The object's Z axis: from the target to the eye for -Z forward, the other way otherwise.
	const sign = minusZForward ? 1 : -1;
	for (let i = 0; i < 3; i++) axisZ[i] = sign * ((eye[i] as number) - (target[i] as number));
	if (normalize(axisZ) === 0) axisZ.set([0, 0, 1]);
	axisY.set([0, 1, 0]);
	cross(axisX, axisY, axisZ);
	if (normalize(axisX) === 0) {
		// The view runs along the up axis: tilt it slightly, as three.js does.
		const k = Math.abs(axisY[2] as number) === 1 ? 0 : 2;
		axisZ[k] = (axisZ[k] as number) + 0.0001;
		normalize(axisZ);
		cross(axisX, axisY, axisZ);
		normalize(axisX);
	}
	cross(axisY, axisZ, axisX);
	quaternionFromAxes(out, axisX, axisY, axisZ);
}

/** The quaternion of a rotation matrix given by its three column axes. */
function quaternionFromAxes(out: Out, x: Float64Array, y: Float64Array, z: Float64Array): void {
	const [m11, m21, m31] = x as unknown as [number, number, number];
	const [m12, m22, m32] = y as unknown as [number, number, number];
	const [m13, m23, m33] = z as unknown as [number, number, number];
	const trace = m11 + m22 + m33;
	if (trace > 0) {
		const s = 0.5 / Math.sqrt(trace + 1);
		out[3] = 0.25 / s;
		out[0] = (m32 - m23) * s;
		out[1] = (m13 - m31) * s;
		out[2] = (m21 - m12) * s;
	} else if (m11 > m22 && m11 > m33) {
		const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
		out[3] = (m32 - m23) / s;
		out[0] = 0.25 * s;
		out[1] = (m12 + m21) / s;
		out[2] = (m13 + m31) / s;
	} else if (m22 > m33) {
		const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
		out[3] = (m13 - m31) / s;
		out[0] = (m12 + m21) / s;
		out[1] = 0.25 * s;
		out[2] = (m23 + m32) / s;
	} else {
		const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
		out[3] = (m21 - m12) / s;
		out[0] = (m13 + m31) / s;
		out[1] = (m23 + m32) / s;
		out[2] = 0.25 * s;
	}
}
