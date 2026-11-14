import { describe, expect, it } from 'bun:test';
import { srgbToLinear } from '../math/color';
import { toHalfFloat } from './half-float';
import {
	LIGHT_IMAGE_MAX_SIZE,
	LIGHT_IMAGE_SIZE,
	lightImageHalves,
	lightImageLevels,
	lightImageSize,
	prepareLightImage,
} from './light-images';

/** Pixels of `width` by `height`, each from `color(x, y)`, as sRGB bytes. */
function pixels(width: number, height: number, color: (x: number, y: number) => number[]) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
	return { width, height, data };
}

describe('lightImageSize', () => {
	it('keeps a picture small, and gives a detailed one more texels', () => {
		expect(lightImageSize(1, 1)).toBe(LIGHT_IMAGE_SIZE);
		expect(lightImageSize(32, 32)).toBe(LIGHT_IMAGE_SIZE);
		expect(lightImageSize(LIGHT_IMAGE_SIZE, 4)).toBe(LIGHT_IMAGE_SIZE);
		// The longer side picks the size, and a square picture keeps the whole of it.
		expect(lightImageSize(129, 8)).toBe(256);
		expect(lightImageSize(300, 300)).toBe(512);
		expect(lightImageSize(2048, 2048)).toBe(LIGHT_IMAGE_MAX_SIZE);
	});
});

describe('prepareLightImage', () => {
	it('fills every level down to one texel', () => {
		expect(lightImageLevels(LIGHT_IMAGE_SIZE)).toBe(8);
		expect(lightImageLevels(LIGHT_IMAGE_MAX_SIZE)).toBe(10);
		expect(lightImageHalves(LIGHT_IMAGE_SIZE)).toBe(
			4 *
				Array.from(
					{ length: lightImageLevels(LIGHT_IMAGE_SIZE) },
					(_, k) => (LIGHT_IMAGE_SIZE >> k) ** 2,
				).reduce((a, b) => a + b),
		);
		expect(lightImageHalves(256)).toBe((4 * (4 ** 9 - 1)) / 3);
		expect(lightImageHalves(512)).toBe((4 * (4 ** 10 - 1)) / 3);
	});

	it('keeps an even color through every level, in linear light', () => {
		const out = new Uint16Array(lightImageHalves(LIGHT_IMAGE_SIZE));
		prepareLightImage(
			pixels(3, 5, () => [200, 100, 0]),
			out,
		);
		const texel = [srgbToLinear(200 / 255), srgbToLinear(100 / 255), 0, 1].map(toHalfFloat);
		for (let k = 0; k < out.length; k += 4) expect([...out.subarray(k, k + 4)]).toEqual(texel);
	});

	it('puts the top row of the pixels at the top of the light and averages each level', () => {
		const out = new Uint16Array(lightImageHalves(LIGHT_IMAGE_SIZE));
		// White above, black below: the last row of level 0 is white, the first black.
		prepareLightImage(
			pixels(256, 256, (_, y) => (y < 128 ? [255, 255, 255] : [0, 0, 0])),
			out,
		);
		const size = LIGHT_IMAGE_SIZE;
		expect(out[(size - 1) * size * 4]).toBe(toHalfFloat(1));
		expect(out[0]).toBe(toHalfFloat(0));
		// The one texel of the last level holds the average: half white.
		expect(out[out.length - 4]).toBe(toHalfFloat(0.5));
	});

	it('keeps the detail of a large picture at the largest image size', () => {
		const size = LIGHT_IMAGE_MAX_SIZE;
		// A checkerboard of one-pixel squares: every texel of the largest level alternates, so a
		// resampler that lost the detail would average the two colors into one.
		const out = new Uint16Array(lightImageHalves(size));
		prepareLightImage(
			pixels(size, size, (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255] : [0, 0, 0])),
			out,
			size,
		);
		expect(out[0]).toBe(toHalfFloat(0));
		expect(out[4]).toBe(toHalfFloat(1));
		// Every level below the largest averages the two colors: half white.
		expect(out[out.length - 4]).toBe(toHalfFloat(0.5));
	});
});
