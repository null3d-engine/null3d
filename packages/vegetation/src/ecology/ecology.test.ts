import { describe, expect, test } from 'bun:test';
import { checkRules, type EcoInput, type EcoRule, ruleScore, toleranceScore } from './ecology';

/** A rule with one curve for the water's distance, and whatever else the test adds. */
function ruleAt(distance: readonly [number, number, number, number]): EcoRule {
	return {
		species: 'test',
		layer: 'ground',
		spacing: 1,
		radius: 0.5,
		tolerances: [
			{
				input: 'distanceToWater',
				min: distance[0],
				best: distance[1],
				worst: distance[2],
				max: distance[3],
			},
		],
	};
}

/** Reads one input, with every other input at zero. */
function reader(input: EcoInput, value: number): (other: EcoInput) => number {
	return (other) => (other === input ? value : 0);
}

describe('the tolerance curves', () => {
	test('scores the best range one and everything past the ends zero', () => {
		const curve = { input: 'slope' as const, min: 0, best: 0.2, worst: 0.6, max: 1 };
		expect(toleranceScore(curve, -0.1)).toBe(0);
		expect(toleranceScore(curve, 0)).toBe(0);
		expect(toleranceScore(curve, 0.1)).toBeCloseTo(0.5, 6);
		expect(toleranceScore(curve, 0.2)).toBe(1);
		expect(toleranceScore(curve, 0.4)).toBe(1);
		expect(toleranceScore(curve, 0.8)).toBeCloseTo(0.5, 6);
		expect(toleranceScore(curve, 1)).toBe(0);
		expect(toleranceScore(curve, 1.5)).toBe(0);
	});

	test('reads a curve whose best range is written backwards', () => {
		const curve = { input: 'northness' as const, min: -1, best: 1, worst: -1, max: 1.01 };
		expect(toleranceScore(curve, 1)).toBe(1);
		expect(toleranceScore(curve, 0)).toBe(1);
		expect(toleranceScore(curve, -1)).toBe(1);
		expect(toleranceScore(curve, -1.1)).toBe(0);
	});

	test('takes the lowest curve of a rule, so every need must hold', () => {
		const rule: EcoRule = {
			species: 'test',
			layer: 'ground',
			spacing: 1,
			radius: 0.5,
			tolerances: [
				{ input: 'wetness', min: 0, best: 1, worst: 1, max: 2 },
				{ input: 'slope', min: 0, best: 0.1, worst: 0.1, max: 1 },
			],
		};
		expect(ruleScore(rule, reader('wetness', 1))).toBe(0);
		const fine = (input: EcoInput) => (input === 'wetness' ? 1 : 0.1);
		expect(ruleScore(rule, fine)).toBe(1);
		const steep = (input: EcoInput) => (input === 'wetness' ? 1 : 0.55);
		expect(ruleScore(rule, steep)).toBeCloseTo(0.5, 6);
	});

	test('refuses rules that cannot place plants', () => {
		expect(() => checkRules([ruleAt([0, 1, 2, 3])])).not.toThrow();
		expect(() => checkRules([{ ...ruleAt([0, 1, 2, 3]), spacing: 0 }])).toThrow(/spacing/);
		expect(() => checkRules([{ ...ruleAt([0, 1, 2, 3]), layer: 'young' }])).toThrow(/cluster/);
		expect(() => checkRules([ruleAt([3, 2, 1, 0])])).toThrow(/reach further/);
	});
});
