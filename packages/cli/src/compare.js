// Compares an image with its reference image: a pixel counts as different when its color moves past
// a threshold, and an image fails when too many pixels differ.
import pixelmatch from 'pixelmatch';

/** @import { RgbaImage } from './png.js' */

/**
 * How far an image may stray from its reference.
 *
 * @typedef {object} Tolerance
 * @property {number} threshold How far a pixel's color may move before the pixel counts as
 *   different, from 0 to 1, by pixelmatch's measure of color distance. Pixels on anti-aliased edges
 *   never count.
 * @property {number} maxDiffRatio The share of pixels that may differ, from 0 to 1.
 */

/**
 * The limits of three.js's own image tests: a pixel differs past a tenth of the color range, and
 * an image passes while at most a thousandth of its pixels differ.
 *
 * @type {Readonly<Tolerance>}
 */
export const TOLERANCE = { threshold: 0.1, maxDiffRatio: 0.001 };

/**
 * How an image of the same size as its reference differs from it: the share of its pixels that
 * differ past the threshold, and a diff image that marks them in red over a faded copy.
 *
 * @param {RgbaImage} reference
 * @param {RgbaImage} image
 * @param {number} threshold
 * @returns {{ share: number, diff: RgbaImage }}
 */
export function compareImages(reference, image, threshold) {
	const { width, height } = image;
	const data = new Uint8Array(image.data.length);
	const count = pixelmatch(reference.data, image.data, data, width, height, { threshold });
	return { share: count / (width * height), diff: { width, height, data } };
}

/**
 * A share from 0 to 1 as a percentage with three decimals, such as `0.100%`.
 *
 * @param {number} share
 */
export const percent = (share) => `${(share * 100).toFixed(3)}%`;
