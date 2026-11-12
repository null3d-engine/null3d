import { describe, expect, test } from 'bun:test';
import { readSheathTarget, SHEATH_TARGET_KEY, sheathTargetOf } from './sheath.ts';

describe('a species sheath target', () => {
	test('is absent when the review data names none', () => {
		expect(readSheathTarget(undefined)).toBeUndefined();
		expect(readSheathTarget(null)).toBeUndefined();
		expect(sheathTargetOf({})).toBeUndefined();
	});

	test('reads a single colour at both ends with equal bands', () => {
		expect(readSheathTarget([0.15, 0.08, 0.03])).toEqual({
			foot: [0.15, 0.08, 0.03],
			collar: [0.15, 0.08, 0.03],
			reach: 0.5,
		});
	});

	test('reads the graded foot and collar and their reach', () => {
		const target = {
			foot: [0.15, 0.08, 0.03] as const,
			collar: [0.5, 0.45, 0.3] as const,
			reach: 0.8,
		};
		expect(sheathTargetOf({ [SHEATH_TARGET_KEY]: target })).toEqual(target);
	});

	test('refuses a colour with a missing channel or outside 0 to 1', () => {
		expect(() => readSheathTarget([0.1, 0.2])).toThrow('Rgb');
		expect(() => readSheathTarget([0.1, 0.2, 1.1])).toThrow('Rgb');
		expect(() =>
			readSheathTarget({ foot: [0.1, 0.2], collar: [0.3, 0.4, 0.5], reach: 0.5 }),
		).toThrow('foot and collar');
	});

	test('refuses a reach outside 0 to 1', () => {
		expect(() =>
			readSheathTarget({ foot: [0.1, 0.2, 0.3], collar: [0.4, 0.5, 0.6], reach: 1.5 }),
		).toThrow('reach');
	});
});
