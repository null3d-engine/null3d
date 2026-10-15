import { describe, expect, test } from 'bun:test';
import { generator, random, seed } from './math';
import { Noise } from './noise';

describe('seeded generators', () => {
	test('a seed gives the same numbers on every run, and another seed others', () => {
		const [a, b, c] = [generator(7), generator(7), generator(8)];
		const first = Array.from({ length: 5 }, a);
		expect(Array.from({ length: 5 }, b)).toEqual(first);
		expect(Array.from({ length: 5 }, c)).not.toEqual(first);
		expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
	});

	test('a generator gives what math.seed and math.random give, and leaves them alone', () => {
		seed(11);
		const own = generator(11);
		const expected = Array.from({ length: 4 }, () => random());
		seed(11);
		expect(Array.from({ length: 4 }, own)).toEqual(expected);
		expect(random()).toBe(expected[0] as number);
	});
});

describe('noise', () => {
	test('the same seed gives the same noise, and another seed other noise', () => {
		const [a, b, c] = [new Noise(3), new Noise(3), new Noise(4)];
		expect(b.fbm3(1.3, 2.7, 0.4, 3)).toBe(a.fbm3(1.3, 2.7, 0.4, 3));
		expect(c.fbm3(1.3, 2.7, 0.4, 3)).not.toBe(a.fbm3(1.3, 2.7, 0.4, 3));
	});

	test('noise with a period repeats after it, at every octave', () => {
		const noise = new Noise(3);
		for (const [x, y] of [
			[0.3, 0.7],
			[2.25, 5.5],
		] as const) {
			expect(noise.value2(x + 8, y, 8)).toBeCloseTo(noise.value2(x, y, 8), 6);
			expect(noise.fbm2(x, y + 4, 4, 4)).toBeCloseTo(noise.fbm2(x, y, 4, 4), 6);
		}
	});

	test('values stay from -1 to 1, and lattice points hold the table values', () => {
		const noise = new Noise(5);
		let most = 0;
		for (let i = 0; i < 2000; i++) {
			most = Math.max(most, Math.abs(noise.value3(i * 0.37, i * 0.11, i * 0.53)));
			most = Math.max(most, Math.abs(noise.value2(i * 0.29, i * 0.61)));
		}
		expect(most).toBeLessThanOrEqual(1);
		expect(most).toBeGreaterThan(0.5);
		// At a lattice point the fade is 0, so the plane noise is that point's value.
		expect(noise.value2(4, 9)).toBe(noise.value3(4, 9, 0));
	});
});
