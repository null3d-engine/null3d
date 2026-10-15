// The images of rectangle lights: a picture that a rectangle light shows over its area, such as a
// shop window or a screen (decision record D-145). The engine keeps each image as a layer of the
// light tables' texture, 128 x 128 texels of linear half floats with every mip level, so the
// shaders read a sharp image in a mirror-like reflection and a blurred one in a rough surface.
// This module turns the sketch's sRGB pixels into those texels.

import { toHalfFloat } from './half-float';

/** Texels along each side of a light's image. */
export const LIGHT_IMAGE_SIZE = 128;
/** Mip levels of a light's image, down to one texel. */
export const LIGHT_IMAGE_LEVELS = 8;
/** Half floats of one image with all its levels: four per texel. */
export const LIGHT_IMAGE_HALVES = 4 * ((4 ** LIGHT_IMAGE_LEVELS - 1) / 3);

/**
 * Pixels that a rectangle light shows over its area, for `RectAreaLight.setImage`: rows from the
 * top, four sRGB bytes per pixel.
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
 * Writes `pixels` into `out` as a light's image: level 0 resampled to 128 x 128 texels with a box
 * filter, then each level the average of four texels of the one before, as linear half floats.
 * The image's top row lands at the top of the light, along its +Y axis.
 */
export function prepareLightImage(pixels: LightImagePixels, out: Uint16Array): void {
	const { width, height, data } = pixels;
	const size = LIGHT_IMAGE_SIZE;
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
