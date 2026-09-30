// Colors as linear RGB in plain arrays of three numbers. The engine lights in linear color, as
// three.js does with its color management on, and hex colors and sRGB components convert to linear
// with three.js's constants. A helper writes into `out` and returns `out`, so per-frame code
// allocates nothing.

import { hexValue, invalidColor } from './hex';
import type { Vec3Like } from './types';

/** An sRGB component from 0 to 1 as a linear one, as three.js's `SRGBToLinear`. */
export function srgbToLinear(c: number): number {
	return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

/** A linear component from 0 to 1 as an sRGB one, as three.js's `LinearToSRGB`. */
export function linearToSrgb(c: number): number {
	return c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055;
}

/** Linear RGB from three sRGB components from 0 to 1, such as a color picker gives. */
export function fromSrgb<T extends Vec3Like>(out: T, r: number, g: number, b: number): T {
	out[0] = srgbToLinear(r);
	out[1] = srgbToLinear(g);
	out[2] = srgbToLinear(b);
	return out;
}

/**
 * Linear RGB from an sRGB hex color: a string such as `'#ff8800'` or `'#f80'`, or a number such as
 * `0xff8800`. It throws E1204 for anything else.
 */
export function fromHex<T extends Vec3Like>(out: T, hex: string | number): T {
	const value = hexValue(hex);
	if (value < 0) throw invalidColor(hex, 'color.fromHex');
	out[0] = srgbToLinear(((value >> 16) & 255) / 255);
	out[1] = srgbToLinear(((value >> 8) & 255) / 255);
	out[2] = srgbToLinear((value & 255) / 255);
	return out;
}

/**
 * RGB from a hue, a saturation and a lightness, each from 0 to 1, as three.js's `setHSL`. Like
 * three.js, it takes the result as linear RGB, so the same values give the same color in both
 * engines.
 */
export function fromHsl<T extends Vec3Like>(out: T, h: number, s: number, l: number): T {
	// The hue wraps around, and the saturation and lightness stop at 0 and 1, as in three.js.
	const hue = ((h % 1) + 1) % 1;
	const saturation = Math.max(0, Math.min(1, s));
	const lightness = Math.max(0, Math.min(1, l));
	if (saturation === 0) {
		out[0] = lightness;
		out[1] = lightness;
		out[2] = lightness;
		return out;
	}
	const high =
		lightness <= 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const low = 2 * lightness - high;
	// Red, green and blue each read the hue a third of a turn apart.
	for (let i = 0; i < 3; i++) {
		let t = hue + (1 - i) / 3;
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) out[i] = low + (high - low) * 6 * t;
		else if (t < 1 / 2) out[i] = high;
		else if (t < 2 / 3) out[i] = low + (high - low) * 6 * (2 / 3 - t);
		else out[i] = low;
	}
	return out;
}
