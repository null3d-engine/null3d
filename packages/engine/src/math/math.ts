// Number helpers with three.js's names and arithmetic, and a random generator that a sketch can seed.
//
// The generator's state is one per thread. A production build can hold two copies of this module in
// one thread: the engine's worker code holds one, and a sketch's bundle holds another. So the state
// lives on the thread's global object under a registered symbol, where every copy finds it. Hold mode
// seeds it through one copy, and the sketch draws the same numbers through the other.

/** The key of the thread's random state on its global object. */
const RANDOM_STATE = Symbol.for('null3d.random');

/** The thread's global object, which holds the random state for every copy of this module. */
const thread = globalThis as { [RANDOM_STATE]?: Uint32Array };

/** This copy's reference to the thread's random state, found or made on first use. */
let state: Uint32Array | undefined;

/** The thread's random state. The first copy to need it makes it, with an unpredictable seed. */
function randomState(): Uint32Array {
	if (!state) {
		state = thread[RANDOM_STATE];
		if (!state) {
			state = new Uint32Array(1);
			state[0] = Math.random() * 4294967296;
			thread[RANDOM_STATE] = state;
		}
	}
	return state;
}

/** `value` limited to the range from `min` to `max`. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** The number a fraction `t` of the way from `x` to `y`. */
export function lerp(x: number, y: number, t: number): number {
	return (1 - t) * x + t * y;
}

/** The fraction of the way from `x` to `y` at which `value` lies: the reverse of `lerp`. It is 0 when `x` equals `y`. */
export function inverseLerp(x: number, y: number, value: number): number {
	return x === y ? 0 : (value - x) / (y - x);
}

/** `x` moved from the range `a1` to `a2` onto the range `b1` to `b2`. */
export function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
	return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}

/**
 * Moves `x` toward `y` by an amount that suits the frame's step `dt` in seconds, so the motion looks
 * the same at every frame rate. A larger `lambda` moves faster.
 */
export function damp(x: number, y: number, lambda: number, dt: number): number {
	const t = 1 - Math.exp(-lambda * dt);
	return (1 - t) * x + t * y;
}

/** 0 when `x` is at or below `min`, 1 at or above `max`, and a smooth curve between them. */
export function smoothstep(x: number, min: number, max: number): number {
	if (x <= min) return 0;
	if (x >= max) return 1;
	const t = (x - min) / (max - min);
	return t * t * (3 - 2 * t);
}

/** An angle in degrees as radians. */
export function degToRad(degrees: number): number {
	return degrees * (Math.PI / 180);
}

/** An angle in radians as degrees. */
export function radToDeg(radians: number): number {
	return radians * (180 / Math.PI);
}

/** The remainder of `n` divided by `m`, with the sign of `m`. For example, -1 modulo 3 is 2. */
export function euclideanModulo(n: number, m: number): number {
	return ((n % m) + m) % m;
}

/**
 * The next random number, from 0 up to but not including 1. Each thread has one generator, which
 * starts from an unpredictable seed. Hold mode seeds it, so a sketch that draws its numbers from it
 * draws the same frame on every run. The generator is mulberry32, as in three.js's `seededRandom`.
 */
export function random(): number {
	const s = state ?? randomState();
	const next = ((s[0] as number) + 0x6d2b79f5) >>> 0;
	s[0] = next;
	let t = Math.imul(next ^ (next >>> 15), next | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Starts `random` again from a seed, an integer. The same seed always gives the same numbers:
 * `math.seed(s)` followed by `math.random()` gives what three.js's `seededRandom(s)` gives.
 */
export function seed(value: number): void {
	(state ?? randomState())[0] = value;
}

/** A random number from `low` up to but not including `high`. */
export function randFloat(low: number, high: number): number {
	return low + random() * (high - low);
}

/** A random integer from `low` to `high`, both included. */
export function randInt(low: number, high: number): number {
	return low + Math.floor(random() * (high - low + 1));
}

/** A random number from `-range / 2` to `range / 2`. */
export function randFloatSpread(range: number): number {
	return range * (0.5 - random());
}
