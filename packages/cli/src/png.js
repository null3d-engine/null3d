// PNG files of RGBA8 images: the frames that the engine reads back in hold mode, and the reference
// images and diffs of image tests.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decode, encode } from 'fast-png';

/**
 * RGBA8 pixels, rows tightly packed, top row first.
 *
 * @typedef {object} RgbaImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 */

/**
 * An image as a PNG file's bytes.
 *
 * @param {RgbaImage} image
 * @returns {Uint8Array}
 */
export function encodePng({ width, height, data }) {
	return encode({ width, height, data, channels: 4, depth: 8 });
}

/**
 * Writes an image as a PNG file, and makes the file's folder when it is missing.
 *
 * @param {string} path
 * @param {RgbaImage} image
 */
export function writePng(path, image) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, encodePng(image));
}

/**
 * Decodes a PNG file's bytes as 8-bit RGBA pixels, and throws for any other kind of PNG.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, for the error.
 * @returns {RgbaImage}
 */
export function decodePng(bytes, name) {
	const { width, height, data, channels } = decode(bytes);
	if (channels !== 4 || !(data instanceof Uint8Array))
		throw new Error(`${name} is not an 8-bit RGBA image`);
	return { width, height, data };
}

/**
 * Decodes a PNG file's bytes as 8-bit RGBA pixels, widening a grey, grey-alpha or RGB image. A
 * browser's screenshot is often RGB, which `decodePng` refuses. Throws for any deeper image.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, for the error.
 * @returns {RgbaImage}
 */
export function decodePngRgba(bytes, name) {
	const { width, height, data, channels, depth } = decode(bytes);
	if (depth !== 8 || !(data instanceof Uint8Array) || channels < 1 || channels > 4)
		throw new Error(`${name} is not an 8-bit image`);
	if (channels === 4) return { width, height, data };
	const pixels = width * height;
	const wide = new Uint8Array(pixels * 4);
	for (let i = 0; i < pixels; i++) {
		const from = i * channels;
		const to = i * 4;
		const grey = channels < 3;
		const first = data[from] ?? 0;
		const second = data[from + 1] ?? 0;
		const third = data[from + 2] ?? 0;
		wide[to] = first;
		wide[to + 1] = grey ? first : second;
		wide[to + 2] = grey ? first : third;
		wide[to + 3] = channels === 2 ? second : 255;
	}
	return { width, height, data: wide };
}

/**
 * Reads a PNG file of 8-bit RGBA pixels, and throws for any other kind of PNG.
 *
 * @param {string} path
 * @returns {RgbaImage}
 */
export function readPng(path) {
	return decodePng(readFileSync(path), path);
}
