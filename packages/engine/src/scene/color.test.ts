import { describe, expect, it } from 'bun:test';
import { linearColor, srgbComponents, srgbToLinear } from './color';

describe('colors', () => {
	it('read hex strings, short hex strings, numbers and sRGB components alike', () => {
		const expected: [number, number, number] = [0x4a / 255, 0x8c / 255, 1];
		expect(srgbComponents('#4a8cff', 'test')).toEqual(expected);
		expect(srgbComponents('#4A8CFF', 'test')).toEqual(expected);
		expect(srgbComponents(0x4a8cff, 'test')).toEqual(expected);
		expect(srgbComponents('#48f', 'test')).toEqual(srgbComponents('#4488ff', 'test'));
		expect(srgbComponents([0.25, 0.5, 1], 'test')).toEqual([0.25, 0.5, 1]);
	});

	it('convert to linear with three.js constants, and scale by the intensity', () => {
		expect(srgbToLinear(0)).toBe(0);
		expect(srgbToLinear(1)).toBeCloseTo(1, 6);
		expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
		expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 6);
		const [r, g, b] = linearColor('#ffffff', 'test', 3);
		expect([r, g, b].map((c) => Math.round(c * 1e5) / 1e5)).toEqual([3, 3, 3]);
	});

	it('refuse other forms with E1204', () => {
		for (const bad of ['blue', '#12345', 0x1000000, -1, 1.5, [0, 0, 2], [0, 0]] as const)
			expect(() => srgbComponents(bad as never, 'setBackground')).toThrow('E1204');
	});
});
