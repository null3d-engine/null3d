// Colors in three.js's forms: a hex string such as '#4a8cff' or '#48f', a number such as 0x4a8cff,
// or three sRGB components from 0 to 1. The engine lights in linear color, as three.js does with
// its color management on, so every input converts to linear once, when a call receives it.

import { EngineError } from '../errors/engine-error';

/**
 * A color: a hex string such as `'#4a8cff'` or `'#48f'`, a number such as `0x4a8cff`, or three
 * sRGB components from 0 to 1.
 *
 * @category api/materials
 */
export type ColorInput = string | number | readonly [number, number, number];

/** An sRGB component as a linear one, with three.js's constants. */
export function srgbToLinear(c: number): number {
	return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexComponents(value: number): [number, number, number] {
	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** The sRGB components of a color input, from 0 to 1; throws E1204 for anything else. */
export function srgbComponents(color: ColorInput, call: string): [number, number, number] {
	if (typeof color === 'number') {
		if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) return hexComponents(color);
	} else if (typeof color === 'string') {
		const match = HEX.exec(color);
		const digits = match?.[1];
		if (digits) {
			const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
			return hexComponents(Number.parseInt(full, 16));
		}
	} else if (color.length === 3 && color.every((c) => Number.isFinite(c) && c >= 0 && c <= 1)) {
		return [color[0], color[1], color[2]];
	}
	throw new EngineError('E1204', `${call}() got the color ${JSON.stringify(color)}.`);
}

/** The linear color of an input, times an intensity. */
export function linearColor(
	color: ColorInput,
	call: string,
	intensity = 1,
): [number, number, number] {
	const [r, g, b] = srgbComponents(color, call);
	return [srgbToLinear(r) * intensity, srgbToLinear(g) * intensity, srgbToLinear(b) * intensity];
}
