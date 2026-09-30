// Hold mode's random numbers. It seeds the engine's generator, math.random, and routes the thread's
// Math.random to the same generator, so a sketch that places or moves things at random draws the
// same frame on every run.

import { random, seed } from '../math/math';

/** The seed of the random numbers that hold mode gives the sketch's thread. */
export const HOLD_SEED = 1;

/**
 * Seeds this thread's `math.random` with `value`, and makes `Math.random` draw from it too. Returns
 * a function that gives the thread its own `Math.random` back, unless something else replaced it
 * meanwhile.
 */
export function seedMathRandom(value: number): () => void {
	const own = Math.random;
	seed(value);
	Math.random = random;
	return () => {
		if (Math.random === random) Math.random = own;
	};
}
