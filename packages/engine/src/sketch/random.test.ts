import { describe, expect, it } from 'bun:test';
import { HOLD_SEED, seededRandom, seedMathRandom } from './random';

/** The published mulberry32 (github.com/bryc/code, jshash/PRNGs.md), kept as an outside reference. */
function referenceMulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const draws = (random: () => number, count: number) => Array.from({ length: count }, random);

describe('seededRandom', () => {
	it('matches the published generator', () => {
		for (const seed of [0, 1, 7, 0x7fffffff, 0xffffffff])
			expect(draws(seededRandom(seed), 1000)).toEqual(draws(referenceMulberry32(seed), 1000));
	});

	it('gives the same numbers for a seed, in [0, 1), and other numbers for another seed', () => {
		const numbers = draws(seededRandom(HOLD_SEED), 10_000);
		expect(numbers).toEqual(draws(seededRandom(HOLD_SEED), 10_000));
		expect(numbers.every((n) => n >= 0 && n < 1)).toBe(true);
		expect(draws(seededRandom(HOLD_SEED + 1), 10)).not.toEqual(numbers.slice(0, 10));
	});
});

describe('seedMathRandom', () => {
	it('seeds Math.random until the thread gets its own back', () => {
		const own = Math.random;
		const restore = seedMathRandom(HOLD_SEED);
		try {
			expect(draws(Math.random, 5)).toEqual(draws(seededRandom(HOLD_SEED), 5));
		} finally {
			restore();
		}
		expect(Math.random).toBe(own);
	});

	it('leaves a Math.random that something else set meanwhile', () => {
		const own = Math.random;
		const first = seedMathRandom(1);
		const second = seedMathRandom(2);
		const secondSeeded = Math.random;
		first();
		expect(Math.random).toBe(secondSeeded);
		second();
		expect(Math.random).not.toBe(secondSeeded);
		Math.random = own;
	});
});
