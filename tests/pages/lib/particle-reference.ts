// A reference particle emitter in TypeScript, for the test that checks the core's emitter: it
// computes a frame's records directly on the sketch thread, as the add-on's emitter did before
// the loop moved into the core. The `particle-emit` page runs it beside the live emitter over the
// same seeds, shapes, follow, sub-emitter chain and ring wrap, and compares every record.
//
// This module ships with the tests only. It is not part of any package.

// Seeded random numbers for emitters. Each particle's numbers come from a hash of its system's seed
// and its own number, so a system emits the same particles whatever the frame rate, and a held frame
// is the same on every machine. The hash is PCG's, as the particle shaders hash seeds. The numbers
// go through typed arrays, never as results, so a call allocates nothing.

/** The places of `randomize`'s whole numbers: the system's seed, the particle's number, its seed. */
export const SYSTEM_SEED = 0;
export const NUMBER = 1;
export const PARTICLE_SEED = 2;

/**
 * Writes the seed of particle `seeds[NUMBER]` of the system whose seed is `seeds[SYSTEM_SEED]` at
 * `seeds[PARTICLE_SEED]`, and fills `out` with that particle's numbers from 0 up to 1, one for each
 * channel.
 */
export function randomize(seeds: Uint32Array, out: Float64Array): void {
	let state =
		(Math.imul(((seeds[SYSTEM_SEED] as number) ^ (seeds[NUMBER] as number)) >>> 0, 747796405) +
			2891336453) >>>
		0;
	let word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	const seed = ((word >>> 22) ^ word) >>> 0;
	seeds[PARTICLE_SEED] = seed;
	for (let c = 0; c < out.length; c++) {
		state = (Math.imul((seed ^ Math.imul(c, 2654435769)) >>> 0, 747796405) + 2891336453) >>> 0;
		word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
		out[c] = (((word >>> 22) ^ word) >>> 8) / 16777216;
	}
}

/** The PCG hash of a 32-bit value, for seeds that the systems make once. */
export function pcg(value: number): number {
	const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

// The particles' motion on the CPU, the same closed form that the particle shaders work out on the
// GPU: gravity and linear drag toward the wind, a ground that ends, bounces or stops a particle, and
// simplex-noise turbulence as a displacement. Systems use it where the CPU must know a particle's
// state: when the ground ends a particle and where a sub-emitter starts. The functions take and give
// their numbers in typed arrays and objects, never as arguments or results, so a call allocates
// nothing even where the engine does not inline it.

/** The most bounces a particle makes off the ground, as in the shaders. */
const BOUNCES = 2;
/** Newton steps toward each impact, as in the shaders. */
const STEPS = 4;
/** Drag below which the motion is the plain ballistic one. */
const LITTLE_DRAG = 1e-4;

/** The ground's mode codes, as the shaders read them: none, kill, bounce and stick. */
export const GROUND_NONE = 0;
export const GROUND_KILL = 1;
export const GROUND_BOUNCE = 2;
export const GROUND_STICK = 3;

/** The motion values of a system, in the space of its object. */
export interface MotionValues {
	gx: number;
	gy: number;
	gz: number;
	drag: number;
	wx: number;
	wy: number;
	wz: number;
	turbulence: number;
	turbulenceScale: number;
	turbulenceSpeed: number;
	groundHeight: number;
	groundMode: number;
	restitution: number;
	friction: number;
}

/** A particle's place and velocity, which `stateAt` writes. */
export interface ParticleState {
	px: number;
	py: number;
	pz: number;
	vx: number;
	vy: number;
	vz: number;
	/** False once the ground ended the particle. */
	alive: boolean;
}

/** A new state at rest at the origin. */
export function particleState(): ParticleState {
	return { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, alive: true };
}

/**
 * The places of a flight's numbers: it starts at P with the velocity V, and runs for T seconds.
 * `flight` writes where it ends at OUT_P and its velocity there at OUT_V. `impact` reads T as the
 * longest time to look over, and writes the impact's time at HIT, or -1 for none.
 */
export const P = 0;
export const V = 3;
export const T = 6;
export const HIT = 7;
export const OUT_P = 8;
export const OUT_V = 11;
/** The floats of a flight's numbers. */
export const FLIGHT_FLOATS = 14;

/** Where a flight that `io` describes ends after its time, written into `io`. */
export function flight(m: MotionValues, io: Float64Array): void {
	const t = io[T] as number;
	const k = m.drag;
	if (k < LITTLE_DRAG) {
		io[OUT_P] = (io[P] as number) + (io[V] as number) * t + 0.5 * m.gx * t * t;
		io[OUT_P + 1] = (io[P + 1] as number) + (io[V + 1] as number) * t + 0.5 * m.gy * t * t;
		io[OUT_P + 2] = (io[P + 2] as number) + (io[V + 2] as number) * t + 0.5 * m.gz * t * t;
		io[OUT_V] = (io[V] as number) + m.gx * t;
		io[OUT_V + 1] = (io[V + 1] as number) + m.gy * t;
		io[OUT_V + 2] = (io[V + 2] as number) + m.gz * t;
		return;
	}
	const decay = Math.exp(-k * t);
	const share = (1 - decay) / k;
	for (let c = 0; c < 3; c++) {
		// The terminal velocity of the axis, which drag eases the velocity toward.
		const end = c === 0 ? m.wx + m.gx / k : c === 1 ? m.wy + m.gy / k : m.wz + m.gz / k;
		const v = (io[V + c] as number) - end;
		io[OUT_P + c] = (io[P + c] as number) + end * t + v * share;
		io[OUT_V + c] = end + v * decay;
	}
}

/** Scratch numbers of the impact search. */
const probe = new Float64Array(FLIGHT_FLOATS);

/**
 * Finds the first time after 0 at which the flight that `io` describes falls onto the ground,
 * within its time, as the shaders find it, and writes it at HIT, or -1 for none.
 */
export function impact(m: MotionValues, io: Float64Array): void {
	const ground = m.groundHeight;
	const g = m.gy;
	const limit = io[T] as number;
	const vy = io[V + 1] as number;
	const rise = (io[P + 1] as number) - ground;
	let t = limit;
	const d = vy * vy - 2 * g * rise;
	if (g < 0 && d >= 0) t = (-vy - Math.sqrt(d)) / g;
	else if (vy < 0) t = rise / -vy;
	t = Math.min(Math.max(t, 0), limit);
	for (let k = 0; k < 6; k++) probe[k] = io[k] as number;
	for (let k = 0; k < STEPS; k++) {
		probe[T] = t;
		flight(m, probe);
		const fall = Math.min(probe[OUT_V + 1] as number, -1e-3);
		t = Math.min(Math.max(t - ((probe[OUT_P + 1] as number) - ground) / fall, 0), limit);
	}
	// A flight that ends near the ground counts only while it falls, so one that bounced up off it
	// does not meet it again at once.
	probe[T] = t;
	flight(m, probe);
	const near = Math.abs((probe[OUT_P + 1] as number) - ground) < 0.01;
	io[HIT] = near && t > 0 && (probe[OUT_V + 1] as number) < 0 ? t : -1;
}

/** The places of a particle's numbers that `stateAt` reads: its birth place, velocity, age and seed. */
export const BIRTH = 0;
export const VELOCITY = 3;
export const AGE = 6;
export const SEED = 7;
/** The floats of a particle's numbers. */
export const PARTICLE_FLOATS = 8;

/** Scratch numbers of `stateAt`. */
const leg = new Float64Array(FLIGHT_FLOATS);
const noise = new Float64Array(4);

/** The offsets of the three noise channels of the turbulence, as in the shaders. */
const CHANNELS = [0, 0, 0, 31.4, 17.3, 5.9, -11.7, 41.2, 23.5] as const;

/**
 * Writes the state of the particle that `input` describes, at its age, into `out`, as the shaders
 * work it out.
 */
export function stateAt(m: MotionValues, input: Float64Array, out: ParticleState): void {
	for (let k = 0; k < 6; k++) leg[k] = input[k] as number;
	leg[T] = input[AGE] as number;
	out.alive = true;
	let stopped = false;
	if (m.groundMode !== GROUND_NONE) {
		for (let b = 0; b <= BOUNCES; b++) {
			impact(m, leg);
			const hit = leg[HIT] as number;
			if (hit < 0) break;
			const left: number = (leg[T] as number) - hit;
			leg[T] = hit;
			flight(m, leg);
			if (m.groundMode === GROUND_KILL) {
				out.alive = false;
				break;
			}
			leg[P] = leg[OUT_P] as number;
			leg[P + 1] = m.groundHeight;
			leg[P + 2] = leg[OUT_P + 2] as number;
			if (m.groundMode === GROUND_STICK || b === BOUNCES) {
				leg[V] = leg[V + 1] = leg[V + 2] = 0;
				leg[T] = 0;
				stopped = true;
				break;
			}
			const keep = 1 - m.friction;
			leg[V] = (leg[OUT_V] as number) * keep;
			leg[V + 1] = -(leg[OUT_V + 1] as number) * m.restitution;
			leg[V + 2] = (leg[OUT_V + 2] as number) * keep;
			leg[T] = left;
		}
	}
	flight(m, leg);
	out.px = leg[OUT_P] as number;
	out.py = leg[OUT_P + 1] as number;
	out.pz = leg[OUT_P + 2] as number;
	out.vx = stopped ? 0 : (leg[OUT_V] as number);
	out.vy = stopped ? 0 : (leg[OUT_V + 1] as number);
	out.vz = stopped ? 0 : (leg[OUT_V + 2] as number);
	if (m.turbulence <= 0) return;
	const s = ((input[SEED] as number) & 0xffff) * 0.013;
	const q = m.turbulenceScale;
	const drift = m.turbulenceSpeed * (input[AGE] as number);
	for (let c = 0; c < 3; c++) {
		let move = 0;
		for (let later = 1; later >= 0; later--) {
			for (let a = 0; a < 3; a++)
				noise[a] =
					(input[BIRTH + a] as number) * q + s + later * drift + (CHANNELS[c * 3 + a] as number);
			simplex3(noise);
			move += (later * 2 - 1) * (noise[3] as number);
		}
		if (c === 0) out.px += m.turbulence * move;
		else if (c === 1) out.py += m.turbulence * move;
		else out.pz += m.turbulence * move;
	}
	if (m.groundMode !== GROUND_NONE) out.py = Math.max(out.py, m.groundHeight);
}

/**
 * One corner's part of simplex noise at the corner (cx, cy, cz), from the offset in `io`'s first
 * three numbers, added to its fourth, as the shaders add it.
 */
function corner(cx: number, cy: number, cz: number, io: Float64Array): void {
	const x = io[0] as number;
	const y = io[1] as number;
	const z = io[2] as number;
	const t = Math.max(0.6 - (x * x + y * y + z * z), 0);
	if (t === 0) return;
	// The first word of the pcg3d hash of the lattice point, then Perlin's gradient that it picks.
	let px = (Math.imul(cx, 1664525) + 1013904223) >>> 0;
	let py = (Math.imul(cy, 1664525) + 1013904223) >>> 0;
	let pz = (Math.imul(cz, 1664525) + 1013904223) >>> 0;
	px = (px + Math.imul(py, pz)) >>> 0;
	py = (py + Math.imul(pz, px)) >>> 0;
	pz = (pz + Math.imul(px, py)) >>> 0;
	px ^= px >>> 16;
	py ^= py >>> 16;
	pz ^= pz >>> 16;
	const k = ((px + Math.imul(py, pz)) >>> 0) & 15;
	const u = k < 8 ? x : y;
	const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
	const t2 = t * t;
	io[3] = (io[3] as number) + t2 * t2 * (((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v));
}

/** Scratch offset of a simplex corner. */
const offset = new Float64Array(4);

/**
 * Simplex noise in 3D at the point in `io`'s first three numbers, from about -1 to 1, as the
 * shaders' `simplex3` gives it, written into its fourth.
 */
export function simplex3(io: Float64Array): void {
	const x = io[0] as number;
	const y = io[1] as number;
	const z = io[2] as number;
	const skew = (x + y + z) / 3;
	const cx = Math.floor(x + skew);
	const cy = Math.floor(y + skew);
	const cz = Math.floor(z + skew);
	const unskew = (cx + cy + cz) / 6;
	const x0 = x - (cx - unskew);
	const y0 = y - (cy - unskew);
	const z0 = z - (cz - unskew);
	// step(x0.yzx, x0.xyz): 1 where the first is no larger; i1 = min(g, l.zxy), i2 = max(g, l.zxy).
	const gx = y0 <= x0 ? 1 : 0;
	const gy = z0 <= y0 ? 1 : 0;
	const gz = x0 <= z0 ? 1 : 0;
	const i1x = Math.min(gx, 1 - gz);
	const i1y = Math.min(gy, 1 - gx);
	const i1z = Math.min(gz, 1 - gy);
	const i2x = Math.max(gx, 1 - gz);
	const i2y = Math.max(gy, 1 - gx);
	const i2z = Math.max(gz, 1 - gy);
	offset[3] = 0;
	for (let c = 0; c < 4; c++) {
		const ox = c === 0 ? 0 : c === 1 ? i1x : c === 2 ? i2x : 1;
		const oy = c === 0 ? 0 : c === 1 ? i1y : c === 2 ? i2y : 1;
		const oz = c === 0 ? 0 : c === 1 ? i1z : c === 2 ? i2z : 1;
		const back = c / 6;
		offset[0] = x0 - ox + back;
		offset[1] = y0 - oy + back;
		offset[2] = z0 - oz + back;
		corner(cx + ox, cy + oy, cz + oz, offset);
	}
	io[3] = 32 * (offset[3] as number);
}

/**
 * How far a particle may move from its birth place in `lifetime` seconds with a start speed of at
 * most `speed`: a bound for the culling sphere, which leaves out the ground. The systems work it out
 * when their motion changes, not in each frame.
 */
export function reach(m: MotionValues, speed: number, lifetime: number): number {
	const g = Math.sqrt(m.gx * m.gx + m.gy * m.gy + m.gz * m.gz);
	const turbulence = 2 * m.turbulence;
	if (m.drag < LITTLE_DRAG) return speed * lifetime + 0.5 * g * lifetime * lifetime + turbulence;
	const tx = m.wx + m.gx / m.drag;
	const ty = m.wy + m.gy / m.drag;
	const tz = m.wz + m.gz / m.drag;
	const end = Math.sqrt(tx * tx + ty * ty + tz * tz);
	const settle = Math.min(lifetime, 1 / m.drag);
	return end * lifetime + (speed + end) * settle + turbulence;
}

// Particle systems: an emitter that fills one of the engine's particle buffers. The emitter runs on
// the sketch's thread in `update`, once per frame. It works out which particles are born in the
// frame, at even times between the frame before and this one, writes each one's record once, and
// gives the buffer the frame's time. The GPU does the rest: each particle moves, turns, changes
// color and dies in closed form, so a system of a million particles costs the CPU only its births.
//
// `update` allocates nothing once a system with sub-emitters has grown its table of pending
// events. Its numbers move through typed arrays and fields, never as the arguments or the results
// of calls that the engine may not inline, which would box them.
//
// Birth times are 32-bit floats on the GPU, so every 1,024 seconds a system moves the time that
// its buffer's time counts from. It rewrites the records' birth times a share at a time, over
// many frames, and meanwhile the GPU takes the move off the birth times of the records that the
// rewrite has not reached.

import type {
	Mat4Like,
	Mesh,
	Object3D,
	ParticleBuffer,
	ParticleBufferOptions,
	ParticleValues,
	SketchTime,
	Vec3Like,
} from '@null3d/engine';
import { mat4 } from '@null3d/engine';

/**
 * A number, or the smallest and the largest of a random number.
 *
 * @category api/particles
 */
export type ParticleRange = number | readonly [number, number];

/**
 * Where an emitter's particles are born, in its own space, and which way they set off. A `point`
 * emits at the emitter, along `direction`. A `sphere` emits inside a ball of `radius`, or on its
 * surface with `surface`, and sends particles outward. A `cone` emits on a disc of `radius` across
 * the emitter's +y axis. It sends particles up within `angle` radians of that axis, as a fountain
 * or a flame does. A `box` emits inside a box of `size`, centered on the emitter, along
 * `direction`. A `disc` emits on a disc of `radius` across the +y axis, along `direction`.
 *
 * @category api/particles
 */
export type EmitterShape =
	| { type: 'point' }
	| { type: 'sphere'; radius: number; surface?: boolean }
	| { type: 'cone'; radius: number; angle: number }
	| { type: 'box'; size: Vec3Like }
	| { type: 'disc'; radius: number };

/**
 * A burst: `count` particles at once, at `time` seconds after the system starts, then every
 * `interval` seconds, `cycles` times in all.
 *
 * @category api/particles
 */
export interface ParticleBurst {
	/** Seconds after the system starts. */
	time: number;
	/** The particles of each burst. */
	count: number;
	/** Seconds between bursts. Without it, the burst happens once, or once per loop of a looping system. */
	interval?: number;
	/** How many bursts, with `interval`. The default is no limit. */
	cycles?: number;
}

/**
 * A sub-emitter: another system that bursts where a particle of this system dies or first meets
 * the ground. A firework's rocket bursts into sparks this way, and a raindrop splashes.
 *
 * @category api/particles
 */
export interface SubEmitter {
	/** The system that bursts. */
	system: ReferenceSystem;
	/** `death` at the end of the particle's life, or `ground` where it first meets the ground. */
	on: 'death' | 'ground';
	/** The particles of each burst. */
	count: number;
	/** The share of the particle's velocity that the burst's particles take on. The default is 0. */
	inheritVelocity?: number;
}

/**
 * Options of `createParticles`: the emitter, then the engine's particle buffer options, which give
 * the motion and the look.
 *
 * @category api/particles
 */
export interface ReferenceSystemOptions extends Omit<ParticleBufferOptions, 'capacity'> {
	/**
	 * The most particles alive at once. The default fits the rate and the bursts over the longest
	 * lifetime. A system past its capacity reuses the oldest particles' places.
	 */
	capacity?: number;
	/** Where the system sits in the world, or under `parent`. The default is the origin. */
	position?: Vec3Like;
	/** The object that the system moves with, as a child of it. The default is the scene's root. */
	parent?: Object3D;
	/**
	 * An object to emit from, in place of the system's own place. Its particles stay in the world
	 * where they were born, so a moving emitter leaves a trail, as smoke from a torch does. Without
	 * it, particles move with the system's object.
	 */
	follow?: Object3D;
	/** Where the particles are born. The default is a point. */
	shape?: EmitterShape;
	/** The way particles set off from a point, box or disc, in the emitter's space. The default is up. */
	direction?: Vec3Like;
	/** How far from `direction` particles set off at random, in radians. The default is 0. */
	spread?: number;
	/** The start speed, in meters per second. The default is 1. */
	speed?: ParticleRange;
	/** A velocity that every particle adds to its own at birth, in meters per second. */
	velocity?: Vec3Like;
	/** How long each particle lives, in seconds. The default is 1. */
	lifetime?: ParticleRange;
	/** Particles born per second. The default is 0. */
	rate?: number;
	/** Bursts of particles at set times. */
	bursts?: readonly ParticleBurst[];
	/**
	 * Seconds that the system emits for. With `loop`, it starts again after it; without, it stops.
	 * The default is no end.
	 */
	duration?: number;
	/** True to start again after `duration`. The default is true. */
	loop?: boolean;
	/** True to start as if the system had run for its longest lifetime already. The default is false. */
	prewarm?: boolean;
	/** Systems that burst where this system's particles die or meet the ground. */
	subEmitters?: readonly SubEmitter[];
	/** The seed of the system's random numbers. Systems with the same seed emit the same particles. */
	seed?: number;
}

/** Seconds of the buffer's time after which the system moves its time back, for precision. */
const REBASE_AFTER = 1024;
/** Records whose birth times one frame moves to the new time base, while the base moves. */
const REBASE_RECORDS = 16384;
/** The most births that one block holds, which bounds the block's memory. */
const BIRTH_CHUNK = 1024;
/** The numbers of one birth that the engine's record block takes: the record's eight, then the seed. */
const BIRTH_FLOATS = 9;
/** Floats of a pending sub-emitter event: its time and sub-emitter, then the particle's numbers. */
const EVENT_FLOATS = 2 + PARTICLE_FLOATS;
/** The pending sub-emitter events that a system makes room for at first, before it doubles them. */
const FIRST_EVENTS = 64;
/** The random channels of a particle: its speed, shape, direction, place in a box, and lifetime. */
const SPEED = 0;
const U = 1;
const W = 2;
const R = 3;
const ANGLE = 4;
const BOX_Y = 5;
const BOX_Z = 6;
const LIFE = 7;
const RANDOM_CHANNELS = 8;
/** The places of the record that the system writes for each particle. */
const RECORD_TIME = 3;
const RECORD_LIFE = 7;
/** The places of the emitter's numbers: the span of emission, and the next birth's time and share. */
const FROM = 0;
const TO = 1;
const BIRTH_TIME = 2;
const SHARE = 3;

/** The share of its culling sphere's radius below which a system's new sphere replaces it. */
const BOUNDS_SLACK = 0.8;

/** The ground's mode codes, by name. */
const GROUND_MODES = { kill: GROUND_KILL, bounce: GROUND_BOUNCE, stick: GROUND_STICK } as const;

/** The frame of directions about up, for the cone. */
const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** The smallest and the largest of a range. */
function span(range: ParticleRange | undefined, fallback: number): readonly [number, number] {
	if (range === undefined) return [fallback, fallback];
	return typeof range === 'number' ? [range, range] : range;
}

/**
 * A particle system: an emitter that fills a particle buffer. `createParticles` makes one. Call
 * `update()` once per frame, in `onLateUpdate`, where objects' world places are the frame's.
 *
 * @category api/particles
 */
export class ReferenceSystem {
	/** Particles born per second, which may change at any time. */
	rate: number;
	/** False to stop emitting, as the rate and the bursts say; live particles live out their lives. */
	emitting = true;
	/** Seconds since the system started, as `update` adds them up. */
	time = 0;
	private readonly lifetime: readonly [number, number];
	private readonly speed: readonly [number, number];
	/** Particles emitted so far: each one's number picks its place and its random numbers. */
	private emitted = 0;
	/** The time of the next birth of the rate's stream, or Infinity for none. */
	private nextBirth = Infinity;
	/** The time that the buffer's time counts from. */
	private base = 0;
	/**
	 * While the base moves: the seconds by which the records from `rebased` up still count from
	 * the old base, which the GPU takes off their birth times. 0 otherwise.
	 */
	private shift = 0;
	/** The first record whose birth time still counts from the old base, while the base moves. */
	private rebased = 0;
	private readonly motion: MotionValues = {
		gx: 0,
		gy: 0,
		gz: 0,
		drag: 0,
		wx: 0,
		wy: 0,
		wz: 0,
		turbulence: 0,
		turbulenceScale: 1,
		turbulenceSpeed: 1,
		groundHeight: 0,
		groundMode: GROUND_NONE,
		restitution: 0.4,
		friction: 0.2,
	};
	/** How far beyond its births' box a live particle may be, for the culling sphere. */
	private grow = 0;
	/** The followed object's world matrix in this frame and the frame before, and the system's inverse. */
	private readonly emitter = new Float64Array(16);
	private readonly lastEmitter = new Float64Array(16);
	private readonly toLocal = new Float64Array(16);
	private hasLast = false;
	/** The births' box in the system's space, for this span of the longest lifetime and the one before. */
	private readonly births = new Float64Array(12);
	private epochEnd = 0;
	/** The culling sphere last given to the object, and the point that carries its center. */
	private readonly bounds = new Float64Array(4);
	private readonly center = [0, 0, 0];
	/** The pending sub-emitter events, EVENT_FLOATS each, which double when they fill up. */
	private events: Float64Array;
	/** The most pending events: one per sub-emitter for each record. */
	private readonly maxEvents: number;
	private eventCount = 0;
	/** The emitter's numbers: see FROM, TO, BIRTH_TIME and SHARE. */
	private readonly span = new Float64Array(4);
	/** The system's seed, a particle's number and its seed, for `randomize`. */
	private readonly seeds = new Uint32Array(3);
	private readonly random = new Float64Array(RANDOM_CHANNELS);
	/** The record of the particle being born, as the buffer takes it. */
	private readonly record = new Float64Array(8);
	/** The axes of the frame whose y axis is the emitter's direction, as three columns. */
	private readonly frame = new Float64Array(9);
	/** A particle's numbers for the motion functions, and its state at an event. */
	private readonly particle = new Float64Array(PARTICLE_FLOATS);
	private readonly flightNumbers = new Float64Array(14);
	private readonly state = particleState();
	/** A burst's place and its added velocity, made in the sub-emitter's space. */
	private readonly point = [0, 0, 0];
	private readonly inherited = [0, 0, 0];
	/** This system's world matrix and the matrix into a sub-emitter's space, while events fire. */
	private readonly world = new Float64Array(16);
	private readonly childLocal = new Float64Array(16);
	/** The block of births' parameters that one call writes, and how many the block holds. */
	private birthBlock: Float32Array | null = null;
	private birthFirst = 0;
	private birthCount = 0;

	/** @internal */
	constructor(
		/** The engine's particle buffer that the system fills, with its scene object. */
		readonly buffer: ParticleBuffer,
		private readonly options: ReferenceSystemOptions,
		private readonly clock: SketchTime,
	) {
		this.rate = options.rate ?? 0;
		this.lifetime = span(options.lifetime, 1);
		this.speed = span(options.speed, 1);
		this.seeds[SYSTEM_SEED] = pcg(options.seed ?? 1);
		const subs = options.subEmitters?.length ?? 0;
		this.maxEvents = buffer.capacity * subs;
		this.events = new Float64Array(Math.min(this.maxEvents, FIRST_EVENTS) * EVENT_FLOATS);
		this.resetBirths();
		this.readMotion(options);
		this.frame.set(IDENTITY);
		const d = options.direction;
		if (d) {
			// t = normalize(cross(a, n)) and b = cross(n, t), for n the direction and a an axis apart.
			const [dx, dy, dz] = [d[0] as number, d[1] as number, d[2] as number];
			const len = Math.hypot(dx, dy, dz) || 1;
			const [nx, ny, nz] = [dx / len, dy / len, dz / len];
			const [ax, ay, az] = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];
			const [cx, cy, cz] = [ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx];
			const tl = Math.hypot(cx, cy, cz) || 1;
			const [tx, ty, tz] = [cx / tl, cy / tl, cz / tl];
			const bx = ny * tz - nz * ty;
			const by = nz * tx - nx * tz;
			const bz = nx * ty - ny * tx;
			this.frame.set([tx, ty, tz, nx, ny, nz, bx, by, bz]);
		}
	}

	/** The system's scene object: place, layers, visibility and bounds. */
	get object(): Mesh {
		return this.buffer.object;
	}

	/** Changes the motion and the look from the next frame on, as the options name them. */
	set(values: ParticleValues): void {
		this.buffer.set(values);
		this.readMotion(values);
	}

	/** Keeps the CPU's copy of the motion values in step with the buffer's, and the reach. */
	private readMotion(values: ParticleValues): void {
		const m = this.motion;
		const { gravity, wind } = values;
		if (gravity) {
			m.gx = gravity[0] as number;
			m.gy = gravity[1] as number;
			m.gz = gravity[2] as number;
		}
		if (wind) {
			m.wx = wind[0] as number;
			m.wy = wind[1] as number;
			m.wz = wind[2] as number;
		}
		m.drag = values.drag ?? m.drag;
		m.turbulence = values.turbulence ?? m.turbulence;
		m.turbulenceScale = values.turbulenceScale ?? m.turbulenceScale;
		m.turbulenceSpeed = values.turbulenceSpeed ?? m.turbulenceSpeed;
		if (values.groundHeight !== undefined) {
			m.groundHeight = values.groundHeight;
			if (m.groundMode === GROUND_NONE) m.groundMode = GROUND_BOUNCE;
		}
		if (values.groundMode) m.groundMode = GROUND_MODES[values.groundMode];
		m.restitution = values.restitution ?? m.restitution;
		m.friction = values.friction ?? m.friction;
		const add = this.options.velocity;
		const extra = add ? Math.hypot(add[0] as number, add[1] as number, add[2] as number) : 0;
		const size = Math.max(values.size?.[1] ?? 0, this.options.size?.[1] ?? 0.1);
		const aspect = Math.max(1, values.aspect ?? this.options.aspect ?? 1);
		this.grow = reach(m, this.speed[1] + extra, this.lifetime[1]) + size * aspect;
	}

	/**
	 * Moves the system on by the frame's step, or by `dt` seconds: emits the particles born in that
	 * time, fires the sub-emitters of particles that died or met the ground, and gives the buffer
	 * its time. Call it once per frame in `onLateUpdate`. It allocates nothing, apart from the
	 * table of a system with sub-emitters, which grows while the system warms up, and the block of
	 * births, which it makes on the first birth.
	 */
	update(dt?: number): void {
		const s = this.span;
		this.readEmitter();
		if (this.time === 0 && this.emitted === 0 && this.options.prewarm) {
			// A prewarmed system emits its first span of the longest lifetime at once.
			s[FROM] = 0;
			s[TO] = this.lifetime[1];
			this.emitBetween();
			this.time = this.lifetime[1];
		}
		// The step goes through the typed array: a number that may be either of two values would be
		// boxed on its way.
		s[TO] = this.clock.dt;
		if (dt !== undefined) s[TO] = dt;
		s[FROM] = this.time;
		s[TO] = this.time + Math.max(s[TO] as number, 0);
		this.emitBetween();
		this.time = s[TO] as number;
		this.fireEvents();
		this.flushBirths();
		if (this.shift === 0 && this.time - this.base > REBASE_AFTER) this.startRebase();
		if (this.shift !== 0) this.rebaseStep();
		const frame = this.buffer.frame;
		frame[0] = this.time - this.base;
		frame[1] = Math.min(this.emitted, this.buffer.capacity);
		frame[2] = this.rebased;
		frame[3] = this.shift;
		this.buffer.commit();
		this.updateBounds();
	}

	/**
	 * Emits `count` particles at once, at the emitter, or at `at` in the system's space with the
	 * shape's spread around it. Each particle adds `velocity` to its own start velocity, in place of
	 * the system's `velocity` option.
	 */
	burst(count: number, at?: Vec3Like, velocity?: Vec3Like): void {
		this.span[BIRTH_TIME] = this.time;
		this.span[SHARE] = 1;
		for (let k = 0; k < count; k++) this.emit(at, velocity);
		this.flushBirths();
	}

	/** Emits the rate's and the bursts' particles born after the span's start and up to its end. */
	private emitBetween(): void {
		const s = this.span;
		const from = s[FROM] as number;
		const to = s[TO] as number;
		const length = Math.max(to - from, 1e-9);
		const { duration, loop = true, bursts } = this.options;
		const end = duration !== undefined && !loop ? duration : Infinity;
		if (this.emitting && this.rate > 0) {
			const step = 1 / this.rate;
			if (this.nextBirth === Infinity || this.nextBirth < from) this.nextBirth = from + step;
			let budget = this.buffer.capacity;
			while (this.nextBirth <= to && this.nextBirth <= end && budget-- > 0) {
				s[BIRTH_TIME] = this.nextBirth;
				s[SHARE] = (this.nextBirth - from) / length;
				this.emit(undefined, undefined);
				this.nextBirth += step;
			}
		} else this.nextBirth = Infinity;
		if (!this.emitting || !bursts) return;
		for (let b = 0; b < bursts.length; b++) {
			const burst = bursts[b] as ParticleBurst;
			const interval = burst.interval ?? (loop && duration !== undefined ? duration : 0);
			const cycles = burst.interval !== undefined || loop ? (burst.cycles ?? Infinity) : 1;
			// The bursts whose times fall after the span's start and up to its end.
			let first = interval > 0 ? Math.max(0, Math.ceil((from - burst.time) / interval)) : 0;
			if (interval > 0 && burst.time + first * interval <= from) first++;
			for (let j = first; j < cycles; j++) {
				const at = burst.time + j * interval;
				if (at > to || at > end) break;
				if (at > from || (from === 0 && at === 0)) {
					s[BIRTH_TIME] = at;
					s[SHARE] = (at - from) / length;
					for (let k = 0; k < burst.count; k++) this.emit(undefined, undefined);
				}
				if (interval <= 0) break;
			}
		}
	}

	/** Reads the emitter's world matrix for the frame, and the system's inverse world matrix. */
	private readEmitter(): void {
		const follow = this.options.follow;
		if (!follow) return;
		if (this.hasLast) this.lastEmitter.set(this.emitter);
		follow.getWorldMatrix(this.emitter as unknown as Mat4Like);
		this.object.getWorldMatrix(this.toLocal as unknown as Mat4Like);
		mat4.invert(this.toLocal as unknown as Mat4Like, this.toLocal as unknown as Mat4Like);
		if (!this.hasLast) {
			this.lastEmitter.set(this.emitter);
			this.hasLast = true;
		}
	}

	/**
	 * Emits one particle, born at the span's birth time, its share of the way through the frame for
	 * a followed emitter that moves. `at` and `velocity` give a burst's place and the velocity it adds
	 * in place of the system's own.
	 */
	private emit(at: Vec3Like | undefined, velocity: Vec3Like | undefined): void {
		const seeds = this.seeds;
		const number = this.emitted++;
		seeds[NUMBER] = number;
		randomize(seeds, this.random);
		const r = this.record;
		this.sampleShape();
		if (at) {
			for (let c = 0; c < 3; c++) r[c] = (r[c] as number) + (at[c] as number);
		} else if (this.options.follow) this.placeFollowed();
		const add = velocity ?? this.options.velocity;
		if (add) for (let c = 0; c < 3; c++) r[4 + c] = (r[4 + c] as number) + (add[c] as number);
		const shortest = this.lifetime[0];
		r[RECORD_LIFE] = shortest + (this.lifetime[1] - shortest) * (this.random[LIFE] as number);
		const index = number % this.buffer.capacity;
		// A record that the moving base has not reached yet counts from the old base.
		r[RECORD_TIME] =
			(this.span[BIRTH_TIME] as number) - this.base + (index >= this.rebased ? this.shift : 0);
		const seed = (seeds[PARTICLE_SEED] as number) & 0xffff;
		this.writeBirth(index, r, seed);
		this.growBirths();
		const subs = this.options.subEmitters;
		if (subs) for (let k = 0; k < subs.length; k++) this.planEvent(k);
	}

	/**
	 * Puts one birth's numbers into the block that the next write sends to the engine, and writes
	 * the block when it is full. The block holds the record's eight numbers and the seed.
	 */
	private writeBirth(index: number, record: Float64Array, seed: number): void {
		let block = this.birthBlock;
		if (!block) {
			block = new Float32Array(Math.min(this.buffer.capacity, BIRTH_CHUNK) * BIRTH_FLOATS);
			this.birthBlock = block;
		}
		if (this.birthCount === 0) this.birthFirst = index;
		const at = this.birthCount * BIRTH_FLOATS;
		for (let k = 0; k < 8; k++) block[at + k] = record[k] as number;
		block[at + 8] = seed;
		this.birthCount++;
		if (this.birthCount * BIRTH_FLOATS === block.length) this.flushBirths();
	}

	/** Writes the block's births to the buffer in one call, and empties it. */
	private flushBirths(): void {
		const count = this.birthCount;
		const block = this.birthBlock;
		if (count === 0 || !block) return;
		this.buffer.writeRecords(block, count, this.birthFirst);
		this.birthCount = 0;
	}

	/**
	 * Moves the record's place and velocity from the emitter's space to the world, between the
	 * emitter's places in the two frames, then into the system's space.
	 */
	private placeFollowed(): void {
		const r = this.record;
		const a = this.lastEmitter;
		const b = this.emitter;
		const m = this.toLocal;
		const p = this.point;
		const d = this.inherited;
		const share = this.span[SHARE] as number;
		for (let c = 0; c < 3; c++) {
			const from = a[12 + c] as number;
			const moved = from + ((b[12 + c] as number) - from) * share;
			p[c] = moved;
			d[c] = 0;
			for (let k = 0; k < 3; k++) {
				const axis = b[4 * k + c] as number;
				p[c] = (p[c] as number) + axis * (r[k] as number);
				d[c] = (d[c] as number) + axis * (r[4 + k] as number);
			}
		}
		for (let c = 0; c < 3; c++) {
			let place = m[12 + c] as number;
			let speed = 0;
			for (let k = 0; k < 3; k++) {
				place += (m[4 * k + c] as number) * (p[k] as number);
				speed += (m[4 * k + c] as number) * (d[k] as number);
			}
			r[c] = place;
			r[4 + c] = speed;
		}
	}

	/** Writes a place and a velocity from the shape, in the emitter's space, into the record. */
	private sampleShape(): void {
		const shape = this.options.shape;
		const rand = this.random;
		const r = this.record;
		const speed = this.speed[0] + (this.speed[1] - this.speed[0]) * (rand[SPEED] as number);
		const u = rand[U] as number;
		const v = rand[W] as number;
		const w = rand[R] as number;
		let px = 0;
		let py = 0;
		let pz = 0;
		let dx: number;
		let dy: number;
		let dz: number;
		if (shape?.type === 'sphere') {
			const z = 2 * u - 1;
			const ring = Math.sqrt(1 - z * z);
			const a = 2 * Math.PI * v;
			dx = ring * Math.cos(a);
			dy = z;
			dz = ring * Math.sin(a);
			const at = shape.radius * (shape.surface ? 1 : Math.cbrt(w));
			px = dx * at;
			py = dy * at;
			pz = dz * at;
		} else {
			// A direction within the cone's angle of up, or within the spread of the option's
			// direction, evenly over the cap of the sphere that the angle cuts.
			const cone = shape?.type === 'cone';
			const angle = shape?.type === 'cone' ? shape.angle : (this.options.spread ?? 0);
			const cos = 1 - u * (1 - Math.cos(angle));
			const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
			const a = 2 * Math.PI * v;
			const x = sin * Math.cos(a);
			const z = sin * Math.sin(a);
			const f = cone ? IDENTITY : this.frame;
			dx = (f[0] as number) * x + (f[3] as number) * cos + (f[6] as number) * z;
			dy = (f[1] as number) * x + (f[4] as number) * cos + (f[7] as number) * z;
			dz = (f[2] as number) * x + (f[5] as number) * cos + (f[8] as number) * z;
			if (shape?.type === 'cone' || shape?.type === 'disc') {
				const radius = shape.radius * Math.sqrt(w);
				const turn = 2 * Math.PI * (rand[ANGLE] as number);
				px = radius * Math.cos(turn);
				pz = radius * Math.sin(turn);
			} else if (shape?.type === 'box') {
				px = (w - 0.5) * (shape.size[0] as number);
				py = ((rand[BOX_Y] as number) - 0.5) * (shape.size[1] as number);
				pz = ((rand[BOX_Z] as number) - 0.5) * (shape.size[2] as number);
			}
		}
		r[0] = px;
		r[1] = py;
		r[2] = pz;
		r[4] = dx * speed;
		r[5] = dy * speed;
		r[6] = dz * speed;
	}

	/** Records when the newest particle's sub-emitter `sub` fires, if it does within its life. */
	private planEvent(sub: number): void {
		const m = this.motion;
		const r = this.record;
		const on = this.options.subEmitters?.[sub]?.on;
		const lifetime = r[RECORD_LIFE] as number;
		let age = lifetime;
		if (m.groundMode !== GROUND_NONE) {
			const io = this.flightNumbers;
			for (let k = 0; k < 3; k++) {
				io[P + k] = r[k] as number;
				io[V + k] = r[4 + k] as number;
			}
			io[T] = lifetime;
			impact(m, io);
			const hit = io[HIT] as number;
			if (on === 'ground' && hit < 0) return;
			if (hit >= 0 && (on === 'ground' || m.groundMode === GROUND_KILL)) age = hit;
		} else if (on === 'ground') return;
		if ((this.eventCount + 1) * EVENT_FLOATS > this.events.length && !this.growEvents()) return;
		const e = this.events;
		const at = this.eventCount++ * EVENT_FLOATS;
		e[at] = (this.span[BIRTH_TIME] as number) + age;
		e[at + 1] = sub;
		for (let k = 0; k < 3; k++) {
			e[at + 2 + BIRTH + k] = r[k] as number;
			e[at + 2 + VELOCITY + k] = r[4 + k] as number;
		}
		e[at + 2 + AGE] = age;
		e[at + 2 + SEED] = this.seeds[PARTICLE_SEED] as number;
	}

	/** Fires the sub-emitters whose events fall due by now. */
	private fireEvents(): void {
		const subs = this.options.subEmitters;
		if (!subs || this.eventCount === 0) return;
		const e = this.events;
		const s = this.state;
		const w = this.world;
		const local = this.childLocal;
		const input = this.particle;
		const p = this.point;
		this.object.getWorldMatrix(w as unknown as Mat4Like);
		let child: ReferenceSystem | undefined;
		for (let k = 0; k < this.eventCount; ) {
			const at = k * EVENT_FLOATS;
			if ((e[at] as number) > this.time) {
				k++;
				continue;
			}
			const sub = subs[e[at + 1] as number] as SubEmitter;
			for (let j = 0; j < PARTICLE_FLOATS; j++) input[j] = e[at + 2 + j] as number;
			stateAt(this.motion, input, s);
			// From this system's space to the world, then into the sub-emitter's space.
			if (child !== sub.system) {
				child = sub.system;
				child.object.getWorldMatrix(local as unknown as Mat4Like);
				mat4.invert(local as unknown as Mat4Like, local as unknown as Mat4Like);
			}
			for (let c = 0; c < 3; c++) {
				const world =
					(w[c] as number) * s.px +
					(w[4 + c] as number) * s.py +
					(w[8 + c] as number) * s.pz +
					(w[12 + c] as number);
				input[c] = world;
			}
			for (let c = 0; c < 3; c++) {
				let place = local[12 + c] as number;
				for (let j = 0; j < 3; j++) place += (local[4 * j + c] as number) * (input[j] as number);
				p[c] = place;
			}
			const inherit = sub.inheritVelocity ?? 0;
			const v = this.inherited;
			v[0] = s.vx * inherit;
			v[1] = s.vy * inherit;
			v[2] = s.vz * inherit;
			sub.system.burst(sub.count, p, inherit === 0 ? undefined : v);
			// The last event takes this one's place.
			this.eventCount--;
			e.copyWithin(at, this.eventCount * EVENT_FLOATS, (this.eventCount + 1) * EVENT_FLOATS);
		}
	}

	/** Starts the births' boxes empty. */
	private resetBirths(): void {
		this.births.fill(Infinity, 0, 3);
		this.births.fill(-Infinity, 3, 6);
		this.births.fill(Infinity, 6, 9);
		this.births.fill(-Infinity, 9, 12);
	}

	/** Grows this span's box of births by the newest birth place. */
	private growBirths(): void {
		const b = this.births;
		const r = this.record;
		for (let c = 0; c < 3; c++) {
			b[c] = Math.min(b[c] as number, r[c] as number);
			b[3 + c] = Math.max(b[3 + c] as number, r[c] as number);
		}
	}

	/**
	 * Gives the system's object a culling sphere around every live particle: the births of this
	 * span of the longest lifetime and the one before, grown by how far a particle can move. The
	 * object keeps its sphere while the new one fits in it and is not much smaller, so a steady
	 * emitter sets its bounds only now and then.
	 */
	private updateBounds(): void {
		const b = this.births;
		if (this.time >= this.epochEnd) {
			b.copyWithin(6, 0, 6);
			b.fill(Infinity, 0, 3);
			b.fill(-Infinity, 3, 6);
			this.epochEnd = this.time + this.lifetime[1];
		}
		const o = this.bounds;
		const center = this.center;
		let squared = 0;
		let moved = 0;
		for (let c = 0; c < 3; c++) {
			const low = Math.min(b[c] as number, b[6 + c] as number);
			const high = Math.max(b[3 + c] as number, b[9 + c] as number);
			if (!(low <= high)) return;
			const middle = (low + high) / 2;
			squared += (high - middle) * (high - middle);
			moved += (middle - (o[c] as number)) * (middle - (o[c] as number));
			center[c] = middle;
		}
		const radius = Math.sqrt(squared) + this.grow;
		const kept = o[3] as number;
		if (Math.sqrt(moved) + radius <= kept && radius > kept * BOUNDS_SLACK) return;
		for (let c = 0; c < 3; c++) o[c] = center[c] as number;
		o[3] = radius;
		this.object.setBounds(center, radius);
	}

	/**
	 * Doubles the table of pending sub-emitter events, up to one event per sub-emitter for each
	 * record. False when it holds that many already. The table grows while the system warms up,
	 * and then its frames allocate nothing.
	 */
	private growEvents(): boolean {
		const size = Math.min(this.maxEvents, (this.events.length / EVENT_FLOATS) * 2);
		if (size * EVENT_FLOATS <= this.events.length) return false;
		const grown = new Float64Array(size * EVENT_FLOATS);
		grown.set(this.events);
		this.events = grown;
		return true;
	}

	/**
	 * Starts to move the buffer's time back by whole seconds, so the GPU's 32-bit times keep their
	 * precision in a system that runs for hours. The records keep their birth times for now: the
	 * GPU takes the shift off the birth times of the records that `rebaseStep` has not reached.
	 */
	private startRebase(): void {
		const shift = Math.floor(this.time - this.base - this.lifetime[1] - 1);
		if (shift <= 0) return;
		this.base += shift;
		this.shift = shift;
		this.rebased = 0;
	}

	/**
	 * Moves the birth times of the next records to the new base, a share in each frame, so no frame
	 * rewrites and uploads every record. The move ends with the last record.
	 */
	private rebaseStep(): void {
		const count = Math.min(this.emitted, this.buffer.capacity);
		const end = Math.min(this.rebased + REBASE_RECORDS, count);
		this.buffer.shiftRecords(this.rebased, end, this.shift);
		this.rebased = end;
		if (end < count) return;
		this.shift = 0;
		this.rebased = 0;
	}

	/** Removes the system and its particles from the scene. */
	destroy(): void {
		this.buffer.destroy();
	}
}
