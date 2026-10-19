import { describe, expect, it } from 'bun:test';
import { computeSkinningWins } from './skinning-probe';

describe('the skinning probe', () => {
	it('keeps the vertex shaders when the two ways cost the same', () => {
		expect(computeSkinningWins(2, 2)).toBe(false);
		expect(computeSkinningWins(2, 2.1)).toBe(false);
	});

	it('picks the pass when it is clearly faster', () => {
		expect(computeSkinningWins(10, 9)).toBe(true);
		expect(computeSkinningWins(10, 8)).toBe(true);
	});

	it('keeps the vertex shaders for a win too small to tell from noise', () => {
		// Three percent faster is inside the margin.
		expect(computeSkinningWins(100, 97)).toBe(false);
		// Five percent faster, but less than the smallest gain that matters.
		expect(computeSkinningWins(0.75, 0.71)).toBe(false);
	});

	it('keeps the vertex shaders when an arm did not finish', () => {
		expect(computeSkinningWins(Number.POSITIVE_INFINITY, 1)).toBe(false);
		expect(computeSkinningWins(1, Number.POSITIVE_INFINITY)).toBe(false);
		expect(computeSkinningWins(Number.NaN, 1)).toBe(false);
	});
});
