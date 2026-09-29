// Seeded random numbers. Hold mode replaces Math.random in the sketch's thread with them, so a sketch
// that places or moves things at random draws the same frame on every run.

/** The seed of the random numbers that hold mode gives the sketch's thread. */
export const HOLD_SEED = 1;

/**
 * A pseudo-random generator (mulberry32). Each call returns the next number in [0, 1), and one seed
 * always gives the same sequence.
 */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Replaces this thread's `Math.random` with a generator seeded with `seed`. Returns a function that
 * gives the thread its own `Math.random` back, unless something else replaced it meanwhile.
 */
export function seedMathRandom(seed: number): () => void {
	const own = Math.random;
	const seeded = seededRandom(seed);
	Math.random = seeded;
	return () => {
		if (Math.random === seeded) Math.random = own;
	};
}
