import { describe, expect, it } from 'bun:test';
import {
	bakeGrade,
	GRADE_SIZE,
	type GradeValues,
	gradeColor,
	type Rgb,
	whiteBalanceGains,
} from './grading';

/** A strong grade, of the kind a colorist sets: a warm balance, a lifted toe and a split tone. */
const WARM: GradeValues = {
	whiteBalance: [3200, 0.2],
	lift: [0.02, 0.01, 0],
	gamma: [0.8, 1, 1.2],
	gain: [1.04, 1.01, 0.9],
	saturation: 0.85,
	shadows: [0.1, 0.2, 0.6],
	highlights: [0.9, 0.7, 0.4],
	balance: 0.3,
	strength: 0.6,
};

/** The values of a picture without a grade. */
const NEUTRAL: GradeValues = {
	whiteBalance: [6500, 0],
	lift: [0, 0, 0],
	gamma: [1, 1, 1],
	gain: [1, 1, 1],
	saturation: 1,
	shadows: [0.5, 0.5, 0.5],
	highlights: [0.5, 0.5, 0.5],
	balance: 0,
	strength: 0,
};

/** The table's texel along one axis for a color's channel, as the final pass places its lookup. */
const texel = (channel: number): number => Math.sqrt(channel) * (GRADE_SIZE - 1);

/** The graded color of `c` as the final pass reads the baked table: a linear filter between texels. */
function lookUp(table: Float32Array, c: Rgb): Rgb {
	const at = c.map(texel);
	const low = at.map(Math.floor);
	const share = at.map((v, i) => v - (low[i] as number));
	const out: [number, number, number] = [0, 0, 0];
	for (let corner = 0; corner < 8; corner++) {
		const offset = [0, 1, 2].map((i) =>
			Math.min((low[i] as number) + ((corner >> i) & 1), GRADE_SIZE - 1),
		);
		const weight = [0, 1, 2].reduce(
			(m, i) => m * (((corner >> i) & 1) === 1 ? (share[i] as number) : 1 - (share[i] as number)),
			1,
		);
		const start =
			4 *
			((offset[0] as number) +
				GRADE_SIZE * (offset[1] as number) +
				GRADE_SIZE * GRADE_SIZE * (offset[2] as number));
		for (let channel = 0; channel < 3; channel++)
			out[channel] = (out[channel] as number) + weight * (table[start + channel] as number);
	}
	return out;
}

describe('the built-in grading table', () => {
	it('matches the analytic reference within one step of an 8-bit canvas', () => {
		const table = bakeGrade(WARM);
		expect(table.length).toBe(GRADE_SIZE ** 3 * 4);
		let worst = 0;
		const steps = 16;
		for (let b = 0; b <= steps; b++) {
			for (let g = 0; g <= steps; g++) {
				for (let r = 0; r <= steps; r++) {
					const c: Rgb = [r / steps, g / steps, b / steps];
					const want = gradeColor(c, WARM);
					const got = lookUp(table, c);
					// The canvas clips a channel past 1, as it does the picture's color.
					for (let channel = 0; channel < 3; channel++) {
						const shown = (v: number) => Math.min(Math.max(v, 0), 1);
						worst = Math.max(
							worst,
							Math.abs(shown(got[channel] as number) - shown(want[channel] as number)) * 255,
						);
					}
				}
			}
		}
		// The recorded tolerance: a strong grade's table holds the analytic reference to under
		// 0.65 of a step of an 8-bit canvas, measured on a grid of 17 colors an axis on 20 October
		// 2026. Half floats keep a channel's overshoot past 1, which clips only on the canvas.
		expect(worst).toBeLessThan(1);
	});

	it('leaves a picture without a grade as it is', () => {
		const table = bakeGrade(NEUTRAL);
		for (const c of [
			[0, 0, 0],
			[0.25, 0.5, 0.75],
			[1, 1, 1],
		] as Rgb[]) {
			const got = lookUp(table, c);
			for (let channel = 0; channel < 3; channel++)
				expect(
					Math.abs((got[channel] as number) - (c[channel] as number)) * 255,
				).toBeLessThanOrEqual(0.5);
		}
	});

	it('takes the light of a low color temperature toward neutral and leaves 6500 kelvin alone', () => {
		const neutral = whiteBalanceGains(6500, 0);
		expect(neutral[0]).toBeCloseTo(1, 3);
		expect(neutral[1]).toBeCloseTo(1, 3);
		expect(neutral[2]).toBeCloseTo(1, 3);
		// A tungsten lamp is redder than daylight, so its correction raises blue most.
		const tungsten = whiteBalanceGains(3200, 0);
		expect(tungsten[2]).toBeGreaterThan(tungsten[1]);
		expect(tungsten[1]).toBeGreaterThan(tungsten[0]);
		// A magenta tint takes green away, and a green tint adds it.
		expect(whiteBalanceGains(6500, 1)[1]).toBeLessThan(1);
		expect(whiteBalanceGains(6500, -1)[1]).toBeGreaterThan(1);
	});
});
