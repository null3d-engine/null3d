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
 * Reads a PNG file of 8-bit RGBA pixels, and throws for any other kind of PNG.
 *
 * @param {string} path
 * @returns {RgbaImage}
 */
export function readPng(path) {
	const { width, height, data, channels } = decode(readFileSync(path));
	if (channels !== 4 || !(data instanceof Uint8Array))
		throw new Error(`${path} is not an 8-bit RGBA image`);
	return { width, height, data };
}
