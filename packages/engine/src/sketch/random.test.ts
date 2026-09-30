import { afterEach, describe, expect, it } from 'bun:test';
import { random, seed } from '../math/math';
import { HOLD_SEED, seedMathRandom } from './random';

const draws = (generator: () => number, count: number) => Array.from({ length: count }, generator);

/** The numbers that math.random gives from `value`. */
function seeded(value: number, count: number): number[] {
	seed(value);
	return draws(random, count);
}

const own = Math.random;
afterEach(() => {
	Math.random = own;
});

describe('seedMathRandom', () => {
	it('seeds math.random and routes Math.random to it, until the thread gets its own back', () => {
		const expected = seeded(HOLD_SEED, 6);
		const restore = seedMathRandom(HOLD_SEED);
		// Both draw from one generator, so each takes the next number of one sequence.
		expect([Math.random(), random(), Math.random(), random(), Math.random(), random()]).toEqual(
			expected,
		);
		restore();
		expect(Math.random).toBe(own);
	});

	it('leaves a Math.random that something else set meanwhile', () => {
		const restore = seedMathRandom(HOLD_SEED);
		const other = () => 0.5;
		Math.random = other;
		restore();
		expect(Math.random).toBe(other);
	});
});
