// Colors in three.js's forms: a hex string such as '#4a8cff' or '#48f', a number such as 0x4a8cff,
// or three linear components from 0 to 1. The engine lights in linear color, as three.js does with
// its color management on. Hex values are sRGB, so they convert to linear once, when a call
// receives them, and three components are linear already, as three.js's `Color.setRGB` reads them.

import { EngineError } from '../errors/engine-error';

/**
 * A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three
 * linear components from 0 to 1, such as `[1, 0.26, 0.05]`. Hex values are sRGB, as on the web and in
 * three.js, and the engine converts them to linear values.
 *
 * @category api/materials
 */
export type ColorInput = string | number | readonly [number, number, number];

/** An sRGB component as a linear one, with three.js's constants. */
export function srgbToLinear(c: number): number {
	return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The sRGB components of a hex value, from 0 to 1. */
function hexComponents(value: number): [number, number, number] {
	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** The number a hex string or number holds, or -1 for anything else. */
function hexValue(color: string | number): number {
	if (typeof color === 'number')
		return Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : -1;
	const digits = HEX.exec(color)?.[1];
	if (!digits) return -1;
	const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
	return Number.parseInt(full, 16);
}

const isComponent = (c: number) => Number.isFinite(c) && c >= 0 && c <= 1;

/** The linear color of an input, times an intensity. It throws E1204 for anything else. */
export function linearColor(
	color: ColorInput,
	call: string,
	intensity = 1,
): [number, number, number] {
	if (typeof color === 'string' || typeof color === 'number') {
		const value = hexValue(color);
		if (value >= 0) {
			const [r, g, b] = hexComponents(value);
			return [
				srgbToLinear(r) * intensity,
				srgbToLinear(g) * intensity,
				srgbToLinear(b) * intensity,
			];
		}
	} else if (color?.length === 3 && color.every(isComponent)) {
		return [color[0] * intensity, color[1] * intensity, color[2] * intensity];
	}
	throw new EngineError('E1204', `${call}() got the color ${JSON.stringify(color)}.`);
}
