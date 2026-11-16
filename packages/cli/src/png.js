// PNG files of RGBA8 images: the frames that the engine reads back in hold mode, and the reference
// images and diffs of image tests.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decode, encode } from 'fast-png';

/** The most bytes of compressed image data that the decoder takes in one piece. */
const DATA_PIECE = 65536;

/** The CRC-32 table of the PNG format's chunk checks. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

/**
 * The CRC-32 of a chunk's type and data.
 *
 * @param {Uint8Array} bytes
 */
function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = /** @type {number} */ (CRC_TABLE[(c ^ byte) & 0xff]) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * The same PNG file with its image data in chunks of at most 64 KiB. fast-png feeds each image data
 * chunk to fflate's streaming inflater as one piece, and that inflater writes wrong bytes past the
 * first 512 KiB of output when one piece is large, so a large picture saved with one data chunk
 * decodes with garbled rows. Pieces of 64 KiB inflate correctly. A file whose chunks are all small
 * is returned as it is.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function splitImageData(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	/** @type {Uint8Array[]} */
	const parts = [bytes.subarray(0, 8)];
	let split = false;
	for (let at = 8; at + 12 <= bytes.length; ) {
		const length = view.getUint32(at);
		const end = at + 12 + length;
		const isData = view.getUint32(at + 4) === 0x49444154;
		if (!isData || length <= DATA_PIECE) parts.push(bytes.subarray(at, end));
		else {
			split = true;
			for (let from = 0; from < length; from += DATA_PIECE) {
				const piece = bytes.subarray(at + 8 + from, at + 8 + Math.min(length, from + DATA_PIECE));
				const chunk = new Uint8Array(piece.length + 12);
				const out = new DataView(chunk.buffer);
				out.setUint32(0, piece.length);
				chunk.set(bytes.subarray(at + 4, at + 8), 4);
				chunk.set(piece, 8);
				out.setUint32(8 + piece.length, crc32(chunk.subarray(4, 8 + piece.length)));
				parts.push(chunk);
			}
		}
		at = end;
	}
	if (!split) return bytes;
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/**
 * Decodes a PNG file with fast-png, its image data split first so that every row decodes right.
 *
 * @param {Uint8Array} bytes
 * @returns {import('fast-png').DecodedPng}
 */
export function decodePngFile(bytes) {
	return decode(splitImageData(bytes));
}

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
	const { width, height, data, channels } = decodePngFile(bytes);
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
	const { width, height, data, channels, depth } = decodePngFile(bytes);
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
