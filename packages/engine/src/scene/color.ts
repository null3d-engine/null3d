// Colors in three.js's forms: a hex string such as '#4a8cff' or '#48f', a number such as 0x4a8cff,
// or three linear components from 0 to 1. The engine lights in linear color, as three.js does with
// its color management on. Hex values are sRGB, so they convert to linear once, when a call
// receives them, with the public color helpers. Three components are linear already, as three.js's
// `Color.setRGB` reads them and as the color helpers give them.

import { fromHex } from '../math/color';
import { hexValue, invalidColor } from '../math/hex';

/**
 * A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three
 * linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in
 * three.js, and the engine converts them to linear values. The color helpers, such as
 * `color.fromHsl`, give linear components.
 *
 * @category api/materials
 */
export type ColorInput = string | number | readonly [number, number, number];

/** True for a component that a color input takes: a finite number from 0 to 1. */
export const isComponent = (c: number): boolean => Number.isFinite(c) && c >= 0 && c <= 1;

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
		out[0] = color[0];
		out[1] = color[1];
		out[2] = color[2];
	} else throw invalidColor(color, call);
	out[0] *= intensity;
	out[1] *= intensity;
	out[2] *= intensity;
	return out;
}
