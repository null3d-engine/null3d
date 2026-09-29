import { beforeAll, describe, expect, it } from 'bun:test';
import { Color, SRGBColorSpace } from 'three';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as color from './color';

const rgb = (c: Color) => [c.r, c.g, c.b];
const COMPONENTS = [0, 0.001, 0.02, 0.04045, 0.2, 0.5, 0.73, 1];

beforeAll(() => setErrorFixes(ERROR_FIXES));

describe('color', () => {
	it("converts components between sRGB and linear with three.js's constants", () => {
		for (const c of COMPONENTS) {
			const linear = new Color(c, c, c).convertSRGBToLinear().r;
			expect(color.srgbToLinear(c)).toBe(linear);
			expect(color.linearToSrgb(c)).toBe(new Color(c, c, c).convertLinearToSRGB().r);
			expect(color.linearToSrgb(color.srgbToLinear(c))).toBeCloseTo(c, 4);
		}
		expect(color.srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
	});

	it('matches three.js for hex colors, sRGB components, and hue, saturation and lightness', () => {
		const out = color.fromHex([0, 0, 0], 0);
		for (const hex of [0x000000, 0xffffff, 0x4a8cff, 0xff8800, 0x123456])
			expect(color.fromHex(out, hex)).toEqual(rgb(new Color(hex)));
		expect(color.fromHex(out, '#4a8cff')).toEqual(rgb(new Color(0x4a8cff)));
		expect(color.fromHex(out, '#4A8CFF')).toEqual(rgb(new Color(0x4a8cff)));
		expect(color.fromHex(out, '#f80')).toEqual(rgb(new Color(0xff8800)));
		for (const c of COMPONENTS)
			expect(color.fromSrgb(out, c, 1 - c, c / 2)).toEqual(
				rgb(new Color().setRGB(c, 1 - c, c / 2, SRGBColorSpace)),
			);
		for (const [h, s, l] of [
			[0, 1, 0.5],
			[0.3, 0.7, 0.4],
			[0.62, 0.5, 0.75],
			[1.4, 2, -1],
			[-0.2, 0, 0.3],
			[0.95, 0.25, 0.5],
		] as const)
			expect(color.fromHsl(out, h, s, l)).toEqual(rgb(new Color().setHSL(h, s, l)));
	});

	it('writes into typed arrays and returns the array it writes', () => {
		const typed = new Float32Array(3);
		expect(color.fromHex(typed, 0xff8800)).toBe(typed);
		expect([...typed]).toEqual(rgb(new Color(0xff8800)).map(Math.fround));
	});

	it('refuses a hex color it cannot read with E1204', () => {
		for (const bad of ['blue', '#12345', '#ff880', 'ff8800', '#gg8800', 0x1000000, -1, 1.5])
			expect(() => color.fromHex([0, 0, 0], bad)).toThrow(
				`E1204: color.fromHex() got the color ${JSON.stringify(bad)}.`,
			);
	});
});
