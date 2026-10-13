// Colors in three.js's forms: a hex string such as '#4a8cff' or '#48f', a number such as 0x4a8cff,
// or three linear components from 0 to 1. The engine lights in linear color, as three.js does with
// its color management on. Hex values are sRGB, so they convert to linear once, when a call
// receives them, with the public color helpers. Three components are linear already, as three.js's
// `Color.setRGB` reads them and as the color helpers give them.

import { srgbToLinear } from '../math/color';
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

/** The linear value of each 8-bit sRGB level, so a conversion reads a table and calls nothing. */
const LEVELS = Float64Array.from({ length: 256 }, (_, level) => srgbToLinear(level / 255));

/**
 * Writes the linear color of an input into `out`, from place `at` on, and returns `out`. A hex
 * string or number reads its levels from a table, and three components copy, so nothing allocates
 * and no fraction crosses a call: per-frame code converts a color into an array it keeps. It
 * throws E1204 for anything else.
 */
export function writeLinearColor<T extends { [index: number]: number }>(
	out: T,
	color: ColorInput,
	call: string,
	at = 0,
): T {
	if (typeof color === 'string' || typeof color === 'number') {
		// The helper gets the number that the string holds, so it reads no string a second time.
		const value = hexValue(color);
		if (value < 0) throw invalidColor(color, call);
		out[at] = LEVELS[(value >> 16) & 255] as number;
		out[at + 1] = LEVELS[(value >> 8) & 255] as number;
		out[at + 2] = LEVELS[value & 255] as number;
		return out;
	}
	if (color?.length !== 3) throw invalidColor(color, call);
	const r = color[0];
	const g = color[1];
	const b = color[2];
	// A component is a number from 0 to 1, a range that NaN and the infinities fall outside.
	if (!(r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1)) throw invalidColor(color, call);
	out[at] = r;
	out[at + 1] = g;
	out[at + 2] = b;
	return out;
}

/** The linear color of an input in a new array, for code that runs once. It throws E1204 for anything else. */
export function linearColor(color: ColorInput, call: string): [number, number, number] {
	return writeLinearColor([0, 0, 0], color, call);
}
