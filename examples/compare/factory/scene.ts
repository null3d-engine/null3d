// Factory: robot cells on the floor of a hall. Each cell has a robot arm (a tree of seven parts, six
// of which move every frame), a belt that brings crates, a pallet where the arm puts them, a glowing
// floor line and a warning lamp. The count is the number of moving parts, and the scene adds whole
// cells of 10 moving parts. This module is the one description that both engines draw: the layout,
// the seeded simulation, the meshes, the surfaces, the lights and the camera. It imports no engine.
//
// The arms run a state machine with seeded random timing, and crates move from belt to gripper to
// pallet, so the motion depends on the state, not only on the time. Both engines step it in fixed
// steps of SIM_STEP, so they hold the same state at the same simulation time.

import {
	boxGeometry,
	type CameraLoop,
	cylinderGeometry,
	type GradeLook,
	type Hex,
	hash01,
	lerp,
	type MeshData,
	type OutArray,
	quatMultiply,
	quatPitch,
	quatYaw,
	SIM_STEP,
	type SurfaceKind,
	smoothstep,
	spiralCell,
	translated,
	triangleCount,
} from '../../lib/compare-scene';
import type { DeviceClass, RampPlan } from '../../lib/ramp';

export const FACTORY_SEED = 3;

// Layout.

/** Meters between the origins of neighbouring cells, along X and along Z. */
export const CELL_PITCH = 6;
export const CRATES_PER_CELL = 4;
/** Arm parts that move (turntable, upper arm, forearm, wrist, two fingers) plus the crates. */
export const MOVING_PER_CELL = 6 + CRATES_PER_CELL;
/** Parts that stand still: the arm's base, the belt, the pallet, the floor line and the lamp. */
export const STILL_PER_CELL = 5;
/** The spot lights over the middle of the hall, with their housings and glowing lenses. */
export const SPOT_COUNT = 6;
/** The hall's own objects: the floor, and a housing and a lens for each spot light. */
export const HALL_OBJECTS = 1 + 2 * SPOT_COUNT;
/** The most cells a scene can hold. */
export const MAX_CELLS = 20_000;

/** Cells for a count of moving parts: whole cells, at least one. */
export function factoryCells(movingParts: number): number {
	return Math.max(1, Math.min(MAX_CELLS, Math.ceil(movingParts / MOVING_PER_CELL)));
}

/** Objects in the scene for a count of moving parts. */
export function factoryObjects(movingParts: number): number {
	return factoryCells(movingParts) * (MOVING_PER_CELL + STILL_PER_CELL) + HALL_OBJECTS;
}

// The arm. Parts are listed parent first; each part's mesh has its pivot at its origin.

export const ARM_PART = {
	base: 0,
	turntable: 1,
	upperArm: 2,
	forearm: 3,
	wrist: 4,
	fingerLeft: 5,
	fingerRight: 6,
} as const;
export const ARM_PARTS = 7;
/** The parent of each part, or -1 for the base, whose parent is the hall. */
export const ARM_PARENT: readonly number[] = [-1, 0, 1, 2, 3, 4, 4];

export const BASE_HEIGHT = 0.4;
export const TURNTABLE_HEIGHT = 0.3;
export const UPPER_LENGTH = 1.6;
export const FORE_LENGTH = 1.4;
export const WRIST_LENGTH = 0.3;
export const FINGER_LENGTH = 0.34;
/** The grip point, where a held crate's center is, along the wrist's +Y. */
export const GRIP_POINT = 0.57;
export const CRATE_SIZE = 0.5;
const GRIP_OPEN = 0.4;
const GRIP_CLOSED = CRATE_SIZE / 2 + 0.035;
/** The shoulder's height above the floor. */
const SHOULDER_HEIGHT = BASE_HEIGHT + TURNTABLE_HEIGHT;

/** Joint poses: shoulder, elbow and wrist pitch in radians. */
const HOME_POSE = [0.15, 1.25, 1.2] as const;
const PICK_POSE = [0.45, 1.8, 0.8] as const;

/** The grip point's horizontal reach and height for a pose, from the arm's lengths. */
export function gripPointOf(pose: readonly [number, number, number]): {
	reach: number;
	height: number;
} {
	const a1 = pose[0];
	const a2 = a1 + pose[1];
	const a3 = a2 + pose[2];
	return {
		reach: UPPER_LENGTH * Math.sin(a1) + FORE_LENGTH * Math.sin(a2) + GRIP_POINT * Math.sin(a3),
		height:
			SHOULDER_HEIGHT +
			UPPER_LENGTH * Math.cos(a1) +
			FORE_LENGTH * Math.cos(a2) +
			GRIP_POINT * Math.cos(a3),
	};
}

const PICK = gripPointOf(PICK_POSE);
/** Distance from a cell's origin to the pick point on the belt (at -Z) and the drop point (at +Z). */
export const REACH = PICK.reach;
/** Height of a crate's center on the belt, in the gripper and on the pallet. */
export const CRATE_HEIGHT = PICK.height;
/** The wrist's pitch from vertical at the pick pose. */
const PICK_WRIST_PITCH = PICK_POSE[0] + PICK_POSE[1] + PICK_POSE[2];

/**
 * A held crate's rotation in the wrist's frame, chosen so the crate keeps the rotation it had on
 * the belt at the moment the arm grips it: the inverse of the wrist's world rotation at the pick
 * pose, yaw(π) × pitch(θ).
 */
export const CRATE_IN_WRIST: Float64Array = (() => {
	const pitch = new Float64Array(4);
	const yaw = new Float64Array(4);
	const out = new Float64Array(4);
	quatPitch(pitch, 0, -PICK_WRIST_PITCH);
	quatYaw(yaw, 0, -Math.PI);
	quatMultiply(out, 0, pitch, 0, yaw, 0);
	return out;
})();

// Belts: crates move along +X toward the pick point at (0, CRATE_HEIGHT, -REACH).

export const BELT_SPEED = 0.6;
/** How far upstream of the pick point a crate starts. */
export const BELT_START = 2.6;
/** The least distance between two crates on a belt. */
export const BELT_SPACING = 0.7;
/** Seconds a crate stays on the pallet before it goes back to the belt. */
export const PLACED_SECONDS = 4;

// Arm states, in the order an arm runs them.

export const ArmState = {
	wait: 0,
	reach: 1,
	grip: 2,
	lift: 3,
	turn: 4,
	lower: 5,
	release: 6,
	raise: 7,
	back: 8,
} as const;
const STATE_COUNT = 9;
/** Base seconds of each state; each arm scales them by 0.8 to 1.2 per cycle. The wait is a minimum. */
const STATE_SECONDS = [0.3, 1.0, 0.4, 0.8, 1.2, 0.8, 0.3, 0.8, 1.2] as const;

export const CrateState = { belt: 0, held: 1, placed: 2 } as const;

/** Joint values per cell: yaw, shoulder, elbow, wrist, grip. */
export const JOINTS = 5;

/** The simulation state of every cell, in flat arrays sized for the most cells. */
export interface FactoryState {
	/** Cells with state. The first `activeCells` of them move. */
	capacity: number;
	activeCells: number;
	/** Cell origins on the floor, two floats (x, z) per cell. */
	origin: Float32Array;
	armState: Uint8Array;
	armTime: Float32Array;
	armDuration: Float32Array;
	armCycle: Uint32Array;
	nextCrate: Uint8Array;
	/** Joint values, JOINTS floats per cell. */
	joints: Float32Array;
	crateState: Uint8Array;
	/** A belt crate's distance upstream of the pick point. */
	crateDistance: Float32Array;
	/** A placed crate's seconds left on the pallet. */
	crateTimer: Float32Array;
}

function durationOf(cell: number, cycle: number, state: number): number {
	return (
		(STATE_SECONDS[state] as number) *
		(0.8 + 0.4 * hash01(FACTORY_SEED, cell, cycle * STATE_COUNT + state))
	);
}

/** Makes the state of `capacity` cells, all waiting with crates on their belts. Setup code. */
export function createFactory(capacity: number): FactoryState {
	const cells = Math.max(1, Math.min(MAX_CELLS, capacity));
	const origin = new Float32Array(cells * 2);
	const grid = new Int32Array(2);
	for (let c = 0; c < cells; c++) {
		spiralCell(c, grid, 0);
		origin[c * 2] = (grid[0] as number) * CELL_PITCH;
		origin[c * 2 + 1] = (grid[1] as number) * CELL_PITCH;
	}
	const state: FactoryState = {
		capacity: cells,
		activeCells: cells,
		origin,
		armState: new Uint8Array(cells),
		armTime: new Float32Array(cells),
		armDuration: new Float32Array(cells),
		armCycle: new Uint32Array(cells),
		nextCrate: new Uint8Array(cells),
		joints: new Float32Array(cells * JOINTS),
		crateState: new Uint8Array(cells * CRATES_PER_CELL),
		crateDistance: new Float32Array(cells * CRATES_PER_CELL),
		crateTimer: new Float32Array(cells * CRATES_PER_CELL),
	};
	for (let c = 0; c < cells; c++) {
		state.armDuration[c] = durationOf(c, 0, ArmState.wait);
		const lead = 1.5 * hash01(FACTORY_SEED, c, -1);
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			state.crateDistance[c * CRATES_PER_CELL + k] = lead + k * BELT_SPACING;
		}
		writeJoints(state, c);
	}
	return state;
}

/** Sets how many cells move; the rest keep their state and are not drawn. */
export function setActiveCells(state: FactoryState, cells: number): void {
	state.activeCells = Math.max(1, Math.min(state.capacity, cells));
}

function writeJoints(state: FactoryState, c: number): void {
	const s = state.armState[c] as number;
	const t = smoothstep((state.armTime[c] as number) / (state.armDuration[c] as number));
	// Yaw: π faces the belt (-Z), 0 faces the pallet (+Z).
	let yaw = Math.PI;
	if (s === ArmState.turn) yaw = lerp(Math.PI, 0, t);
	else if (s >= ArmState.lower && s <= ArmState.raise) yaw = 0;
	else if (s === ArmState.back) yaw = lerp(0, Math.PI, t);
	// Pose: from home to pick and back.
	let toPick = 0;
	if (s === ArmState.reach || s === ArmState.lower) toPick = t;
	else if (s === ArmState.grip || s === ArmState.release) toPick = 1;
	else if (s === ArmState.lift || s === ArmState.raise) toPick = 1 - t;
	// Grip: open, closing, closed while carrying, opening.
	let closed = 0;
	if (s === ArmState.grip) closed = t;
	else if (s >= ArmState.lift && s <= ArmState.lower) closed = 1;
	else if (s === ArmState.release) closed = 1 - t;
	const j = c * JOINTS;
	state.joints[j] = yaw;
	state.joints[j + 1] = lerp(HOME_POSE[0], PICK_POSE[0], toPick);
	state.joints[j + 2] = lerp(HOME_POSE[1], PICK_POSE[1], toPick);
	state.joints[j + 3] = lerp(HOME_POSE[2], PICK_POSE[2], toPick);
	state.joints[j + 4] = lerp(GRIP_OPEN, GRIP_CLOSED, closed);
}

function nextState(state: FactoryState, c: number, s: number): void {
	const cycle = state.armCycle[c] as number;
	const crate = c * CRATES_PER_CELL + (state.nextCrate[c] as number);
	if (s === ArmState.grip) state.crateState[crate] = CrateState.held;
	if (s === ArmState.release) {
		state.crateState[crate] = CrateState.placed;
		state.crateTimer[crate] =
			PLACED_SECONDS * (0.75 + 0.5 * hash01(FACTORY_SEED, c, cycle * 31 + 7));
		state.nextCrate[c] = ((state.nextCrate[c] as number) + 1) % CRATES_PER_CELL;
	}
	let following = s + 1;
	let nextCycle = cycle;
	if (following === STATE_COUNT) {
		following = ArmState.wait;
		nextCycle = cycle + 1;
		state.armCycle[c] = nextCycle;
	}
	state.armState[c] = following;
	state.armTime[c] = 0;
	state.armDuration[c] = durationOf(c, nextCycle, following);
}

/** Runs one simulation step of SIM_STEP seconds for the active cells. Allocates nothing. */
export function stepFactory(state: FactoryState): void {
	const dt = SIM_STEP;
	for (let c = 0; c < state.activeCells; c++) {
		// Crates on the belt move toward the pick point and queue behind the next crate to pick.
		const next = state.nextCrate[c] as number;
		for (let k = 0; k < CRATES_PER_CELL; k++) {
			const i = c * CRATES_PER_CELL + k;
			const crateState = state.crateState[i] as number;
			if (crateState === CrateState.belt) {
				const rank = (k - next + CRATES_PER_CELL) % CRATES_PER_CELL;
				const d = (state.crateDistance[i] as number) - BELT_SPEED * dt;
				const least = rank * BELT_SPACING;
				state.crateDistance[i] = d < least ? least : d;
			} else if (crateState === CrateState.placed) {
				const left = (state.crateTimer[i] as number) - dt;
				if (left <= 0) {
					state.crateState[i] = CrateState.belt;
					state.crateDistance[i] = BELT_START;
					state.crateTimer[i] = 0;
				} else {
					state.crateTimer[i] = left;
				}
			}
		}
		// The arm.
		const s = state.armState[c] as number;
		const time = (state.armTime[c] as number) + dt;
		state.armTime[c] = time;
		if (time >= (state.armDuration[c] as number)) {
			if (s === ArmState.wait) {
				// Leave the wait only when the next crate is at the pick point.
				const i = c * CRATES_PER_CELL + next;
				if (state.crateState[i] === CrateState.belt && (state.crateDistance[i] as number) <= 1e-6) {
					nextState(state, c, s);
				} else {
					state.armTime[c] = state.armDuration[c] as number;
				}
			} else {
				nextState(state, c, s);
			}
		}
		writeJoints(state, c);
	}
}

// Transforms for the engines. Each writes a local position (3 floats) and rotation (4 floats).

/**
 * Writes an arm part's transform relative to its parent (ARM_PARENT). The base's transform is
 * relative to the hall: the cell's origin.
 */
export function armPartLocal(
	state: FactoryState,
	cell: number,
	part: number,
	outPosition: OutArray,
	outRotation: OutArray,
): void {
	const j = cell * JOINTS;
	let x = 0;
	let y = 0;
	let z = 0;
	outRotation[0] = 0;
	outRotation[1] = 0;
	outRotation[2] = 0;
	outRotation[3] = 1;
	switch (part) {
		case ARM_PART.base:
			x = state.origin[cell * 2] as number;
			z = state.origin[cell * 2 + 1] as number;
			break;
		case ARM_PART.turntable:
			y = BASE_HEIGHT;
			quatYaw(outRotation, 0, state.joints[j] as number);
			break;
		case ARM_PART.upperArm:
			y = TURNTABLE_HEIGHT;
			quatPitch(outRotation, 0, state.joints[j + 1] as number);
			break;
		case ARM_PART.forearm:
			y = UPPER_LENGTH;
			quatPitch(outRotation, 0, state.joints[j + 2] as number);
			break;
		case ARM_PART.wrist:
			y = FORE_LENGTH;
			quatPitch(outRotation, 0, state.joints[j + 3] as number);
			break;
		case ARM_PART.fingerLeft:
			x = -(state.joints[j + 4] as number);
			y = WRIST_LENGTH;
			break;
		case ARM_PART.fingerRight:
			x = state.joints[j + 4] as number;
			y = WRIST_LENGTH;
			break;
		default:
			throw new RangeError(`An arm has no part ${part}.`);
	}
	outPosition[0] = x;
	outPosition[1] = y;
	outPosition[2] = z;
}

/** A crate's parent: the hall (a world transform) or the wrist of its cell's arm. */
export const CrateParent = { hall: 0, wrist: 1 } as const;

/**
 * Writes crate k of a cell's transform and returns its parent. A held crate's transform is
 * relative to the wrist; the others are relative to the hall.
 */
export function crateTransform(
	state: FactoryState,
	cell: number,
	k: number,
	outPosition: OutArray,
	outRotation: OutArray,
): number {
	const i = cell * CRATES_PER_CELL + k;
	const crateState = state.crateState[i] as number;
	if (crateState === CrateState.held) {
		outPosition[0] = 0;
		outPosition[1] = GRIP_POINT;
		outPosition[2] = 0;
		for (let q = 0; q < 4; q++) outRotation[q] = CRATE_IN_WRIST[q] as number;
		return CrateParent.wrist;
	}
	const ox = state.origin[cell * 2] as number;
	const oz = state.origin[cell * 2 + 1] as number;
	outPosition[1] = CRATE_HEIGHT;
	if (crateState === CrateState.belt) {
		outPosition[0] = ox - (state.crateDistance[i] as number);
		outPosition[2] = oz - REACH;
		outRotation[0] = 0;
		outRotation[1] = 0;
		outRotation[2] = 0;
		outRotation[3] = 1;
	} else {
		outPosition[0] = ox;
		outPosition[2] = oz + REACH;
		quatYaw(outRotation, 0, Math.PI);
	}
	return CrateParent.hall;
}

/**
 * Writes the world position of a cell's grip point, where the arm holds a crate, from its joints in
 * closed form: the arm turns about the vertical and tips its joints about one side axis.
 */
export function gripWorld(state: FactoryState, cell: number, out: OutArray): void {
	const j = cell * JOINTS;
	const yaw = state.joints[j] as number;
	const t1 = state.joints[j + 1] as number;
	const t2 = t1 + (state.joints[j + 2] as number);
	const t3 = t2 + (state.joints[j + 3] as number);
	const reach =
		UPPER_LENGTH * Math.sin(t1) + FORE_LENGTH * Math.sin(t2) + GRIP_POINT * Math.sin(t3);
	out[0] = (state.origin[cell * 2] as number) + reach * Math.sin(yaw);
	out[1] =
		SHOULDER_HEIGHT +
		UPPER_LENGTH * Math.cos(t1) +
		FORE_LENGTH * Math.cos(t2) +
		GRIP_POINT * Math.cos(t3);
	out[2] = (state.origin[cell * 2 + 1] as number) + reach * Math.cos(yaw);
}

// Still parts of a cell, relative to the cell's origin: belt, pallet, a glowing floor line beyond
// the pallet, and a warning lamp on the arm's base.

export const BELT_HEIGHT = CRATE_HEIGHT - CRATE_SIZE / 2;
const LINE_OFFSET = 1.1;
export const STILL_PART = { belt: 0, pallet: 1, line: 2, lamp: 3 } as const;

/** Writes a still part's position relative to its cell's origin. */
export function stillPartLocal(part: number, out: OutArray): void {
	out[0] = 0;
	if (part === STILL_PART.belt) {
		out[1] = BELT_HEIGHT / 2;
		out[2] = -REACH;
	} else if (part === STILL_PART.pallet) {
		out[1] = BELT_HEIGHT / 2;
		out[2] = REACH;
	} else if (part === STILL_PART.line) {
		out[1] = 0.01;
		out[2] = REACH + LINE_OFFSET;
	} else {
		// The lamp stands on the base's rim, toward the belt's upstream end.
		out[0] = -0.38;
		out[1] = BASE_HEIGHT + 0.06;
		out[2] = -0.2;
	}
}

/** The floor's side in meters, covering every cell of a capacity with a margin of two cells. */
export function floorSide(capacity: number): number {
	const ring = Math.ceil((Math.sqrt(Math.max(1, capacity)) - 1) / 2);
	return (2 * ring + 5) * CELL_PITCH;
}

// Weld sparks: bursts from the grippers of the cells under the spot lights while they grip or let
// go of a crate.

/** The cells that throw sparks: the first nine of the spiral, the 3 x 3 cells under the spots. */
export const SPARK_CELLS = 9;
export const SPARKS_PER_CELL = 24;
export const SPARK_COUNT = SPARK_CELLS * SPARKS_PER_CELL;
/** Seconds a spark flies. */
const SPARK_LIFE = 0.45;
const GRAVITY = 9.8;
export const SPARK_SIZE = 0.035;

const sparkFrom = new Float64Array(3);

/**
 * Writes spark k's position at simulation time `seconds`, and returns true while it flies. A spark
 * flies while its cell's arm grips or lets go, along an arc from the grip point. Allocates nothing.
 */
export function sparkPosition(
	state: FactoryState,
	k: number,
	seconds: number,
	out: OutArray,
): boolean {
	const cell = Math.floor(k / SPARKS_PER_CELL);
	const s = state.armState[cell] as number;
	if (cell >= state.activeCells || (s !== ArmState.grip && s !== ArmState.release)) return false;
	const phase = hash01(FACTORY_SEED, k, 11);
	const cycle = seconds / SPARK_LIFE + phase;
	const born = Math.floor(cycle);
	const age = (cycle - born) * SPARK_LIFE;
	const angle = hash01(FACTORY_SEED, k, born) * 2 * Math.PI;
	const out1 = 0.6 + 1.6 * hash01(FACTORY_SEED, k, born + 1);
	const up = 1 + 2.2 * hash01(FACTORY_SEED, k, born + 2);
	gripWorld(state, cell, sparkFrom);
	const y = (sparkFrom[1] as number) + up * age - 0.5 * GRAVITY * age * age;
	out[0] = (sparkFrom[0] as number) + Math.cos(angle) * out1 * age;
	out[1] = y > SPARK_SIZE ? y : SPARK_SIZE;
	out[2] = (sparkFrom[2] as number) + Math.sin(angle) * out1 * age;
	return true;
}

/** The warning lamps' brightness at simulation time `seconds`: a slow pulse, as a beacon's. */
export function lampIntensity(seconds: number): number {
	const pulse = 0.5 + 0.5 * Math.sin(seconds * 2 * Math.PI * 0.8);
	return FACTORY_LOOK.lamp.intensity * (0.25 + 0.75 * pulse * pulse);
}

/** How far the belts' surface has run at simulation time `seconds`, in meters of the belt texture. */
export function beltOffset(seconds: number): number {
	return (seconds * BELT_SPEED) % 1;
}

// Meshes.

export type FactoryMesh =
	| 'base'
	| 'turntable'
	| 'upperArm'
	| 'forearm'
	| 'wrist'
	| 'finger'
	| 'crate'
	| 'belt'
	| 'pallet'
	| 'line'
	| 'lamp'
	| 'floor'
	| 'housing'
	| 'lens'
	| 'spark';

/** One mesh per kind of part. Setup code. */
export function factoryMeshes(capacity: number): Record<FactoryMesh, MeshData> {
	const floor = floorSide(capacity);
	return {
		base: translated(cylinderGeometry(0.5, BASE_HEIGHT, 24), 0, BASE_HEIGHT / 2, 0),
		turntable: translated(cylinderGeometry(0.42, TURNTABLE_HEIGHT, 24), 0, TURNTABLE_HEIGHT / 2, 0),
		upperArm: translated(boxGeometry(0.28, UPPER_LENGTH, 0.28), 0, UPPER_LENGTH / 2, 0),
		forearm: translated(boxGeometry(0.24, FORE_LENGTH, 0.24), 0, FORE_LENGTH / 2, 0),
		wrist: translated(boxGeometry(0.32, WRIST_LENGTH, 0.32), 0, WRIST_LENGTH / 2, 0),
		finger: translated(boxGeometry(0.07, FINGER_LENGTH, 0.16), 0, FINGER_LENGTH / 2, 0),
		crate: boxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
		belt: boxGeometry(CELL_PITCH, BELT_HEIGHT, 0.7),
		pallet: boxGeometry(1.0, BELT_HEIGHT, 1.0),
		line: boxGeometry(CELL_PITCH * 0.8, 0.02, 0.12),
		lamp: cylinderGeometry(0.06, 0.12, 12),
		floor: translated(boxGeometry(floor, 0.2, floor), 0, -0.1, 0),
		housing: translated(boxGeometry(0.9, 0.35, 0.9), 0, 0.175, 0),
		lens: boxGeometry(0.7, 0.02, 0.7),
		spark: boxGeometry(SPARK_SIZE, SPARK_SIZE, SPARK_SIZE),
	};
}

/** Triangles in the scene for a count of moving parts, before shadows and sparks. */
export function factoryTriangles(
	movingParts: number,
	meshes: Record<FactoryMesh, MeshData>,
): number {
	const perCell =
		triangleCount(meshes.base) +
		triangleCount(meshes.turntable) +
		triangleCount(meshes.upperArm) +
		triangleCount(meshes.forearm) +
		triangleCount(meshes.wrist) +
		2 * triangleCount(meshes.finger) +
		CRATES_PER_CELL * triangleCount(meshes.crate) +
		triangleCount(meshes.belt) +
		triangleCount(meshes.pallet) +
		triangleCount(meshes.line) +
		triangleCount(meshes.lamp);
	const hall =
		triangleCount(meshes.floor) +
		SPOT_COUNT * (triangleCount(meshes.housing) + triangleCount(meshes.lens));
	return factoryCells(movingParts) * perCell + hall;
}

// Surfaces. Each mesh takes a surface made in code, tinted by its color, or glows.

/** A mesh's surface: a surface kind tinted by `color`, or a glow of `emissive` times `intensity`. */
export interface FactoryMaterial {
	color: Hex;
	/** The surface whose maps the material takes, or none for a plain color. */
	surface?: SurfaceKind;
	/** Meters of the surface per meter of the mesh: above 1 repeats it more often. */
	repeat?: number;
	/** A plain surface's roughness and metalness, where it takes no maps. */
	roughness?: number;
	metalness?: number;
	/** A glowing surface: its light, which is above the bloom's threshold. */
	emissive?: Hex;
	emissiveIntensity?: number;
	/** True for parts that cast no shadow, such as the floor lines and the sparks. */
	noShadow?: boolean;
}

export const FACTORY_MATERIALS: Readonly<Record<FactoryMesh, FactoryMaterial>> = {
	base: { color: '#4a5058', surface: 'paint' },
	turntable: { color: '#f2a93b', surface: 'paint' },
	upperArm: { color: '#f2a93b', surface: 'paint' },
	forearm: { color: '#f2a93b', surface: 'paint' },
	wrist: { color: '#5c6470', surface: 'brushed' },
	finger: { color: '#c9d0d8', surface: 'brushed' },
	crate: { color: '#ffffff', surface: 'crate', repeat: 2 },
	belt: { color: '#ffffff', surface: 'rubber' },
	pallet: { color: '#8a7354', surface: 'crate' },
	line: {
		color: '#000000',
		roughness: 1,
		metalness: 0,
		emissive: '#ffcf6b',
		emissiveIntensity: 2.5,
		noShadow: true,
	},
	lamp: {
		color: '#200800',
		roughness: 0.3,
		metalness: 0,
		emissive: '#ff8a1c',
		emissiveIntensity: 6,
	},
	floor: { color: '#ffffff', surface: 'concrete', repeat: 0.5 },
	housing: { color: '#2b2f36', surface: 'brushed' },
	lens: {
		color: '#000000',
		roughness: 1,
		metalness: 0,
		emissive: '#fff1dc',
		emissiveIntensity: 8,
		noShadow: true,
	},
	spark: {
		color: '#000000',
		roughness: 1,
		metalness: 0,
		emissive: '#ffb347',
		emissiveIntensity: 30,
		noShadow: true,
	},
};

/** Texels on each side of each surface's maps. */
export const SURFACE_SIZE = 256;

// The look: lights, environment, fog, bloom, ambient occlusion, tone curve and grade.

/** The spot lights hang over the three lines of the middle, two over each, between the cells. */
const SPOT_HEIGHT = 7.5;
export const SPOT_POSITIONS: readonly (readonly [number, number, number])[] = [-1, 0, 1].flatMap(
	(line) =>
		[-1, 1].map((side) => [side * CELL_PITCH * 0.5, SPOT_HEIGHT, line * CELL_PITCH] as const),
);

export const FACTORY_LOOK = {
	background: '#141921' as Hex,
	camera: { fov: 55, near: 0.1, far: 600 },
	toneMapping: 'agx' as const,
	exposure: 1.1,
	ambient: { color: '#9fb4d6' as Hex, intensity: 0.12 },
	/** The built-in room environment, for the reflections of the metal. */
	environmentIntensity: 0.2,
	spot: {
		color: '#ffe2b8' as Hex,
		/** Candela, as three.js's spot lights since r155. */
		intensity: 420,
		angle: 0.62,
		penumbra: 0.55,
		range: 22,
		decay: 2,
		/** Texels on each side of each light's shadow map. */
		shadowSize: 1024,
		bias: 0.02,
		normalBias: 0.03,
	},
	lamp: { intensity: 6 },
	/** Height fog: exponential with distance, thinning with height above the floor. */
	fog: { color: '#141921' as Hex, density: 0.018, height: 0, heightFalloff: 0.12 },
	bloom: { threshold: 1, strength: 0.35, radius: 0.3 },
	ao: { radius: 0.6, intensity: 1, scale: 0.5 },
	/** A cool shadow and warm highlight grade with a little more contrast. */
	grade: {
		contrast: 1.08,
		saturation: 0.92,
		lift: [0.0, 0.01, 0.025],
		gamma: [1.0, 1.0, 1.04],
		gain: [1.04, 1.0, 0.94],
	} satisfies GradeLook,
} as const;

/** The camera circles the middle of the hall once a minute, with a slow rise and fall. */
export const FACTORY_CAMERA: CameraLoop = {
	seconds: 60,
	positions: [26, 12, 6, 4, 16, 26, -26, 11, 4, -4, 8, -24],
	targets: [0, 1.2, 0, 0, 1.2, 0, 0, 1.2, 0, 0, 1.2, 0],
};

// What the comparison page needs to know about the scene.

/**
 * The ramp of each device class. Each tops out where the hierarchy holds 20,000 to 50,000 moving
 * parts, where three.js's per-object work shows on phones. Each row is a first guess until a device
 * sitting measures it.
 */
export const FACTORY_RAMPS = {
	desktop: { start: 2_000, factor: 1.2, max: 50_000 },
	tablet: { start: 1_000, factor: 1.2, max: 30_000 },
	phone: { start: 1_000, factor: 1.2, max: 20_000 },
} as const satisfies Record<DeviceClass, RampPlan>;

/** The frame that the image tests hold: the simulation time and the count. */
export const FACTORY_HOLD = { seconds: 6, count: 2_000 } as const;
