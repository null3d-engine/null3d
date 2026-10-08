// Material maps made from other maps: occlusion, roughness and metalness packed into the channels
// where glTF reads them, and normal maps from height maps. The assets pack-orm and
// normal-from-bump commands write them, and assets convert makes them for the materials of FBX
// and OBJ files, which keep these maps apart.
import { readFileSync } from 'node:fs';
import { UsageError } from '../args.js';
import { encodePng } from '../png.js';
import { shownPath } from '../text.js';
import { encodePixels } from './encoder.js';
import { MAX_TEXTURE_SIDE, resizeImage, textureSize } from './images.js';

/** @import { Pixels } from './images.js' */

/**
 * What one channel of a packed map holds: the red channel of an image, upside down in value when
 * `invert` is set, as a glossiness map gives roughness, or one value from 0 to 255 everywhere.
 *
 * @typedef {{ image: Pixels, invert?: boolean } | { value: number }} ChannelSource
 */

/**
 * The size of a packed map: the largest of its images. Images of other sizes stretch to it.
 *
 * @param {readonly ChannelSource[]} channels
 * @returns {[number, number]}
 */
export function packedSize(channels) {
	let width = 1;
	let height = 1;
	for (const channel of channels)
		if ('image' in channel && channel.image.width * channel.image.height > width * height) {
			width = channel.image.width;
			height = channel.image.height;
		}
	return [width, height];
}

/**
 * An opaque image whose red, green and blue channels hold the three sources: occlusion,
 * roughness and metalness, in glTF's order.
 *
 * @param {readonly [ChannelSource, ChannelSource, ChannelSource]} channels
 * @returns {Pixels}
 */
export function packChannels(channels) {
	const [width, height] = packedSize(channels);
	const data = new Uint8Array(width * height * 4).fill(255);
	channels.forEach((channel, c) => {
		if ('value' in channel) {
			for (let i = c; i < data.length; i += 4) data[i] = channel.value;
			return;
		}
		const image = resizeImage(channel.image, width, height, false);
		for (let i = 0; i < width * height; i++) {
			const v = /** @type {number} */ (image.data[i * 4]);
			data[i * 4 + c] = channel.invert ? 255 - v : v;
		}
	});
	return { width, height, data };
}

/**
 * A normal map from a height map, in glTF's convention: X to the right, Y up the image and Z out
 * of the surface, each from -1 to 1 stored as 0 to 255.
 *
 * The slope at each texel is half the difference of its neighbors' heights. A slope of the whole
 * height range per texel, times `scale`, tilts the surface 45 degrees. three.js reads a bump map
 * with that bumpScale the same way where one texel covers one pixel of the screen.
 *
 * @param {{ width: number, height: number, data: Float32Array }} heights Values from 0 to 1, top
 *   row first.
 * @param {number} scale
 * @param {boolean} wrap True when the map tiles, so the texels at each edge take their neighbors
 *   from the opposite edge. Otherwise the edge texels repeat outward.
 * @returns {Pixels}
 */
export function normalsFromHeights({ width, height, data: h }, scale, wrap) {
	const data = new Uint8Array(width * height * 4);
	const column = (/** @type {number} */ x) =>
		wrap ? (x + width) % width : x < 0 ? 0 : x >= width ? width - 1 : x;
	const row = (/** @type {number} */ y) =>
		wrap ? (y + height) % height : y < 0 ? 0 : y >= height ? height - 1 : y;
	const at = (/** @type {number} */ x, /** @type {number} */ y) =>
		/** @type {number} */ (h[row(y) * width + column(x)]);
	const byte = (/** @type {number} */ v) => Math.round((v * 0.5 + 0.5) * 255);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			// The image's rows run down, and the normal's Y runs up the image.
			const dx = ((at(x + 1, y) - at(x - 1, y)) / 2) * scale;
			const dy = ((at(x, y + 1) - at(x, y - 1)) / 2) * scale;
			const length = Math.sqrt(dx * dx + dy * dy + 1);
			const i = (y * width + x) * 4;
			data[i] = byte(-dx / length);
			data[i + 1] = byte(dy / length);
			data[i + 2] = byte(1 / length);
			data[i + 3] = 255;
		}
	return { width, height, data };
}

/**
 * True when every pixel's red, green and blue differ by at most a few steps: a height map, not a
 * normal map, whose pixels lean to blue.
 *
 * @param {Pixels} image
 */
export function isGray(image) {
	const d = image.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = /** @type {number} */ (d[i]);
		const g = /** @type {number} */ (d[i + 1]);
		const b = /** @type {number} */ (d[i + 2]);
		if (Math.abs(r - g) > 3 || Math.abs(g - b) > 3) return false;
	}
	return true;
}

/**
 * The bytes of a map's file: a PNG file at the map's size, or a KTX2 file in UASTC with every mip
 * level, at the size that `assets optimize` gives textures.
 *
 * @param {Pixels} map
 * @param {'png' | 'ktx2'} format
 * @param {'data' | 'normal'} kind
 * @param {number} maxSide The largest side of a KTX2 file, a power of two.
 */
export async function mapFile(map, format, kind, maxSide) {
	if (format === 'png') return encodePng(map);
	const [width, height] = textureSize(map.width, map.height, maxSide);
	return encodePixels(resizeImage(map, width, height, false), kind, 'uastc');
}

/**
 * The output file's format by its name, or a UsageError for another name.
 *
 * @param {string} output
 * @returns {'png' | 'ktx2'}
 */
export function mapFormat(output) {
	const match = /\.(png|ktx2)$/i.exec(output);
	if (!match)
		throw new UsageError(`its output must be a .ktx2 or .png file, not ${shownPath(output)}`);
	return /** @type {'png' | 'ktx2'} */ (/** @type {string} */ (match[1]).toLowerCase());
}

/**
 * The largest side of a KTX2 texture from its option's text.
 *
 * @param {string} text
 */
export function readMaxSide(text) {
	const side = Number(text);
	if (!Number.isInteger(side) || side < 1 || side > MAX_TEXTURE_SIDE || (side & (side - 1)) !== 0)
		throw new UsageError(
			`--max-texture-size takes a power of two from 1 to ${MAX_TEXTURE_SIDE}, such as 1024, not "${text}"`,
		);
	return side;
}

/**
 * The bytes of a file that a command names, or a UsageError when it does not exist.
 *
 * @param {string} path
 */
export function readInput(path) {
	try {
		return new Uint8Array(readFileSync(path));
	} catch {
		throw new UsageError(`its input ${shownPath(path)} does not exist`);
	}
}
