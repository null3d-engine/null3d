// The images of lights: a picture that a rectangle light shows over its area, such as a shop
// window or a screen, or that a spot light projects over its cone, such as a gobo pattern (decision
// record D-145). The engine keeps each image as a layer of the light tables' texture, in linear
// half floats with every mip level, so the shaders read a sharp image in a mirror-like reflection
// and a blurred one in a rough surface. A picture keeps its detail up to the largest image size,
// and a smaller one costs less memory. This module turns the sketch's sRGB pixels into those
// texels.

import { toHalfFloat } from './half-float';

/** The fewest texels along each side of a light's image. */
export const LIGHT_IMAGE_SIZE = 128;
/** The most texels along each side of a light's image. */
export const LIGHT_IMAGE_MAX_SIZE = 512;

/**
 * The texels along each side of the image for a picture of `width` by `height` pixels: a power of
 * two that keeps the picture's detail, from the fewest to the most. The engine resamples the
 * picture to a square, so its longer side picks the size.
 */
export function lightImageSize(width: number, height: number): number {
	let size = LIGHT_IMAGE_SIZE;
	const side = Math.max(width, height);
	while (size < Math.min(side, LIGHT_IMAGE_MAX_SIZE)) size <<= 1;
	return Math.min(size, LIGHT_IMAGE_MAX_SIZE);
}

/** The mip levels of an image of `size` texels a side, down to one texel. */
export function lightImageLevels(size: number): number {
	return Math.log2(size) + 1;
}

/** Half floats of an image of `size` texels a side, with every level: four per texel. */
export function lightImageHalves(size: number): number {
	let halves = 0;
	for (let side = size; side >= 1; side >>= 1) halves += side * side * 4;
	return halves;
}

/**
 * Pixels of a picture that a light shows, for `RectAreaLight.setImage` and `SpotLight.setMap`:
 * rows from the top, four sRGB bytes per pixel. The engine keeps the picture's detail up to 512
 * texels a side, and a larger picture is resampled down to that.
 *
 * @category api/lights
 */
export interface LightImagePixels {
	/** The width in pixels. */
	width: number;
	/** The height in pixels. */
	height: number;
	/** The pixels' red, green, blue and alpha, in sRGB. Alpha is ignored. */
	data: Uint8Array | Uint8ClampedArray;
}

/** The linear value of each sRGB byte, as three.js's `SRGBToLinear`. Kept local, so this module
 * imports nothing that a page's start already holds. */
const LINEAR = Float32Array.from({ length: 256 }, (_, k) => {
	const c = k / 255;
	return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
});

/**
 * Writes `pixels` into `out` as a light's image of `size` texels a side: the largest level
 * resampled with a box filter, then each level the average of four texels of the one before, as
 * linear half floats. The picture's top row lands at the top of the light, along its +Y axis.
 */
export function prepareLightImage(
	pixels: LightImagePixels,
	out: Uint16Array,
	size: number = LIGHT_IMAGE_SIZE,
): void {
	const { width, height, data } = pixels;
	let level = new Float32Array(size * size * 4);
	// Each texel averages a grid of points that covers its share of the pixels.
	const taps = [Math.max(1, Math.ceil(width / size)), Math.max(1, Math.ceil(height / size))];
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const at = ((size - 1 - y) * size + x) * 4;
			for (let j = 0; j < (taps[1] as number); j++) {
				const sy = Math.min(
					height - 1,
					Math.floor(((y + (j + 0.5) / (taps[1] as number)) / size) * height),
				);
				for (let i = 0; i < (taps[0] as number); i++) {
					const sx = Math.min(
						width - 1,
						Math.floor(((x + (i + 0.5) / (taps[0] as number)) / size) * width),
					);
					const from = (sy * width + sx) * 4;
					for (let c = 0; c < 3; c++)
						level[at + c] =
							(level[at + c] as number) + (LINEAR[data[from + c] as number] as number);
				}
			}
			const share = 1 / ((taps[0] as number) * (taps[1] as number));
			for (let c = 0; c < 3; c++) level[at + c] = (level[at + c] as number) * share;
			level[at + 3] = 1;
		}
	}
	let written = 0;
	for (let side = size; side >= 1; side >>= 1) {
		for (let k = 0; k < side * side * 4; k++) out[written + k] = toHalfFloat(level[k] as number);
		written += side * side * 4;
		if (side === 1) break;
		const half = side >> 1;
		const next = new Float32Array(half * half * 4);
		for (let y = 0; y < half; y++)
			for (let x = 0; x < half; x++)
				for (let c = 0; c < 4; c++) {
					const read = (dx: number, dy: number) =>
						level[((2 * y + dy) * side + 2 * x + dx) * 4 + c] as number;
					next[(y * half + x) * 4 + c] = (read(0, 0) + read(1, 0) + read(0, 1) + read(1, 1)) / 4;
				}
		level = next;
	}
}
