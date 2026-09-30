import { afterEach, describe, expect, it } from 'bun:test';
import { MathUtils } from 'three';
import * as math from './math';

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

/**
 * A second copy of the math module in this thread, as a production build gives the sketch worker:
 * one copy in the engine's worker code, and one in the sketch's bundle. Bun loads a path with a
 * query as a module of its own.
 */
async function secondCopy(): Promise<typeof import('./math')> {
	return await import(`${import.meta.dirname}/math.ts?second-copy`);
}

const own = Math.random;
afterEach(() => {
	Math.random = own;
});

describe('math', () => {
	it("matches three.js's MathUtils for the calls they share", () => {
		const values = [-2.5, -1, -0.25, 0, 0.3, 0.5, 1, 1.75, 7];
		for (const x of values) {
			expect(math.clamp(x, -1, 1.5)).toBe(MathUtils.clamp(x, -1, 1.5));
			expect(math.lerp(3, -9, x)).toBe(MathUtils.lerp(3, -9, x));
			expect(math.inverseLerp(-4, 6, x)).toBe(MathUtils.inverseLerp(-4, 6, x));
			expect(math.mapLinear(x, -1, 3, 10, 20)).toBe(MathUtils.mapLinear(x, -1, 3, 10, 20));
			expect(math.damp(x, 10, 4, 1 / 60)).toBe(MathUtils.damp(x, 10, 4, 1 / 60));
			expect(math.smoothstep(x, -0.5, 1.5)).toBe(MathUtils.smoothstep(x, -0.5, 1.5));
			expect(math.degToRad(x * 90)).toBe(MathUtils.degToRad(x * 90));
			expect(math.radToDeg(x)).toBe(MathUtils.radToDeg(x));
			expect(math.euclideanModulo(x, 0.75)).toBe(MathUtils.euclideanModulo(x, 0.75));
		}
	});

	it('gives reference values', () => {
		expect(math.clamp(5, 0, 1)).toBe(1);
		expect(math.lerp(10, 20, 0.25)).toBe(12.5);
		expect(math.lerp(0.1, 0.7, 1)).toBe(0.7);
		expect(math.inverseLerp(10, 20, 12.5)).toBe(0.25);
		expect(math.inverseLerp(4, 4, 9)).toBe(0);
		expect(math.mapLinear(5, 0, 10, 100, 200)).toBe(150);
		expect(math.smoothstep(0.5, 0, 1)).toBe(0.5);
		expect(math.degToRad(180)).toBe(Math.PI);
		expect(math.radToDeg(Math.PI / 2)).toBe(90);
		expect(math.euclideanModulo(-1, 3)).toBe(2);
		// Damping covers the same share of the gap in one step of 1/30 s as in two of 1/60 s.
		const once = math.damp(0, 1, 5, 1 / 30);
		const twice = math.damp(math.damp(0, 1, 5, 1 / 60), 1, 5, 1 / 60);
		expect(once).toBeCloseTo(twice, 15);
		expect(once).toBeCloseTo(1 - Math.exp(-5 / 30), 15);
	});

	it('draws the published mulberry32 sequence from a seed, as three.js does', () => {
		for (const seed of [0, 1, 7, 0x7fffffff, 0xffffffff]) {
			math.seed(seed);
			const ours = draws(math.random, 1000);
			expect(ours).toEqual(draws(referenceMulberry32(seed), 1000));
			const theirs = [MathUtils.seededRandom(seed), ...draws(() => MathUtils.seededRandom(), 999)];
			expect(ours).toEqual(theirs);
		}
		math.seed(1);
		const numbers = draws(math.random, 10_000);
		expect(numbers.every((n) => n >= 0 && n < 1)).toBe(true);
		math.seed(2);
		expect(draws(math.random, 10)).not.toEqual(numbers.slice(0, 10));
	});

	it("draws randFloat, randInt and randFloatSpread from the generator, with three.js's arithmetic", () => {
		math.seed(42);
		const ours = [
			math.randFloat(-3, 5),
			math.randInt(-2, 4),
			math.randFloatSpread(10),
			math.randInt(0, 0),
		];
		// three.js draws from Math.random: give it the same seeded numbers.
		math.seed(42);
		Math.random = math.random;
		const theirs = [
			MathUtils.randFloat(-3, 5),
			MathUtils.randInt(-2, 4),
			MathUtils.randFloatSpread(10),
			MathUtils.randInt(0, 0),
		];
		expect(ours).toEqual(theirs);
		math.seed(3);
		const ints = draws(() => math.randInt(-2, 2), 2000);
		expect(new Set(ints)).toEqual(new Set([-2, -1, 0, 1, 2]));
		const spread = draws(() => math.randFloatSpread(4), 2000);
		expect(spread.every((n) => n > -2 && n <= 2)).toBe(true);
	});

	it('keeps one generator per thread, which every copy of the module draws from', async () => {
		const other = await secondCopy();
		expect(other.random).not.toBe(math.random);
		math.seed(99);
		const expected = draws(referenceMulberry32(99), 4);
		expect([math.random(), other.random(), math.random(), other.random()]).toEqual(expected);
		other.seed(5);
		expect(math.random()).toBe(referenceMulberry32(5)());
	});
});
