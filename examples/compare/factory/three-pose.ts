// Factory's world transforms for the three.js half, in closed form. An arm turns about the vertical
// and then tips its joints about one side axis, so each part's rotation is yaw(ψ) · pitch(θ), with θ
// the sum of the joint pitches up to that part. This file has no three.js import, so a test checks
// it against the parent-first walk of the arm's tree that null3D's engine does.

import {
	BASE_HEIGHT,
	CRATE_IN_WRIST,
	CRATES_PER_CELL,
	CrateParent,
	crateTransform,
	type FactoryState,
	FORE_LENGTH,
	GRIP_POINT,
	JOINTS,
	TURNTABLE_HEIGHT,
	UPPER_LENGTH,
	WRIST_LENGTH,
} from './scene';

/**
 * Writes a transform matrix in three.js's order, column after column, from a rotation given as its
 * three columns (x axis, y axis, z axis) and a position.
 */
export function writeMatrix(
	out: Float32Array,
	offset: number,
	xx: number,
	xy: number,
	xz: number,
	yx: number,
	yy: number,
	yz: number,
	zx: number,
	zy: number,
	zz: number,
	px: number,
	py: number,
	pz: number,
): void {
	out[offset] = xx;
	out[offset + 1] = xy;
	out[offset + 2] = xz;
	out[offset + 3] = 0;
	out[offset + 4] = yx;
	out[offset + 5] = yy;
	out[offset + 6] = yz;
	out[offset + 7] = 0;
	out[offset + 8] = zx;
	out[offset + 9] = zy;
	out[offset + 10] = zz;
	out[offset + 11] = 0;
	out[offset + 12] = px;
	out[offset + 13] = py;
	out[offset + 14] = pz;
	out[offset + 15] = 1;
}

/** Writes a matrix from a quaternion (x, y, z, w), a position and an even scale. */
export function writeQuaternionMatrix(
	out: Float32Array,
	offset: number,
	x: number,
	y: number,
	z: number,
	w: number,
	px: number,
	py: number,
	pz: number,
	scale = 1,
): void {
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
	writeMatrix(
		out,
		offset,
		(1 - (yy + zz)) * scale,
		(xy + wz) * scale,
		(xz - wy) * scale,
		(xy - wz) * scale,
		(1 - (xx + zz)) * scale,
		(yz + wx) * scale,
		(xz + wy) * scale,
		(yz - wx) * scale,
		(1 - (xx + yy)) * scale,
		px,
		py,
		pz,
	);
}

const SHOULDER = BASE_HEIGHT + TURNTABLE_HEIGHT;

/** The matrix arrays of the moving batches: one matrix per copy, 16 floats each. */
export interface FactoryMatrices {
	turntable: Float32Array;
	upperArm: Float32Array;
	forearm: Float32Array;
	wrist: Float32Array;
	/** Two per cell: left, then right. */
	finger: Float32Array;
	/** CRATES_PER_CELL per cell. */
	crate: Float32Array;
}

const position = new Float64Array(3);
const rotation = new Float64Array(4);
const q0 = CRATE_IN_WRIST[0] as number;
const q1 = CRATE_IN_WRIST[1] as number;
const q2 = CRATE_IN_WRIST[2] as number;
const q3 = CRATE_IN_WRIST[3] as number;

/** Writes the world matrices of every moving part of the first `cells` cells. Allocates nothing. */
export function poseFactory(state: FactoryState, cells: number, out: FactoryMatrices): void {
	const joints = state.joints;
	for (let c = 0; c < cells; c++) {
		const j = c * JOINTS;
		const yaw = joints[j] as number;
		const t1 = joints[j + 1] as number;
		const t2 = t1 + (joints[j + 2] as number);
		const t3 = t2 + (joints[j + 3] as number);
		const grip = joints[j + 4] as number;
		const sy = Math.sin(yaw);
		const cy = Math.cos(yaw);
		const s1 = Math.sin(t1);
		const c1 = Math.cos(t1);
		const s2 = Math.sin(t2);
		const c2 = Math.cos(t2);
		const s3 = Math.sin(t3);
		const c3 = Math.cos(t3);
		const ox = state.origin[c * 2] as number;
		const oz = state.origin[c * 2 + 1] as number;
		const m = c * 16;
		// Columns of yaw(ψ) · pitch(θ): x = (cψ, 0, -sψ), y = (sψ sθ, cθ, cψ sθ), z = (sψ cθ, -sθ, cψ cθ).
		writeMatrix(out.turntable, m, cy, 0, -sy, 0, 1, 0, sy, 0, cy, ox, BASE_HEIGHT, oz);
		writeMatrix(
			out.upperArm,
			m,
			cy,
			0,
			-sy,
			sy * s1,
			c1,
			cy * s1,
			sy * c1,
			-s1,
			cy * c1,
			ox,
			SHOULDER,
			oz,
		);
		const ex = ox + UPPER_LENGTH * sy * s1;
		const ey = SHOULDER + UPPER_LENGTH * c1;
		const ez = oz + UPPER_LENGTH * cy * s1;
		writeMatrix(
			out.forearm,
			m,
			cy,
			0,
			-sy,
			sy * s2,
			c2,
			cy * s2,
			sy * c2,
			-s2,
			cy * c2,
			ex,
			ey,
			ez,
		);
		const wx = ex + FORE_LENGTH * sy * s2;
		const wy = ey + FORE_LENGTH * c2;
		const wz = ez + FORE_LENGTH * cy * s2;
		const yx = sy * s3;
		const yz = cy * s3;
		writeMatrix(out.wrist, m, cy, 0, -sy, yx, c3, yz, sy * c3, -s3, cy * c3, wx, wy, wz);
		// Fingers: along the wrist's x axis by ∓grip, and up its y axis to the wrist's end.
		const fx = wx + WRIST_LENGTH * yx;
		const fy = wy + WRIST_LENGTH * c3;
		const fz = wz + WRIST_LENGTH * yz;
		writeMatrix(
			out.finger,
			m * 2,
			cy,
			0,
			-sy,
			yx,
			c3,
			yz,
			sy * c3,
			-s3,
			cy * c3,
			fx - grip * cy,
			fy,
			fz + grip * sy,
		);
		writeMatrix(
			out.finger,
			m * 2 + 16,
			cy,
			0,
			-sy,
			yx,
			c3,
			yz,
			sy * c3,
			-s3,
			cy * c3,
			fx + grip * cy,
			fy,
			fz - grip * sy,
		);
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			const at = (c * CRATES_PER_CELL + k) * 16;
			if (crateTransform(state, c, k, position, rotation) === CrateParent.hall) {
				writeQuaternionMatrix(
					out.crate,
					at,
					rotation[0] as number,
					rotation[1] as number,
					rotation[2] as number,
					rotation[3] as number,
					position[0] as number,
					position[1] as number,
					position[2] as number,
				);
				continue;
			}
			// Held: the wrist's rotation yaw(ψ) · pitch(θ3) as a quaternion, times the crate's rotation in the wrist.
			const hy = Math.sin(yaw / 2);
			const hc = Math.cos(yaw / 2);
			const ps = Math.sin(t3 / 2);
			const pc = Math.cos(t3 / 2);
			const ax = hc * ps;
			const ay = hy * pc;
			const az = -hy * ps;
			const aw = hc * pc;
			writeQuaternionMatrix(
				out.crate,
				at,
				aw * q0 + ax * q3 + ay * q2 - az * q1,
				aw * q1 - ax * q2 + ay * q3 + az * q0,
				aw * q2 + ax * q1 - ay * q0 + az * q3,
				aw * q3 - ax * q0 - ay * q1 - az * q2,
				wx + GRIP_POINT * yx,
				wy + GRIP_POINT * c3,
				wz + GRIP_POINT * yz,
			);
		}
	}
}
