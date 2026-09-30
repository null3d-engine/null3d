import { describe, expect, it } from 'bun:test';
import { linearColor, srgbToLinear } from './color';

/** A color rounded to five places, so float noise does not fail a comparison. */
const rounded = (color: [number, number, number]) => color.map((c) => Math.round(c * 1e5) / 1e5);

describe('colors', () => {
	it('read hex strings, short hex strings and numbers alike, as sRGB', () => {
		const expected = [0x4a / 255, 0x8c / 255, 1].map(srgbToLinear);
		expect(linearColor('#4a8cff', 'test')).toEqual(expected as [number, number, number]);
		expect(linearColor('#4A8CFF', 'test')).toEqual(linearColor('#4a8cff', 'test'));
		expect(linearColor(0x4a8cff, 'test')).toEqual(linearColor('#4a8cff', 'test'));
		expect(linearColor('#48f', 'test')).toEqual(linearColor('#4488ff', 'test'));
	});

	it('read three components as linear already, as three.js Color.setRGB does', () => {
		expect(linearColor([0.25, 0.5, 1], 'test')).toEqual([0.25, 0.5, 1]);
		expect(linearColor([1, 0.5, 0], 'test', 2)).toEqual([2, 1, 0]);
	});

	it('convert hex values to linear with three.js constants, and scale by the intensity', () => {
		expect(srgbToLinear(0)).toBe(0);
		expect(srgbToLinear(1)).toBeCloseTo(1, 6);
		expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
		expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 6);
		expect(rounded(linearColor('#ffffff', 'test', 3))).toEqual([3, 3, 3]);
	});

	it('refuse other forms with E1204', () => {
		for (const bad of ['blue', '#12345', 0x1000000, -1, 1.5, [0, 0, 2], [0, 0]] as const)
			expect(() => linearColor(bad as never, 'setBackground')).toThrow('E1204');
	});
});
