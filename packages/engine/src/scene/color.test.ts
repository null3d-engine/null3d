import { describe, expect, it } from 'bun:test';
import { fromHex, fromHsl } from '../math/color';
import { create } from '../math/vec3';
import { linearColor, writeLinearColor } from './color';

describe('linearColor', () => {
	it('reads hex strings, short hex strings and numbers alike, as sRGB', () => {
		const expected = fromHex(create(), 0x4a8cff);
		expect(linearColor('#4a8cff', 'test')).toEqual(expected);
		expect(linearColor('#4A8CFF', 'test')).toEqual(expected);
		expect(linearColor(0x4a8cff, 'test')).toEqual(expected);
		expect(linearColor('#48f', 'test')).toEqual(linearColor('#4488ff', 'test'));
	});

	it('reads three components as linear already, as three.js Color.setRGB does', () => {
		expect(linearColor([0.25, 0.5, 1], 'test')).toEqual([0.25, 0.5, 1]);
		const hsl = fromHsl(create(), 0.6, 0.7, 0.5);
		expect(linearColor([hsl[0], hsl[1], hsl[2]], 'test')).toEqual([hsl[0], hsl[1], hsl[2]]);
	});

	it('gives every 8-bit level the value of the sRGB curve, exactly', () => {
		for (let level = 0; level < 256; level++) {
			const hex = level * 0x010101;
			expect(linearColor(hex, 'test')).toEqual([...fromHex(create(), hex)]);
		}
	});

	it('writes into an array from a place, and leaves its other values', () => {
		const out = new Float64Array([9, 9, 9, 9, 9]);
		expect(writeLinearColor(out, 0x4a8cff, 'test', 1)).toBe(out);
		expect([...out]).toEqual([9, ...fromHex(create(), 0x4a8cff), 9]);
		writeLinearColor(out, [0.25, 0.5, 1], 'test', 2);
		expect([...out.subarray(2)]).toEqual([0.25, 0.5, 1]);
	});

	it('refuses other forms with E1204, naming the call', () => {
		const bad3 = [0, Number.NaN, 0];
		for (const bad of [
			'blue',
			'#12345',
			0x1000000,
			-1,
			1.5,
			[0, 0, 2],
			[0, 0],
			bad3,
			null,
		] as const)
			expect(() => linearColor(bad as never, 'setBackground')).toThrow(
				`E1204: setBackground() got the color ${JSON.stringify(bad)}.`,
			);
	});
});
