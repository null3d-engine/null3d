// The demo's simulation: one run of an orb hunt, stepped by ticks from a seed and a log of the
// player's input. It owns everything that decides the run: where the player stands, where they
// look, and which orbs they caught. It uses exact arithmetic alone: null3D's maths entry, clockwork2's
// exact sine and cosine, and `createMath` on clockwork2's functions for the turns, the angle to an
// orb and the easing. So a replay of the log from the seed gives the same bits in every JavaScript
// engine. The page steps it, and the sketch only draws what it computes.
import { acos, cos, exp, sin } from '@clockwork2/engine/dmath';
import { createMath } from '@null3d/engine/math';
import * as math from '@null3d/engine/math/math';
import * as quat from '@null3d/engine/math/quat';
import * as vec3 from '@null3d/engine/math/vec3';

/** The eight helpers that turn by an angle or ease, built once on the exact functions. */
const exact = createMath({ sin, cos, acos, exp });

/** Ticks a second. The page steps a run at this rate, and a replay steps it the same way. */
export const TICK_HZ = 60;
/** The seed of every run, so every run hides its orbs in the same places. */
export const SEED = 2468;
export const ORBS = 12;
/** The bits of a tick's movement keys. */
export const FORWARD = 1;
export const BACK = 2;
export const LEFT = 4;
export const RIGHT = 8;
/** The numbers of one tick's input in the log: its keys, then the mouse's turn and tilt in counts. */
export const INPUT_NUMBERS = 3;
/** The arena's radius, the player's eye height, and the walk's speed in meters a second. */
export const ARENA = 9;
const EYE = 1.6;
const SPEED = 3.2;
const DT = 1 / TICK_HZ;
/** The turn of one count of the mouse, how fast the walk eases to the keys, and the steepest look. */
const TURN = 0.0024;
const EASE = 9;
const PITCH = 1.25;
/** An orb is caught when the view points within this angle of it, from within this distance. */
const SIGHT = 0.16;
const REACH = 4;
const TWO_PI = 2 * Math.PI;

/** A run's state. Every number that decides it is here, and the sketch draws from them. */
export interface Run {
	tick: number;
	/** The player's eye. */
	position: number[];
	/** The walk's velocity, in meters a second. */
	velocity: number[];
	/** The turn about the vertical axis and the look up or down, in radians. */
	yaw: number;
	pitch: number;
	/** The view's rotation, from the yaw and the pitch: the camera that the sketch draws with. */
	look: number[];
	/** Each orb's place, three numbers each. */
	orbs: Float64Array;
	/** The tick that caught each orb, or -1. */
	caught: Int32Array;
	score: number;
}

/** A generator of numbers in [0, 1) from a seed, with integer arithmetic alone: mulberry32. */
function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A new run: the player at the arena's south edge looking north, and the orbs placed by the seed. */
export function startRun(seed = SEED): Run {
	const next = generator(seed);
	const orbs = new Float64Array(ORBS * 3);
	for (let i = 0; i < ORBS; i++) {
		// Three rings: an orb sits near and low, middling, or far and high.
		const turn = (i + 0.2 + 0.6 * next()) * (TWO_PI / ORBS);
		const far = 1.6 + (i % 3) * 2.1 + next() * 0.8;
		orbs.set([sin(turn) * far, 0.6 + (i % 3) * 0.7 + next() * 0.5, cos(turn) * far], i * 3);
	}
	const run: Run = {
		tick: 0,
		position: [0, EYE, ARENA - 0.7],
		velocity: [0, 0, 0],
		yaw: 0,
		pitch: 0,
		look: quat.create(),
		orbs,
		caught: new Int32Array(ORBS).fill(-1),
		score: 0,
	};
	return run;
}

// Scratch, made once: a step allocates nothing.
const UP = [0, 1, 0];
const AHEAD = [0, 0, -1];
const heading = quat.create();
const want = vec3.create();
const view = vec3.create();
const toOrb = vec3.create();

/**
 * Steps the run by one tick: `keys` holds the movement keys' bits, and `turn` and `tilt` the mouse's
 * movement since the last tick, in whole counts.
 */
export function step(run: Run, keys: number, turn: number, tilt: number): void {
	run.yaw = math.euclideanModulo(run.yaw - turn * TURN, TWO_PI);
	run.pitch = math.clamp(run.pitch - tilt * TURN, -PITCH, PITCH);
	exact.quat.fromEuler(run.look, run.pitch, run.yaw, 0, 'YXZ');
	// The walk follows the turn and not the tilt, and eases toward the keys' speed.
	exact.quat.setAxisAngle(heading, UP, run.yaw);
	const across = (keys & RIGHT ? 1 : 0) - (keys & LEFT ? 1 : 0);
	const along = (keys & BACK ? 1 : 0) - (keys & FORWARD ? 1 : 0);
	vec3.set(want, across, 0, along);
	if (across !== 0 || along !== 0) vec3.scale(want, vec3.normalize(want, want), SPEED);
	vec3.transformQuat(want, want, heading);
	for (let k = 0; k < 3; k++)
		run.velocity[k] = exact.math.damp(run.velocity[k] as number, want[k] as number, EASE, DT);
	vec3.scaleAndAdd(run.position, run.position, run.velocity, DT);
	// The arena's wall stops the walk.
	const { position, orbs } = run;
	const x = position[0] as number;
	const z = position[2] as number;
	const out = Math.sqrt(x * x + z * z);
	if (out > ARENA) vec3.set(position, (x * ARENA) / out, EYE, (z * ARENA) / out);
	// An orb in the middle of the view, close enough, is caught: where the player looks decides it.
	vec3.transformQuat(view, AHEAD, run.look);
	for (let i = 0; i < ORBS; i++) {
		if ((run.caught[i] as number) >= 0) continue;
		const at = i * 3;
		vec3.set(
			toOrb,
			(orbs[at] as number) - (position[0] as number),
			(orbs[at + 1] as number) - (position[1] as number),
			(orbs[at + 2] as number) - (position[2] as number),
		);
		if (vec3.length(toOrb) > REACH || exact.vec3.angle(view, toOrb) > SIGHT) continue;
		run.caught[i] = run.tick;
		run.score++;
	}
	run.tick++;
}

/** Steps a new run from the seed through a log of inputs, `INPUT_NUMBERS` numbers a tick. */
export function replay(log: readonly number[], seed = SEED): Run {
	const run = startRun(seed);
	for (let k = 0; k < log.length; k += INPUT_NUMBERS)
		step(run, log[k] as number, log[k + 1] as number, log[k + 2] as number);
	return run;
}

/** True when two runs hold the same numbers, bit for bit. */
export function sameRun(a: Run, b: Run): boolean {
	const numbers = (run: Run) => [
		run.tick,
		...run.position,
		...run.velocity,
		run.yaw,
		run.pitch,
		...run.look,
		...run.caught,
		run.score,
	];
	const [x, y] = [numbers(a), numbers(b)];
	return x.length === y.length && x.every((value, k) => Object.is(value, y[k]));
}
