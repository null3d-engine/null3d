// The random generator of the main entry's `math` namespace, which a sketch can seed. It lives apart
// from the number helpers, because its state is seeded from `Math.random` and the maths entry
// (`@null3d/engine/math`) must hold nothing of the kind.
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
