// Images for the texture encoder: PNG and JPEG files decoded to 8-bit RGBA pixels, and resized to
// sizes whose sides are powers of two. Every step uses only additions, multiplications, divisions
// and rounding, which give the same result in every JavaScript engine on every CPU. So the same
// file gives the same pixels on every machine, and then the same encoded texture.
import { convertIndexedToRgb, decode } from 'fast-png';
import jpeg from 'jpeg-js';

/**
 * RGBA8 pixels, rows tightly packed, top row first.
 *
 * @typedef {object} Pixels
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 */

/** The largest side that the encoder takes: its 32-bit WebAssembly build refuses 4096 x 4096. */
export const MAX_TEXTURE_SIDE = 2048;

/**
 * Each 8-bit sRGB value as linear light, scaled to 0 to 65535. The values are written out, not
 * computed with `Math.pow`, whose last digit may differ between JavaScript engines.
 */
const SRGB_TO_LINEAR = Uint16Array.from([
	0, 20, 40, 60, 80, 99, 119, 139, 159, 179, 199, 219, 241, 264, 288, 313, 340, 367, 396, 427, 458,
	491, 526, 562, 599, 637, 677, 718, 761, 805, 851, 898, 947, 997, 1048, 1101, 1156, 1212, 1270,
	1330, 1391, 1453, 1517, 1583, 1651, 1720, 1790, 1863, 1937, 2013, 2090, 2170, 2250, 2333, 2418,
	2504, 2592, 2681, 2773, 2866, 2961, 3058, 3157, 3258, 3360, 3464, 3570, 3678, 3788, 3900, 4014,
	4129, 4247, 4366, 4488, 4611, 4736, 4864, 4993, 5124, 5257, 5392, 5530, 5669, 5810, 5953, 6099,
	6246, 6395, 6547, 6700, 6856, 7014, 7174, 7335, 7500, 7666, 7834, 8004, 8177, 8352, 8528, 8708,
	8889, 9072, 9258, 9445, 9635, 9828, 10022, 10219, 10417, 10619, 10822, 11028, 11235, 11446, 11658,
	11873, 12090, 12309, 12530, 12754, 12980, 13209, 13440, 13673, 13909, 14146, 14387, 14629, 14874,
	15122, 15371, 15623, 15878, 16135, 16394, 16656, 16920, 17187, 17456, 17727, 18001, 18277, 18556,
	18837, 19121, 19407, 19696, 19987, 20281, 20577, 20876, 21177, 21481, 21787, 22096, 22407, 22721,
	23038, 23357, 23678, 24002, 24329, 24658, 24990, 25325, 25662, 26001, 26344, 26688, 27036, 27386,
	27739, 28094, 28452, 28813, 29176, 29542, 29911, 30282, 30656, 31033, 31412, 31794, 32179, 32567,
	32957, 33350, 33745, 34143, 34544, 34948, 35355, 35764, 36176, 36591, 37008, 37429, 37852, 38278,
	38706, 39138, 39572, 40009, 40449, 40891, 41337, 41785, 42236, 42690, 43147, 43606, 44069, 44534,
	45002, 45473, 45947, 46423, 46903, 47385, 47871, 48359, 48850, 49344, 49841, 50341, 50844, 51349,
	51858, 52369, 52884, 53401, 53921, 54445, 54971, 55500, 56032, 56567, 57105, 57646, 58190, 58737,
	59287, 59840, 60396, 60955, 61517, 62082, 62650, 63221, 63795, 64372, 64952, 65535,
]);

/** The points halfway between neighboring entries of the table: the bounds of each sRGB value. */
const SRGB_BOUNDS = Float64Array.from({ length: 255 }, (_, i) => {
	const a = /** @type {number} */ (SRGB_TO_LINEAR[i]);
	const b = /** @type {number} */ (SRGB_TO_LINEAR[i + 1]);
	return (a + b) / 2;
});

/**
 * The 8-bit sRGB value nearest to a linear value from 0 to 65535.
 *
 * @param {number} linear
 */
export function linearToSrgb(linear) {
	let low = 0;
	let high = 255;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (linear < /** @type {number} */ (SRGB_BOUNDS[mid])) high = mid;
		else low = mid + 1;
	}
	return low;
}

/**
 * The linear value, from 0 to 65535, of an 8-bit sRGB value.
 *
 * @param {number} srgb
 */
export const srgbToLinear = (srgb) => /** @type {number} */ (SRGB_TO_LINEAR[srgb]);

/**
 * The image in a PNG or JPEG file, as 8-bit RGBA pixels. A PNG of 16 bits per channel keeps the
 * high byte of each value. Throws for any other kind of file.
 *
 * @param {Uint8Array} bytes
 * @param {string} mimeType `image/png` or `image/jpeg`.
 * @returns {Pixels}
 */
export function decodeImage(bytes, mimeType) {
	if (mimeType === 'image/jpeg') {
		const { width, height, data } = jpeg.decode(bytes, {
			useTArray: true,
			formatAsRGBA: true,
			maxMemoryUsageInMB: 1024,
		});
		return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
	}
	if (mimeType === 'image/png') return pngPixels(decode(bytes));
	throw new Error(`the encoder reads PNG and JPEG images, not ${mimeType}`);
}

/**
 * A decoded PNG image as RGBA8 pixels.
 *
 * @param {import('fast-png').DecodedPng} png
 * @returns {Pixels}
 */
function pngPixels(png) {
	const { width, height } = png;
	const count = width * height;
	const out = new Uint8Array(count * 4);
	if (png.palette) {
		const rgb = convertIndexedToRgb(png);
		const channels = rgb.length / count;
		for (let i = 0; i < count; i++) {
			for (let c = 0; c < 3; c++) out[i * 4 + c] = /** @type {number} */ (rgb[i * channels + c]);
			out[i * 4 + 3] = channels === 4 ? /** @type {number} */ (rgb[i * 4 + 3]) : 255;
		}
		return { width, height, data: out };
	}
	const { channels, depth } = png;
	const values = unpacked(
		/** @type {Uint8Array | Uint16Array} */ (png.data),
		width * channels,
		height,
		depth,
	);
	const max = 2 ** depth - 1;
	/** @param {number} v */
	const byte = (v) => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.round((v * 255) / max));
	const key = png.transparency;
	for (let i = 0; i < count; i++) {
		const at = i * channels;
		const v = (/** @type {number} */ k) => /** @type {number} */ (values[at + k]);
		const gray = channels < 3;
		const r = v(0);
		const g = gray ? r : v(1);
		const b = gray ? r : v(2);
		let a = channels === 2 ? byte(v(1)) : channels === 4 ? byte(v(3)) : 255;
		if (
			key &&
			key.length > 0 &&
			(gray ? r === key[0] : r === key[0] && g === key[1] && b === key[2])
		)
			a = 0;
		out[i * 4] = byte(r);
		out[i * 4 + 1] = byte(g);
		out[i * 4 + 2] = byte(b);
		out[i * 4 + 3] = a;
	}
	return { width, height, data: out };
}

/**
 * The samples of a PNG's rows, one array element each, from rows packed at fewer than 8 bits.
 *
 * @param {Uint8Array | Uint16Array} data
 * @param {number} perRow The samples in a row.
 * @param {number} rows
 * @param {number} depth The bits per sample.
 * @returns {ArrayLike<number>}
 */
function unpacked(data, perRow, rows, depth) {
	if (depth >= 8) return data;
	const out = new Uint8Array(perRow * rows);
	const rowBytes = Math.ceil((perRow * depth) / 8);
	const mask = (1 << depth) - 1;
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < perRow; x++) {
			const bit = x * depth;
			const byte = /** @type {number} */ (data[y * rowBytes + (bit >> 3)]);
			out[y * perRow + x] = (byte >> (8 - depth - (bit & 7))) & mask;
		}
	return out;
}

/**
 * The power of two nearest to a length, ties up: 600 gives 512, and 768 gives 1024.
 *
 * @param {number} length At least 1.
 */
export function nearestPowerOfTwo(length) {
	let power = 1;
	while (power * 2 <= length) power *= 2;
	return length - power < power * 2 - length ? power : power * 2;
}

/**
 * Texels on each side of a block of the compressed formats that KTX2 textures become. A side that
 * is not a whole number of blocks makes the engine load the texture uncompressed.
 */
const BLOCK = 4;

/**
 * The size that a texture takes: each side at its nearest power of two, then both halved together
 * until the longer side fits `maxSide`, so the shape stays. Each side is at least one block.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} maxSide A power of two.
 * @returns {[number, number]}
 */
export function textureSize(width, height, maxSide) {
	let w = nearestPowerOfTwo(width);
	let h = nearestPowerOfTwo(height);
	while (w > maxSide || h > maxSide) {
		w = Math.max(1, w / 2);
		h = Math.max(1, h / 2);
	}
	return [Math.max(BLOCK, w), Math.max(BLOCK, h)];
}

/**
 * The source pixels and weights of each output pixel along one axis: a tent filter as wide as one
 * source pixel when the image grows, and as one output pixel when it shrinks.
 *
 * @param {number} from The source length.
 * @param {number} to The output length.
 * @returns {{ start: Int32Array, count: Int32Array, weights: Float64Array, width: number }}
 */
function axisWeights(from, to) {
	const scale = from / to;
	const radius = scale > 1 ? scale : 1;
	const width = Math.ceil(radius) * 2 + 1;
	const start = new Int32Array(to);
	const count = new Int32Array(to);
	const weights = new Float64Array(to * width);
	for (let i = 0; i < to; i++) {
		const center = (i + 0.5) * scale - 0.5;
		const first = Math.max(0, Math.ceil(center - radius));
		const last = Math.min(from - 1, Math.floor(center + radius));
		let sum = 0;
		let n = 0;
		for (let s = first; s <= last; s++, n++) {
			const d = center - s;
			const w = 1 - (d < 0 ? -d : d) / radius;
			weights[i * width + n] = w > 0 ? w : 0;
			sum += weights[i * width + n] ?? 0;
		}
		if (sum === 0) {
			const nearest = Math.min(from - 1, Math.max(0, Math.round(center)));
			start[i] = nearest;
			count[i] = 1;
			weights[i * width] = 1;
			continue;
		}
		for (let k = 0; k < n; k++) weights[i * width + k] = (weights[i * width + k] ?? 0) / sum;
		start[i] = first;
		count[i] = n;
	}
	return { start, count, weights, width };
}

/**
 * The image at another size. Colors of an sRGB image mix as linear light. Each color mixes by its
 * pixel's alpha, so the colors of see-through pixels do not bleed into their neighbors.
 *
 * @param {Pixels} image
 * @param {number} width
 * @param {number} height
 * @param {boolean} srgb True when the colors are sRGB, as in color maps.
 * @returns {Pixels}
 */
export function resizeImage(image, width, height, srgb) {
	if (image.width === width && image.height === height) return image;
	const toLinear = srgb ? srgbToLinear : (/** @type {number} */ v) => v * 257;
	const source = new Float64Array(image.width * image.height * 4);
	for (let i = 0; i < image.width * image.height; i++) {
		const a = /** @type {number} */ (image.data[i * 4 + 3]) / 255;
		for (let c = 0; c < 3; c++)
			source[i * 4 + c] = toLinear(/** @type {number} */ (image.data[i * 4 + c])) * a;
		source[i * 4 + 3] = a;
	}
	const across = filterRows(source, image.width, image.height, width);
	const done = filterColumns(across, width, image.height, height);
	const out = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const a = /** @type {number} */ (done[i * 4 + 3]);
		for (let c = 0; c < 3; c++) {
			const linear = a > 0 ? /** @type {number} */ (done[i * 4 + c]) / a : 0;
			const clamped = linear < 0 ? 0 : linear > 65535 ? 65535 : linear;
			out[i * 4 + c] = srgb ? linearToSrgb(clamped) : Math.round(clamped / 257);
		}
		out[i * 4 + 3] = Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255);
	}
	return { width, height, data: out };
}

/**
 * Resamples each row of four-channel samples to a new width.
 *
 * @param {Float64Array} source
 * @param {number} width
 * @param {number} height
 * @param {number} to
 */
function filterRows(source, width, height, to) {
	const { start, count, weights, width: span } = axisWeights(width, to);
	const out = new Float64Array(to * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < to; x++) {
			const first = /** @type {number} */ (start[x]);
			for (let k = 0; k < /** @type {number} */ (count[x]); k++) {
				const w = /** @type {number} */ (weights[x * span + k]);
				const from = (y * width + first + k) * 4;
				const at = (y * to + x) * 4;
				for (let c = 0; c < 4; c++)
					out[at + c] =
						/** @type {number} */ (out[at + c]) + w * /** @type {number} */ (source[from + c]);
			}
		}
	return out;
}

/**
 * Resamples each column of four-channel samples to a new height.
 *
 * @param {Float64Array} source
 * @param {number} width
 * @param {number} height
 * @param {number} to
 */
function filterColumns(source, width, height, to) {
	const { start, count, weights, width: span } = axisWeights(height, to);
	const out = new Float64Array(width * to * 4);
	for (let y = 0; y < to; y++) {
		const first = /** @type {number} */ (start[y]);
		for (let k = 0; k < /** @type {number} */ (count[y]); k++) {
			const w = /** @type {number} */ (weights[y * span + k]);
			const row = (first + k) * width * 4;
			const at = y * width * 4;
			for (let i = 0; i < width * 4; i++)
				out[at + i] =
					/** @type {number} */ (out[at + i]) + w * /** @type {number} */ (source[row + i]);
		}
	}
	return out;
}

/**
 * True when some pixel is not fully opaque.
 *
 * @param {Pixels} image
 */
export function hasAlpha(image) {
	for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) return true;
	return false;
}
