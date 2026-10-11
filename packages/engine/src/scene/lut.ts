// Color grading tables: a 3D texture that maps each display color to its graded color, which
// `post.set({ lut })` applies in the final pass. `assets.loadLut` reads them from `.cube` and
// `.3dl` files, and `assets.lutFromData` makes them from numbers, with the makers in lut-files.ts.

import type { Texture } from './textures';

/**
 * The colors that a table's first and last texels stand for along each axis: red, green and blue.
 *
 * @category api/assets
 */
export type LutDomain = readonly [number, number, number];

/**
 * A color grading table's size and colors for `assets.lutFromData`, in the order of a `.cube`
 * file's lines.
 *
 * @category api/assets
 */
export interface LutData {
	/** The texels along each side of the table, a whole number from 2 to 256. */
	size: number;
	/**
	 * The graded color of each texel: three numbers per texel, red, green and blue, or four, whose
	 * fourth the table skips. Red changes fastest, then green, then blue, as in a `.cube` file. The
	 * texel at red r, green g and blue b stands for the color (r, g, b) / (size - 1) of the domain.
	 * Values are display colors from 0 to 1, and values outside that range are clamped.
	 */
	data: Float32Array | Float64Array | readonly number[];
	/** The color that the first texel along each axis stands for. The default is [0, 0, 0]. */
	domainMin?: LutDomain;
	/** The color that the last texel along each axis stands for. The default is [1, 1, 1]. */
	domainMax?: LutDomain;
	/** A name for the table, which becomes its `title`. */
	title?: string;
}

/**
 * A color grading table, which `assets.loadLut` loads from a file and `assets.lutFromData` makes
 * from numbers. It is a 3D texture that maps each color of the picture to its graded color. Give
 * it to `post.set({ lut })`, which applies it to every pixel after the tone mapping, as three.js's
 * `LUTPass` does.
 *
 * @category api/assets
 */
export class Lut {
	/** @internal */
	constructor(
		/** @internal The table's 3D texture. */
		readonly texture: Texture,
		/** The texels along each side of the table, such as 33 or 65. */
		readonly size: number,
		/** The title that a `.cube` file or `lutFromData` names, or undefined. */
		readonly title: string | undefined,
		/** The color that the first texel along each axis stands for: 0 in most files. */
		readonly domainMin: LutDomain,
		/** The color that the last texel along each axis stands for: 1 in most files. */
		readonly domainMax: LutDomain,
	) {}

	/** The GPU bytes of the table: four for each texel. */
	get bytes(): number {
		return this.texture.bytes;
	}

	/**
	 * Frees the table's GPU memory. If `post.set` named the table last, the picture shows without
	 * grading from then on. Passing the table to `post.set` afterwards, or destroying it again,
	 * throws E1101.
	 */
	destroy(): void {
		this.texture.destroy();
	}
}
