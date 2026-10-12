// Image files that the asset commands read besides the encoder's: the type of a file by its first
// bytes, Truevision TGA files, which glTF does not take and models from other tools often name,
// and height maps at their full depth.
import { decode } from 'fast-png';
import { decodeImage } from './images.js';

/** @import { Pixels } from './images.js' */

/**
 * The type of an image file by its first bytes: `image/png`, `image/jpeg`, `image/webp`,
 * `image/ktx2`, or, for a name that ends in `.tga`, `image/x-tga`. Undefined for any other file.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, which TGA files need, since they have no signature.
 */
export function imageType(bytes, name) {
	const starts = (/** @type {number[]} */ signature, at = 0) =>
		signature.every((byte, i) => bytes[at + i] === byte);
	if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
	if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
	if (starts([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb])) return 'image/ktx2';
	if (/\.tga$/i.test(name)) return 'image/x-tga';
	return undefined;
}

/**
 * The pixels of a PNG, JPEG or TGA file.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, for its type and for errors.
 * @returns {Pixels}
 */
export function readPixels(bytes, name) {
	const type = imageType(bytes, name);
	if (type === 'image/x-tga') return decodeTga(bytes);
	if (type === 'image/png' || type === 'image/jpeg') return decodeImage(bytes, type);
	throw new Error(`${name} is not a PNG, JPEG or TGA image`);
}

/**
 * The pixels of a Truevision TGA file: true color, gray or color-mapped, plain or run-length
 * encoded, at 8, 15, 16, 24 or 32 bits per pixel.
 *
 * @param {Uint8Array} bytes
 * @returns {Pixels}
 */
export function decodeTga(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 18) throw new Error('the TGA file is shorter than its header');
	const idLength = view.getUint8(0);
	const mapType = view.getUint8(1);
	const type = view.getUint8(2);
	const mapFirst = view.getUint16(3, true);
	const mapLength = view.getUint16(5, true);
	const mapBits = view.getUint8(7);
	const width = view.getUint16(12, true);
	const height = view.getUint16(14, true);
	const bits = view.getUint8(16);
	const descriptor = view.getUint8(17);
	const base = type & ~8;
	if (base !== 1 && base !== 2 && base !== 3)
		throw new Error(`the TGA file has the image type ${type}, which the tool does not read`);
	if (width === 0 || height === 0) throw new Error('the TGA file has no pixels');
	let at = 18 + idLength;
	/** Reads one pixel of `size` bits at `from` into RGBA. */
	const color = (/** @type {number} */ from, /** @type {number} */ size, out = [0, 0, 0, 255]) => {
		if (size === 8) out[0] = out[1] = out[2] = bytes[from] ?? 0;
		else if (size === 15 || size === 16) {
			const v = view.getUint16(from, true);
			out[0] = ((((v >> 10) & 31) * 255 + 15) / 31) | 0;
			out[1] = ((((v >> 5) & 31) * 255 + 15) / 31) | 0;
			out[2] = (((v & 31) * 255 + 15) / 31) | 0;
		} else {
			out[0] = bytes[from + 2] ?? 0;
			out[1] = bytes[from + 1] ?? 0;
			out[2] = bytes[from] ?? 0;
			if (size === 32) out[3] = bytes[from + 3] ?? 0;
		}
		return out;
	};
	/** @type {number[][]} */
	let palette = [];
	if (mapType === 1) {
		const entry = Math.ceil(mapBits / 8);
		palette = Array.from({ length: mapLength }, (_, i) => color(at + i * entry, mapBits));
		at += mapLength * entry;
	}
	const size = Math.ceil(bits / 8);
	if (![1, 2, 3, 4].includes(size)) throw new Error(`the TGA file has ${bits} bits per pixel`);
	const count = width * height;
	const pixels = new Uint8Array(count * 4);
	/** Writes the pixel at `from` as the image's `i`-th pixel, in file order. */
	const put = (/** @type {number} */ i, /** @type {number} */ from) => {
		const rgba =
			base === 1
				? (palette[(size === 2 ? view.getUint16(from, true) : (bytes[from] ?? 0)) - mapFirst] ?? [
						0, 0, 0, 255,
					])
				: color(from, bits);
		pixels.set(rgba, i * 4);
	};
	const need = (/** @type {number} */ end) => {
		if (end > bytes.length) throw new Error('the TGA file ends before its last pixel');
	};
	if (type & 8) {
		for (let i = 0; i < count; ) {
			need(at + 1);
			const packet = /** @type {number} */ (bytes[at++]);
			const run = (packet & 127) + 1;
			if (packet & 128) {
				need(at + size);
				for (let k = 0; k < run && i < count; k++) put(i++, at);
				at += size;
			} else {
				need(at + run * size);
				for (let k = 0; k < run && i < count; k++, at += size) put(i++, at);
			}
		}
	} else {
		need(at + count * size);
		for (let i = 0; i < count; i++, at += size) put(i, at);
	}
	// The file stores rows from the bottom unless its descriptor says top first, and pixels from
	// the left unless it says right first.
	const out = new Uint8Array(count * 4);
	const fromTop = (descriptor & 32) !== 0;
	const fromRight = (descriptor & 16) !== 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const sx = fromRight ? width - 1 - x : x;
			const sy = fromTop ? y : height - 1 - y;
			out.set(
				pixels.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4),
				(y * width + x) * 4,
			);
		}
	return { width, height, data: out };
}

/**
 * A height map's values from 0 to 1, from the red channel of a PNG, JPEG or TGA image, at the
 * file's full depth: a 16-bit PNG keeps its 65,536 steps, which a smooth slope needs.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {{ width: number, height: number, data: Float32Array }}
 */
export function readHeights(bytes, name) {
	if (imageType(bytes, name) === 'image/png') {
		const png = decode(bytes);
		if (png.depth === 16 && !png.palette) {
			const { width, height, channels } = png;
			const data = new Float32Array(width * height);
			const values = /** @type {Uint16Array} */ (png.data);
			for (let i = 0; i < data.length; i++)
				data[i] = /** @type {number} */ (values[i * channels]) / 65535;
			return { width, height, data };
		}
	}
	const { width, height, data: rgba } = readPixels(bytes, name);
	const data = new Float32Array(width * height);
	for (let i = 0; i < data.length; i++) data[i] = /** @type {number} */ (rgba[i * 4]) / 255;
	return { width, height, data };
}
