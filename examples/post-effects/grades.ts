// The color grading tables that the post effects demo cycles through, made in code from the numbers
// a colorist sets, as a .cube file would hold them.
import type { Assets } from '@null3d/engine';

type Rgb = readonly [number, number, number];

/** A grade: contrast and saturation, then lift, gamma and gain per channel, as a colorist sets them. */
export interface Look {
	contrast?: number;
	saturation?: number;
	lift?: Rgb;
	gamma?: Rgb;
	/** Gain per channel, which sets the white balance too. */
	gain: Rgb;
}

/** Warmer whites and lifted shadows. */
export const WARM: Look = {
	lift: [0.02, 0.01, 0],
	gamma: [0.95, 1, 1.05],
	gain: [1.04, 1.01, 0.9],
};
/** More contrast, less saturation and a blue cast. */
export const COOL: Look = { contrast: 1.15, saturation: 0.85, gain: [0.94, 0.99, 1.06] };

/** A table of 33 texels a side that grades each color by `look`, red fastest as in a .cube file. */
export function grade(assets: Assets, look: Look) {
	const { contrast = 1, saturation = 1, lift = [0, 0, 0], gamma = [1, 1, 1], gain } = look;
	const size = 33;
	const data = new Float32Array(size ** 3 * 3);
	const contrasted = (v: number) =>
		Math.min(Math.max((v / (size - 1) - 0.5) * contrast + 0.5, 0), 1);
	const channel = (value: number, luma: number, i: 0 | 1 | 2) =>
		lift[i] + Math.max(luma + (value - luma) * saturation, 0) ** gamma[i] * gain[i];
	let at = 0;
	for (let b = 0; b < size; b++)
		for (let g = 0; g < size; g++)
			for (let r = 0; r < size; r++) {
				const [red, green, blue] = [contrasted(r), contrasted(g), contrasted(b)];
				const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				data[at++] = channel(red, luma, 0);
				data[at++] = channel(green, luma, 1);
				data[at++] = channel(blue, luma, 2);
			}
	return assets.lutFromData({ size, data });
}
