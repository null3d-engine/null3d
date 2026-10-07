// The roughness bake: the mip levels of a metal-rough map whose material also has a normal map,
// with the normal map's detail added to their roughness. A distant surface averages its normals
// into one, so its highlight would turn sharp and flicker as the camera moves. The bake widens
// the highlight where the normals spread, as a GPU would see if it drew every one.
//
// The formula is Godot's (Image::generate_mipmap_roughness): the average of the unit normals
// under a texel has length r, which sets the spread of a von Mises-Fisher lobe, and that spread
// adds to the squared roughness, up to a limit.
import { resizeImage } from './images.js';

/** @import { Pixels } from './images.js' */

/** The most roughness that the bake adds, as Godot limits it. */
export const BAKE_LIMIT = 0.4;

/**
 * What a bake needs besides the metal-rough map.
 *
 * @typedef {object} RoughnessBake
 * @property {Uint8Array} bytes The normal map's source image file.
 * @property {string} mimeType `image/png` or `image/jpeg`.
 * @property {number} scale The material's normal scale, which glTF applies to x and y.
 * @property {number} factor The material's roughness factor, which multiplies the texture's value.
 */

/**
 * The roughness of a texel whose normals average to a vector of length `r`. The added squared
 * roughness is three times the lobe's variance, as Godot sets it, divided by the square of the
 * material's factor, since the shader multiplies the texel by it.
 *
 * @param {number} roughness The texel's roughness, from 0 to 1.
 * @param {number} r The length of the average unit normal, from 0 to 1.
 * @param {number} factor The material's roughness factor, above 0.
 */
export function bakedRoughness(roughness, r, factor) {
	if (!(r < 1)) return roughness;
	const r2 = r * r;
	const kappa = (3 * r - r * r2) / (1 - r2);
	const added = Math.min(0.75 / kappa, BAKE_LIMIT * BAKE_LIMIT) / (factor * factor);
	const baked = Math.sqrt(roughness * roughness + added);
	return baked < 1 ? baked : 1;
}

/**
 * The sums of a normal map's unit normals over every rectangle from its corner: one row and
 * column of zeros, then x, y and z of each texel. glTF scales x and y by the normal scale before
 * the normal turns to unit length.
 *
 * @param {Pixels} normals
 * @param {number} scale
 * @returns {Float64Array}
 */
export function normalSums(normals, scale) {
	const { width, height, data } = normals;
	const stride = (width + 1) * 3;
	const sums = new Float64Array((height + 1) * stride);
	for (let y = 0; y < height; y++) {
		let sx = 0;
		let sy = 0;
		let sz = 0;
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const nx = (((data[at] ?? 0) / 255) * 2 - 1) * scale;
			const ny = (((data[at + 1] ?? 0) / 255) * 2 - 1) * scale;
			const nz = ((data[at + 2] ?? 0) / 255) * 2 - 1;
			const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (length > 0) {
				sx += nx / length;
				sy += ny / length;
				sz += nz / length;
			} else sz += 1;
			const out = (y + 1) * stride + (x + 1) * 3;
			const above = y * stride + (x + 1) * 3;
			sums[out] = sx + /** @type {number} */ (sums[above]);
			sums[out + 1] = sy + /** @type {number} */ (sums[above + 1]);
			sums[out + 2] = sz + /** @type {number} */ (sums[above + 2]);
		}
	}
	return sums;
}

/**
 * The first and the past-the-end normal texel under texel `i` of a level `size` texels long,
 * where the normal map is `normals` texels long. Each texel covers at least one normal texel.
 *
 * @param {number} i
 * @param {number} size
 * @param {number} normals
 * @returns {[number, number]}
 */
function span(i, size, normals) {
	const from = Math.floor((i * normals) / size);
	const to = Math.floor(((i + 1) * normals) / size);
	return [from, to > from ? to : from + 1];
}

/**
 * The mip levels of a metal-rough map, from its full size down to 1 x 1, with the bake in the
 * roughness channel, green, of every level below the full size. The full size stays as the
 * author made it, as Godot leaves it: up close, the GPU reads the normal map's own detail. Each
 * level is the map resized from its full size, so no level takes the rounding of the one above.
 * Occlusion, red, and metalness, blue, keep their filtered values.
 *
 * @param {Pixels} image The metal-rough map at its texture size.
 * @param {Pixels} normals The normal map at its texture size.
 * @param {number} scale The normal scale.
 * @param {number} factor The roughness factor, above 0.
 * @returns {Pixels[]}
 */
export function bakeLevels(image, normals, scale, factor) {
	const sums = normalSums(normals, scale);
	const stride = (normals.width + 1) * 3;
	/** @param {number} x @param {number} y @param {number} c */
	const at = (x, y, c) => /** @type {number} */ (sums[y * stride + x * 3 + c]);
	/** @type {Pixels[]} */
	const levels = [image];
	for (let w = image.width, h = image.height; w > 1 || h > 1; ) {
		w = Math.max(1, w >> 1);
		h = Math.max(1, h >> 1);
		const { data } = resizeImage(image, w, h, false);
		for (let y = 0; y < h; y++) {
			const [y0, y1] = span(y, h, normals.height);
			for (let x = 0; x < w; x++) {
				const [x0, x1] = span(x, w, normals.width);
				const count = (x1 - x0) * (y1 - y0);
				let r = 0;
				for (let c = 0; c < 3; c++) {
					const sum = at(x1, y1, c) - at(x0, y1, c) - at(x1, y0, c) + at(x0, y0, c);
					r += (sum / count) * (sum / count);
				}
				const g = (y * w + x) * 4 + 1;
				const roughness = /** @type {number} */ (data[g]) / 255;
				data[g] = Math.round(bakedRoughness(roughness, Math.sqrt(r), factor) * 255);
			}
		}
		levels.push({ width: w, height: h, data });
	}
	return levels;
}
