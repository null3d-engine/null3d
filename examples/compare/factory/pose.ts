// Factory's world transforms in closed form, for the instanced mode of both engines. An arm turns
// about the vertical and then tips its joints about one side axis, so each part's rotation is
// yaw(ψ) · pitch(θ), with θ the sum of the joint pitches up to that part. One loop works out every
// cell's turns and joint points, and each engine takes them in its own form: three.js as the world
// matrices of its InstancedMesh copies, null3D as the positions and quaternions of its batch rows.
// This file has no engine import, so a test checks both forms against the parent-first walk of the
// arm's tree.

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

/**
 * One cell's arm in closed form. `s` and `c` are the sine and cosine of a turn, `hs` and `hc` those
 * of half the turn, which a quaternion takes: the yaw, then the summed pitch of the upper arm (1),
 * the forearm (2) and the wrist (3). The points are the elbow (e) and the wrist joint (w) in the
 * world, and `grip` is each finger's distance from the wrist's middle.
 */
interface ArmPose {
	sy: number;
	cy: number;
	hsy: number;
	hcy: number;
	s1: number;
	c1: number;
	hs1: number;
	hc1: number;
	s2: number;
	c2: number;
	hs2: number;
	hc2: number;
	s3: number;
	c3: number;
	hs3: number;
	hc3: number;
	ox: number;
	oz: number;
	ex: number;
	ey: number;
	ez: number;
	wx: number;
	wy: number;
	wz: number;
	grip: number;
}

const arm: ArmPose = {
	sy: 0,
	cy: 1,
	hsy: 0,
	hcy: 1,
	s1: 0,
	c1: 1,
	hs1: 0,
	hc1: 1,
	s2: 0,
	c2: 1,
	hs2: 0,
	hc2: 1,
	s3: 0,
	c3: 1,
	hs3: 0,
	hc3: 1,
	ox: 0,
	oz: 0,
	ex: 0,
	ey: 0,
	ez: 0,
	wx: 0,
	wy: 0,
	wz: 0,
	grip: 0,
};

/** Works out cell c's arm into `arm`: four half-angle sines and cosines, and the joint points. */
function poseArm(state: FactoryState, c: number): void {
	const joints = state.joints;
	const j = c * JOINTS;
	const half1 = (joints[j + 1] as number) / 2;
	const half2 = half1 + (joints[j + 2] as number) / 2;
	const half3 = half2 + (joints[j + 3] as number) / 2;
	const hsy = Math.sin((joints[j] as number) / 2);
	const hcy = Math.cos((joints[j] as number) / 2);
	const hs1 = Math.sin(half1);
	const hc1 = Math.cos(half1);
	const hs2 = Math.sin(half2);
	const hc2 = Math.cos(half2);
	const hs3 = Math.sin(half3);
	const hc3 = Math.cos(half3);
	// The whole turns from the half ones: sin 2a = 2 sin a cos a, cos 2a = cos² a - sin² a.
	const sy = 2 * hsy * hcy;
	const cy = hcy * hcy - hsy * hsy;
	const s1 = 2 * hs1 * hc1;
	const c1 = hc1 * hc1 - hs1 * hs1;
	const s2 = 2 * hs2 * hc2;
	const c2 = hc2 * hc2 - hs2 * hs2;
	arm.sy = sy;
	arm.cy = cy;
	arm.hsy = hsy;
	arm.hcy = hcy;
	arm.s1 = s1;
	arm.c1 = c1;
	arm.hs1 = hs1;
	arm.hc1 = hc1;
	arm.s2 = s2;
	arm.c2 = c2;
	arm.hs2 = hs2;
	arm.hc2 = hc2;
	arm.s3 = 2 * hs3 * hc3;
	arm.c3 = hc3 * hc3 - hs3 * hs3;
	arm.hs3 = hs3;
	arm.hc3 = hc3;
	const ox = state.origin[c * 2] as number;
	const oz = state.origin[c * 2 + 1] as number;
	arm.ox = ox;
	arm.oz = oz;
	arm.ex = ox + UPPER_LENGTH * sy * s1;
	arm.ey = SHOULDER + UPPER_LENGTH * c1;
	arm.ez = oz + UPPER_LENGTH * cy * s1;
	arm.wx = arm.ex + FORE_LENGTH * sy * s2;
	arm.wy = arm.ey + FORE_LENGTH * c2;
	arm.wz = arm.ez + FORE_LENGTH * cy * s2;
	arm.grip = joints[j + 4] as number;
}

/** The matrix arrays of three.js's moving batches: one matrix per copy, 16 floats each. */
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
	for (let c = 0; c < cells; c++) {
		poseArm(state, c);
		const { sy, cy, s1, c1, s2, c2, s3, c3, ox, oz, ex, ey, ez, wx, wy, wz, grip } = arm;
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
			if (crateTransform(state, c, k, position, rotation) !== CrateParent.hall) heldCrate();
			writeQuaternionMatrix(
				out.crate,
				(c * CRATES_PER_CELL + k) * 16,
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
				position[0] as number,
				position[1] as number,
				position[2] as number,
			);
		}
	}
}

/**
 * Writes a held crate's world transform into the scratch position and rotation: the wrist's
 * rotation yaw(ψ) · pitch(θ3) as a quaternion times the crate's rotation in the wrist, at the grip
 * point along the wrist's y axis.
 */
function heldCrate(): void {
	const { hsy, hcy, hs3, hc3, s3, c3, sy, cy } = arm;
	const ax = hcy * hs3;
	const ay = hsy * hc3;
	const az = -hsy * hs3;
	const aw = hcy * hc3;
	rotation[0] = aw * q0 + ax * q3 + ay * q2 - az * q1;
	rotation[1] = aw * q1 - ax * q2 + ay * q3 + az * q0;
	rotation[2] = aw * q2 + ax * q1 - ay * q0 + az * q3;
	rotation[3] = aw * q3 - ax * q0 - ay * q1 - az * q2;
	position[0] = arm.wx + GRIP_POINT * sy * s3;
	position[1] = arm.wy + GRIP_POINT * c3;
	position[2] = arm.wz + GRIP_POINT * cy * s3;
}

/** The row arrays of one of null3D's batches: a position (3 floats) and a quaternion (4) per row. */
export interface Rows {
	positions: Float32Array;
	rotations: Float32Array;
}

/** The rows of null3D's moving batches, in the order of FactoryMatrices. */
export interface FactoryRows {
	turntable: Rows;
	upperArm: Rows;
	forearm: Rows;
	wrist: Rows;
	/** Two per cell: left, then right. */
	finger: Rows;
	/** CRATES_PER_CELL per cell. */
	crate: Rows;
}

function writeRow(
	rows: Rows,
	i: number,
	px: number,
	py: number,
	pz: number,
	qx: number,
	qy: number,
	qz: number,
	qw: number,
): void {
	const p = rows.positions;
	const q = rows.rotations;
	p[i * 3] = px;
	p[i * 3 + 1] = py;
	p[i * 3 + 2] = pz;
	q[i * 4] = qx;
	q[i * 4 + 1] = qy;
	q[i * 4 + 2] = qz;
	q[i * 4 + 3] = qw;
}

/** Writes the world rows of every moving part of the first `cells` cells. Allocates nothing. */
export function poseFactoryRows(state: FactoryState, cells: number, out: FactoryRows): void {
	for (let c = 0; c < cells; c++) {
		poseArm(state, c);
		const { sy, cy, hsy, hcy, hs1, hc1, hs2, hc2, hs3, hc3, s3, c3, ox, oz, wx, wy, wz, grip } =
			arm;
		// yaw(ψ) · pitch(θ) as a quaternion: (cos ψ/2 sin θ/2, sin ψ/2 cos θ/2, -sin ψ/2 sin θ/2, cos ψ/2 cos θ/2).
		writeRow(out.turntable, c, ox, BASE_HEIGHT, oz, 0, hsy, 0, hcy);
		writeRow(out.upperArm, c, ox, SHOULDER, oz, hcy * hs1, hsy * hc1, -hsy * hs1, hcy * hc1);
		writeRow(out.forearm, c, arm.ex, arm.ey, arm.ez, hcy * hs2, hsy * hc2, -hsy * hs2, hcy * hc2);
		const rx = hcy * hs3;
		const ry = hsy * hc3;
		const rz = -hsy * hs3;
		const rw = hcy * hc3;
		writeRow(out.wrist, c, wx, wy, wz, rx, ry, rz, rw);
		const fx = wx + WRIST_LENGTH * sy * s3;
		const fy = wy + WRIST_LENGTH * c3;
		const fz = wz + WRIST_LENGTH * cy * s3;
		writeRow(out.finger, c * 2, fx - grip * cy, fy, fz + grip * sy, rx, ry, rz, rw);
		writeRow(out.finger, c * 2 + 1, fx + grip * cy, fy, fz - grip * sy, rx, ry, rz, rw);
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			if (crateTransform(state, c, k, position, rotation) !== CrateParent.hall) heldCrate();
			writeRow(
				out.crate,
				c * CRATES_PER_CELL + k,
				position[0] as number,
				position[1] as number,
				position[2] as number,
				rotation[0] as number,
				rotation[1] as number,
				rotation[2] as number,
				rotation[3] as number,
			);
		}
	}
}
