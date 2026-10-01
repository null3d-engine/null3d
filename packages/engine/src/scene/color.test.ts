import { describe, expect, it } from 'bun:test';
import { fromHex, fromHsl } from '../math/color';
import { create } from '../math/vec3';
import { linearColor } from './color';

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

	it('scales the linear color by the intensity', () => {
		const [r, g, b] = linearColor('#ffffff', 'test', 3);
		expect([r, g, b].map((c) => Math.round(c * 1e5) / 1e5)).toEqual([3, 3, 3]);
		expect(linearColor([1, 0.5, 0], 'test', 2)).toEqual([2, 1, 0]);
	});

	it('refuses other forms with E1204, naming the call', () => {
		for (const bad of ['blue', '#12345', 0x1000000, -1, 1.5, [0, 0, 2], [0, 0], null] as const)
			expect(() => linearColor(bad as never, 'setBackground')).toThrow(
				`E1204: setBackground() got the color ${JSON.stringify(bad)}.`,
			);
	});
});
