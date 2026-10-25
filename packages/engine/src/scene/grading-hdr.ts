// The grading table over high dynamic range color: white balance, then saturation, lift, gamma and
// gain, then split toning, all on the ARRI LogC encoding of the light, which is how a color grading
// tool holds a film image. The tone curve stays in the shader, after the table: a 32-texel table
// cannot hold a curve whose punchy look clamps each channel at black, and the measured error at
// dark saturated colors reached 6 steps of an 8-bit canvas.
//
// A texel holds the graded light of its place, red fastest then green then blue. The final pass
// applies the exact tone curve to the light it reads. The domain reaches the LogC code that 58.86
// stands for, which is every light a scene holds in 16-bit floats before the curve turns it white.
// This module runs in a job worker, and its math is the reference that the tests compare the table
// with.

import {
	GRADE_SIZE,
	type GradeValues,
	type GradingGains,
	type Rgb,
	resolveGradingGains,
} from './grading';

/** The most that the table's domain reaches, in linear light: the LogC code 1 stands for it. */
export const GRADE_HDR_MAX = 58.856_66;

/** The linear light below which ARRI LogC encodes with its straight segment. */
const LOG_C_CUT = 0.011_361;
/** The LogC curve's four constants and its straight segment's two. */
const LOG_C_MUL = 5.555_556;
const LOG_C_OFFSET = 0.047_996;
const LOG_C_SCALE = 0.244_161;
const LOG_C_SHIFT = 0.386_036;
const LOG_C_SLOPE = 5.301_883;
const LOG_C_LINEAR = 0.092_819;

/** The LogC code of the straight segment's end, which both halves of the curve share. */
const LOG_C_CUT_CODE = LOG_C_SCALE * Math.log10(LOG_C_MUL * LOG_C_CUT + LOG_C_OFFSET) + LOG_C_SHIFT;

/** The ARRI LogC code (EI 1000) of linear light `x`, as the table's domain places it. */
export function encodeLogC(x: number): number {
	return x > LOG_C_CUT
		? LOG_C_SCALE * Math.log10(LOG_C_MUL * x + LOG_C_OFFSET) + LOG_C_SHIFT
		: LOG_C_SLOPE * x + LOG_C_LINEAR;
}

/** The linear light that ARRI LogC code `code` stands for. */
export function decodeLogC(code: number): number {
	return code > LOG_C_CUT_CODE
		? (10 ** ((code - LOG_C_SHIFT) / LOG_C_SCALE) - LOG_C_OFFSET) / LOG_C_MUL
		: (code - LOG_C_LINEAR) / LOG_C_SLOPE;
}

/** The luma weights of Rec. 709, which the engine's grading shares. */
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];

const luma = (c: Rgb): number => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/** The smoothstep from 0 at `low` to 1 at `high`. */
function smoothstep(low: number, high: number, value: number): number {
	const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
	return t * t * (3 - 2 * t);
}

/**
 * The graded linear light of exposed linear light `c` for the grading `values`. The controls act on
 * the LogC codes of the light, so a value above the canvas's white still takes its share of the
 * grade before the tone curve turns it white. This is the reference that the baked table matches
 * between its texels.
 */
export function gradeHdrColor(c: Rgb, values: GradeValues, gains: GradingGains): Rgb {
	const balanced: Rgb = [
		Math.max(c[0], 0) * gains.gains[0],
		Math.max(c[1], 0) * gains.gains[1],
		Math.max(c[2], 0) * gains.gains[2],
	];
	const codes: Rgb = [encodeLogC(balanced[0]), encodeLogC(balanced[1]), encodeLogC(balanced[2])];
	const mid = luma(codes);
	const colored: Rgb = [
		mid + (codes[0] - mid) * values.saturation,
		mid + (codes[1] - mid) * values.saturation,
		mid + (codes[2] - mid) * values.saturation,
	];
	const toned: Rgb = [0, 1, 2].map((i) => {
		const v = Math.max((colored[i] as number) + (values.lift[i] as number), 0);
		return v ** (1 / (values.gamma[i] as number)) * (values.gain[i] as number);
	}) as unknown as Rgb;
	const balance = 0.5 + 0.4 * values.balance;
	const top = values.strength * smoothstep(balance - 0.25, balance + 0.25, luma(toned));
	const bottom = values.strength - top;
	const graded = [0, 1, 2].map(
		(i) =>
			Math.min(
				Math.max(
					(toned[i] as number) +
						(gains.shadowChroma[i] as number) * bottom +
						(gains.highlightChroma[i] as number) * top,
					0,
				),
				1,
			) as number,
	);
	return [
		Math.max(decodeLogC(graded[0] as number), 0),
		Math.max(decodeLogC(graded[1] as number), 0),
		Math.max(decodeLogC(graded[2] as number), 0),
	];
}

/**
 * Bakes the table over high dynamic range light for the grading `values`: four half-float numbers
 * per texel, red fastest then green then blue, with the graded light in the first three. The first
 * and last texels hold the ends of the LogC domain, as the final pass places its lookup.
 */
export function bakeGradeHdr(values: GradeValues, size = GRADE_SIZE): Float32Array {
	const gains = resolveGradingGains(values);
	const texels = new Float32Array(size * size * size * 4);
	const last = size - 1;
	let at = 0;
	for (let b = 0; b < size; b++) {
		const blue = Math.max(decodeLogC(b / last), 0);
		for (let g = 0; g < size; g++) {
			const green = Math.max(decodeLogC(g / last), 0);
			for (let r = 0; r < size; r++) {
				const red = Math.max(decodeLogC(r / last), 0);
				const graded = gradeHdrColor([red, green, blue], values, gains);
				texels[at++] = graded[0];
				texels[at++] = graded[1];
				texels[at++] = graded[2];
				texels[at++] = 1;
			}
		}
	}
	return texels;
}
