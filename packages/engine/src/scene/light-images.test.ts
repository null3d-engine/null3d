import { describe, expect, it } from 'bun:test';
import { srgbToLinear } from '../math/color';
import { toHalfFloat } from './half-float';
import {
	LIGHT_IMAGE_HALVES,
	LIGHT_IMAGE_LEVELS,
	LIGHT_IMAGE_SIZE,
	prepareLightImage,
} from './light-images';

/** Pixels of `width` by `height`, each from `color(x, y)`, as sRGB bytes. */
function pixels(width: number, height: number, color: (x: number, y: number) => number[]) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
	return { width, height, data };
}

describe('prepareLightImage', () => {
	it('fills every level down to one texel', () => {
		expect(LIGHT_IMAGE_HALVES).toBe(
			4 *
				Array.from({ length: LIGHT_IMAGE_LEVELS }, (_, k) => (LIGHT_IMAGE_SIZE >> k) ** 2).reduce(
					(a, b) => a + b,
				),
		);
	});

	it('keeps an even color through every level, in linear light', () => {
		const out = new Uint16Array(LIGHT_IMAGE_HALVES);
		prepareLightImage(
			pixels(3, 5, () => [200, 100, 0]),
			out,
		);
		const texel = [srgbToLinear(200 / 255), srgbToLinear(100 / 255), 0, 1].map(toHalfFloat);
		for (let k = 0; k < out.length; k += 4) expect([...out.subarray(k, k + 4)]).toEqual(texel);
	});

	it('puts the top row of the pixels at the top of the light and averages each level', () => {
		const out = new Uint16Array(LIGHT_IMAGE_HALVES);
		// White above, black below: the last row of level 0 is white, the first black.
		prepareLightImage(
			pixels(256, 256, (_, y) => (y < 128 ? [255, 255, 255] : [0, 0, 0])),
			out,
		);
		const size = LIGHT_IMAGE_SIZE;
		expect(out[(size - 1) * size * 4]).toBe(toHalfFloat(1));
		expect(out[0]).toBe(toHalfFloat(0));
		// The one texel of the last level holds the average: half white.
		expect(out[LIGHT_IMAGE_HALVES - 4]).toBe(toHalfFloat(0.5));
	});
});
