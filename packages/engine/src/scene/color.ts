// Colors in three.js's forms: a hex string such as '#4a8cff' or '#48f', a number such as 0x4a8cff,
// or three sRGB components from 0 to 1. The engine lights in linear color, as three.js does with
// its color management on, so every input converts to linear once, when a call receives it, with
// the public color helpers.

import { fromHex, fromSrgb } from '../math/color';
import { hexValue, invalidColor } from '../math/hex';

/**
 * A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three sRGB
 * components from 0 to 1.
 *
 * @category api/materials
 */
export type ColorInput = string | number | readonly [number, number, number];

const isComponent = (c: number) => Number.isFinite(c) && c >= 0 && c <= 1;

/** The linear color of an input, times an intensity. It throws E1204 for anything else. */
export function linearColor(
	color: ColorInput,
	call: string,
	intensity = 1,
): [number, number, number] {
	const out: [number, number, number] = [0, 0, 0];
	if (typeof color === 'string' || typeof color === 'number') {
		// The helper gets the number that the string holds, so it reads no string a second time.
		const value = hexValue(color);
		if (value < 0) throw invalidColor(color, call);
		fromHex(out, value);
	} else if (color?.length === 3 && color.every(isComponent)) {
		fromSrgb(out, color[0], color[1], color[2]);
	} else throw invalidColor(color, call);
	out[0] *= intensity;
	out[1] *= intensity;
	out[2] *= intensity;
	return out;
}
