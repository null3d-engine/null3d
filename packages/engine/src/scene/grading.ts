// The grading controls that `post.set({ grading })` sets, and the 32-texel table that a job worker
// bakes from them: white balance, lift, gamma, gain, saturation and split toning, each applied to
// the picture's display color after the tone mapping. The final pass reads the table, so changing a
// value costs the frames nothing but a texture upload that the worker computed.
//
// The lookup takes the color's square root first, so the table's texels lie closer together toward
// black, where a grade's curve is steepest. This module is loaded on first use, and the job worker
// imports it too, so the bake and the reference that tests compare with are one function.

import type { ColorInput } from './color';

/** Three numbers, red first. */
export type Rgb = readonly [number, number, number];

/**
 * The color temperature that whites take, and the green to magenta shift around it.
 *
 * @category api/post
 */
export interface WhiteBalanceSettings {
	/**
	 * The color temperature of the light that whites are corrected for, in kelvin: 6500 is
	 * neutral. A lower value, such as 3200 for a tungsten lamp, makes the picture cooler, and a
	 * higher one, such as 8000 in the shade, makes it warmer. The value is between 1667 and 25000.
	 */
	temperature?: number;
	/**
	 * The green to magenta shift, from -1 for green to 1 for magenta. It is 0 by default, and each
	 * step of 1 halves or doubles the green channel.
	 */
	tint?: number;
}

/**
 * The colors that tint the shadows and the highlights, and where the split between them falls.
 *
 * @category api/post
 */
export interface SplitToningSettings {
	/**
	 * The hue that tints the dark parts of the picture, as a color. Its brightness does not matter,
	 * only the hue that it adds: a gray tint changes nothing.
	 */
	shadows?: ColorInput;
	/** The hue that tints the bright parts of the picture, as a color. */
	highlights?: ColorInput;
	/**
	 * Where the split between shadows and highlights falls, from -1 to 1: 0 the middle of the
	 * picture's brightness, higher values tint more of it with the shadows' hue, and lower values
	 * more with the highlights'.
	 */
	balance?: number;
	/** How much of the tints reaches the picture, from 0 for none to 1 for the most. */
	strength?: number;
}

/**
 * The grading controls that `post.set` takes: white balance, then lift, gamma and gain on each
 * channel, then saturation, then split toning. A job worker bakes them into a table of 32 texels a
 * side, which the final pass reads on every GPU path. A setting that a call leaves out keeps its
 * value; `false` turns the grading off.
 *
 * @category api/post
 */
export interface GradingSettings {
	/** Corrects the light's color temperature, or `false` to leave colors as they are. */
	whiteBalance?: WhiteBalanceSettings | false;
	/**
	 * Adds a value to each channel before the curve: 0 leaves a channel as it is, and positive
	 * values lift the blacks. Each channel's value is between -1 and 1.
	 */
	lift?: readonly [number, number, number];
	/**
	 * The gamma of each channel, above 0. A channel is raised to the power of one over its gamma, so
	 * values above 1 brighten the shadows and 1 leaves the channel as it is.
	 */
	gamma?: readonly [number, number, number];
	/**
	 * A factor for each channel, from 0 up: 1 leaves a channel as it is, and higher values brighten
	 * the highlights and the whites.
	 */
	gain?: readonly [number, number, number];
	/** How much color the picture keeps: 0 is gray, 1 leaves it as it is, and higher values add color. */
	saturation?: number;
	/** Tints the shadows and the highlights with a hue each, or `false` to leave them as they are. */
	splitToning?: SplitToningSettings | false;
}

/** The texels along each side of the baked table. */
export const GRADE_SIZE = 32;

/** The grading values as `post.set` resolved them: plain numbers, which a job worker can take. */
export interface GradeValues {
	/** The color temperature in kelvin, and the green to magenta shift. */
	whiteBalance: readonly [number, number];
	lift: Rgb;
	gamma: Rgb;
	gain: Rgb;
	saturation: number;
	/** The shadows' and the highlights' display colors, the split's balance and its strength. */
	shadows: Rgb;
	highlights: Rgb;
	balance: number;
	strength: number;
}

/** The luma weights of Rec. 709, which the engine's tone curves and its grading share. */
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];

const luma = (c: Rgb): number => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/**
 * The chromaticity of a black body at `temperature` kelvin, as x and y, from Kim and others'
 * cubic fit of the Planckian locus. It holds from 1667 to 25000 kelvin.
 */
function blackBody(temperature: number): [number, number] {
	const t = Math.min(Math.max(temperature, 1667), 25000);
	const x =
		t <= 4000
			? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
			: -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
	const y =
		t <= 2222
			? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
			: t <= 4000
				? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
				: 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
	return [x, y];
}

/** The linear sRGB values of a chromaticity, with a luma of 1. */
function chromaticityToRgb([x, y]: [number, number]): Rgb {
	const scale = 1 / y;
	const [X, Y, Z] = [x * scale, 1, (1 - x - y) * scale];
	return [
		3.2406 * X - 1.5372 * Y - 0.4986 * Z,
		-0.9689 * X + 1.8758 * Y + 0.0415 * Z,
		0.0557 * X - 0.204 * Y + 1.057 * Z,
	];
}

/** The luma of a color as 1, so that a white balance changes the hue alone. */
function normalized(gains: Rgb): Rgb {
	const l = luma(gains);
	if (!(l > 1e-6)) return [1, 1, 1];
	return [gains[0] / l, gains[1] / l, gains[2] / l];
}

/** The neutral white of daylight at 6500 kelvin, which a temperature corrects toward. */
const D65 = chromaticityToRgb(blackBody(6500));

/**
 * The factor of each channel that corrects color shot under the light of `temperature` kelvin, with
 * the `tint` shifting green against magenta: the light's own white becomes the neutral white.
 */
export function whiteBalanceGains(temperature: number, tint: number): Rgb {
	const white = chromaticityToRgb(blackBody(temperature));
	// The green channel halves at -1 and doubles at 1, as a photographer's tint does.
	const green = 2 ** -Math.min(Math.max(tint, -1), 1);
	return normalized([D65[0] / white[0], (D65[1] / white[1]) * green, D65[2] / white[2]]);
}

/** The smoothstep from 0 at `low` to 1 at `high`. */
function smoothstep(low: number, high: number, value: number): number {
	const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
	return t * t * (3 - 2 * t);
}

/**
 * The white balance's factors and the split toning's chroma, which a bake resolves once for the
 * whole table.
 *
 * @internal
 */
export interface GradingGains {
	gains: Rgb;
	shadowChroma: Rgb;
	highlightChroma: Rgb;
}

/** A color's chroma: its color with its luma removed. */
function chroma(color: Rgb): Rgb {
	const l = luma(color);
	return [color[0] - l, color[1] - l, color[2] - l];
}

/**
 * The white balance's factors and the split toning's chroma, resolved once for a whole bake. The
 * display-space table and the table over high dynamic range color share them.
 *
 * @internal
 */
export function resolveGradingGains(values: GradeValues): GradingGains {
	return {
		gains: whiteBalanceGains(values.whiteBalance[0], values.whiteBalance[1]),
		shadowChroma: chroma(values.shadows),
		highlightChroma: chroma(values.highlights),
	};
}

/**
 * The graded display color of display color `c` for `values`, as the table's texels hold it: white
 * balance, then saturation around the luma, then lift, gamma and gain on each channel, then split
 * toning. A channel may pass 1, which the canvas's own clip then takes away: the table keeps that
 * overshoot, so a color that crosses the clip inside a texel's cell still interpolates as the
 * reference does. This is the reference: the baked table matches it between its texels.
 */
export function gradeColor(c: Rgb, values: GradeValues): Rgb {
	return gradeWith(c, values, resolveGradingGains(values));
}

/** [`gradeColor`] with the gains resolved once, which a bake through the whole table reuses. */
function gradeWith(c: Rgb, values: GradeValues, gains: GradingGains): Rgb {
	const wb = gains.gains;
	const balanced: Rgb = [c[0] * wb[0], c[1] * wb[1], c[2] * wb[2]];
	const l = luma(balanced);
	const saturation = values.saturation;
	const colored: Rgb = [
		l + (balanced[0] - l) * saturation,
		l + (balanced[1] - l) * saturation,
		l + (balanced[2] - l) * saturation,
	];
	const toned: Rgb = [0, 1, 2].map((i) => {
		const v = Math.max((colored[i] as number) + (values.lift[i] as number), 0);
		return v ** (1 / (values.gamma[i] as number)) * (values.gain[i] as number);
	}) as unknown as Rgb;
	// The balance moves the brightness at which the shadows' hue gives way to the highlights'.
	const mid = 0.5 + 0.4 * values.balance;
	const top = values.strength * smoothstep(mid - 0.25, mid + 0.25, luma(toned));
	const bottom = values.strength - top;
	const channel = (i: 0 | 1 | 2) =>
		Math.max(
			(toned[i] as number) +
				(gains.shadowChroma[i] as number) * bottom +
				(gains.highlightChroma[i] as number) * top,
			0,
		);
	return [channel(0), channel(1), channel(2)];
}

/**
 * Bakes the table of `values`: four half-float numbers per texel, red fastest then green then blue,
 * as a 3D texture holds them. Each texel stands for the graded color of the square of its place
 * along each axis, which the final pass's lookup takes before it reads the table. Half floats keep a
 * channel's overshoot past 1, which an 8-bit texel would clip inside its cell.
 */
export function bakeGrade(values: GradeValues, size = GRADE_SIZE): Float32Array {
	const gains = resolveGradingGains(values);
	const texels = new Float32Array(size * size * size * 4);
	const last = size - 1;
	let at = 0;
	for (let b = 0; b < size; b++) {
		const blue = (b / last) ** 2;
		for (let g = 0; g < size; g++) {
			const green = (g / last) ** 2;
			for (let r = 0; r < size; r++) {
				const red = (r / last) ** 2;
				const graded = gradeWith([red, green, blue], values, gains);
				texels[at++] = graded[0];
				texels[at++] = graded[1];
				texels[at++] = graded[2];
				texels[at++] = 1;
			}
		}
	}
	return texels;
}
