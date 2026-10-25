import { describe, expect, it } from 'bun:test';
import { linearToSrgb } from '../math/color';
import {
	bakeGrade,
	GRADE_SIZE,
	type GradeValues,
	type Rgb,
	resolveGradingGains,
	whiteBalanceGains,
} from './grading';
import { bakeGradeHdr, decodeLogC, encodeLogC, GRADE_HDR_MAX, gradeHdrColor } from './grading-hdr';

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

/** The table's texel along one axis for a LogC code, as the final pass places its lookup. */
const texel = (code: number): number => code * (GRADE_SIZE - 1);

/** The graded light of `c` as the final pass reads the baked table: a linear filter between
 * texels. */
function lookUp(table: Float32Array, c: Rgb): Rgb {
	const at = [0, 1, 2].map((axis) =>
		texel(Math.min(Math.max(encodeLogC(Math.max(c[axis] as number, 0)), 0), 1)),
	);
	const low = at.map(Math.floor);
	const share = at.map((v, axis) => v - (low[axis] as number));
	const out: [number, number, number] = [0, 0, 0];
	for (let corner = 0; corner < 8; corner++) {
		const offset = [0, 1, 2].map((axis) =>
			Math.min(Math.max((low[axis] as number) + ((corner >> axis) & 1), 0), GRADE_SIZE - 1),
		);
		const weight = [0, 1, 2].reduce(
			(m, axis) =>
				m * (((corner >> axis) & 1) === 1 ? (share[axis] as number) : 1 - (share[axis] as number)),
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

/** The worst distance of the table from the analytic reference over a ramp of light. */
function worstError(values: GradeValues): number {
	const table = bakeGradeHdr(values);
	const gains = resolveGradingGains(values);
	let worst = 0;
	const steps = 16;
	for (let b = 0; b <= steps; b++) {
		for (let g = 0; g <= steps; g++) {
			for (let r = 0; r <= steps; r++) {
				// The ramp spaces its light logarithmically, as a picture's light falls.
				const light = (i: number): number => Math.max(0.00005 * 1000 ** (i / steps), 0);
				const c: Rgb = [light(r), light(g), light(b)];
				const want = gradeHdrColor(c, values, gains);
				const got = lookUp(table, c);
				for (let channel = 0; channel < 3; channel++) {
					const shown = (v: number) => linearToSrgb(Math.min(Math.max(v, 0), 1));
					worst = Math.max(
						worst,
						Math.abs(shown(want[channel] as number) - shown(got[channel] as number)),
					);
				}
			}
		}
	}
	return worst;
}

describe('the LogC domain', () => {
	it('round trips linear light through its code', () => {
		for (const light of [0, 1e-4, 0.001, 0.01, 0.18, 1, 8, 58.8]) {
			expect(decodeLogC(encodeLogC(light))).toBeCloseTo(light, 4);
		}
		expect(encodeLogC(0)).toBeGreaterThan(0);
		expect(encodeLogC(GRADE_HDR_MAX)).toBeCloseTo(1, 4);
	});

	it('reaches every light a scene holds in 16-bit floats, as the plan reaches 59', () => {
		expect(GRADE_HDR_MAX).toBeCloseTo(59, 0);
		expect(decodeLogC(1)).toBeGreaterThan(50);
	});
});

describe('the table over high dynamic range light', () => {
	it('matches the analytic grade closely over the picture', () => {
		// The LogC domain gives the darkest light about two texels, so a strong grade with a split
		// tone misses a step of the canvas there: the worst is about 5 steps. Everywhere else the
		// table matches within a step. The display-space table keeps the exact grade in the darks.
		expect(worstError(WARM)).toBeLessThanOrEqual(5 / 255);
	});

	it('leaves the light as it is while the values are neutral', () => {
		const table = bakeGradeHdr(NEUTRAL);
		const gains = resolveGradingGains(NEUTRAL);
		for (const light of [0.001, 0.05, 0.18, 1, 8]) {
			const want = gradeHdrColor([light, light, light], NEUTRAL, gains);
			const got = lookUp(table, [light, light, light]);
			for (let channel = 0; channel < 3; channel++) {
				// The table interpolates linear light across a logarithmic cell, which costs about
				// a step of the canvas in the midtones.
				const shown = (v: number) => linearToSrgb(Math.min(Math.max(v, 0), 1));
				expect(shown(got[channel] as number)).toBeCloseTo(shown(want[channel] as number), 2);
			}
		}
	});

	it('grades a light past the canvas white before the curve reaches it', () => {
		// The same control lifts the light differently before and after the curve: here the light
		// itself changes, and the curve has not run yet.
		const table = bakeGradeHdr(WARM);
		const gain = bakeGradeHdr({ ...NEUTRAL, gain: [1.5, 1.5, 1.5] });
		const lit = lookUp(table, [1, 1, 1]);
		const raised = lookUp(gain, [1, 1, 1]);
		expect(raised[0]).toBeGreaterThan(lit[0] as number);
		expect(raised[0]).toBeGreaterThan(1);
	});

	it('uses a display-space table for the design that grades after the curve', () => {
		expect(bakeGrade(WARM).length).toBe(GRADE_SIZE ** 3 * 4);
	});
});

/** The luma weights of Rec. 709, written here from the definition that the controls share. */
const WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

const lumaOf = (c: Rgb): number => WEIGHTS[0] * c[0] + WEIGHTS[1] * c[1] + WEIGHTS[2] * c[2];

const clamped = (value: number): number => Math.min(Math.max(value, 0), 1);

/** A color's chroma: its channels with their luma removed, which is what a tint adds. */
function chromaOf(c: Rgb): Rgb {
	const level = lumaOf(c);
	return [c[0] - level, c[1] - level, c[2] - level];
}

/** The highlights' share of a split tone at a graded code, from the balance and its smoothstep. */
function highlightShare(level: number, balance: number): number {
	const mid = 0.5 + 0.4 * balance;
	const t = clamped((level - (mid - 0.25)) / 0.5);
	return t * t * (3 - 2 * t);
}

/**
 * The graded light that the controls define for light `c`, written here from their documented
 * order on the LogC codes: white balance, saturation around the luma, lift and gamma and gain per
 * channel, then the split tone. The log code and its inverse are the engine's, and their own test
 * covers them.
 */
function referenceHdr(c: Rgb, values: GradeValues, whiteBalance: Rgb): Rgb {
	const codes: Rgb = [0, 1, 2].map((channel) =>
		encodeLogC(Math.max(c[channel] as number, 0) * (whiteBalance[channel] as number)),
	) as unknown as Rgb;
	const level = lumaOf(codes);
	const colored: Rgb = [0, 1, 2].map(
		(channel) => level + ((codes[channel] as number) - level) * values.saturation,
	) as unknown as Rgb;
	const toned: Rgb = [0, 1, 2].map(
		(channel) =>
			Math.max((colored[channel] as number) + (values.lift[channel] as number), 0) **
				(1 / (values.gamma[channel] as number)) *
			(values.gain[channel] as number),
	) as unknown as Rgb;
	const share = values.strength * highlightShare(lumaOf(toned), values.balance);
	const shadows = chromaOf(values.shadows);
	const highlights = chromaOf(values.highlights);
	const graded: Rgb = [0, 1, 2].map((channel) =>
		clamped(
			(toned[channel] as number) +
				(shadows[channel] as number) * (values.strength - share) +
				(highlights[channel] as number) * share,
		),
	) as unknown as Rgb;
	return [0, 1, 2].map((channel) => decodeLogC(graded[channel] as number)) as unknown as Rgb;
}

describe('the light table against an analytic reference', () => {
	it('holds the closed form of a gain on its texels', () => {
		const table = bakeGradeHdr({ ...NEUTRAL, gain: [1.2, 1, 0.8] });
		for (const code of [0, 0.25, 0.5, 0.75, 1]) {
			const at = Math.round(code * (GRADE_SIZE - 1));
			const texel = 4 * (at + GRADE_SIZE * at + GRADE_SIZE * GRADE_SIZE * at);
			// The texel's code names its light, the gain acts on that code, and the light is the
			// code's inverse, which stops at black.
			const light = Math.max(decodeLogC(at / (GRADE_SIZE - 1)), 0);
			const want = [1.2, 1, 0.8].map((gain) =>
				Math.max(decodeLogC(clamped(encodeLogC(light) * gain)), 0),
			);
			for (let channel = 0; channel < 3; channel++)
				expect(table[texel + channel] as number).toBeCloseTo(want[channel] as number, 5);
		}
	});

	it('misses its analytic reference by under eight steps over the whole domain', () => {
		// The recorded figure of 4.80 came from 17 points an axis against the bake's own function. A
		// fine grid against this reference finds 7.2 steps, and 10% of colors outside one step. The
		// domain gives the darkest light about two texels, and the error sits there.
		const table = bakeGradeHdr(WARM);
		const gains = whiteBalanceGains(WARM.whiteBalance[0], WARM.whiteBalance[1]);
		let worst = 0;
		const steps = 48;
		for (let blue = 0; blue <= steps; blue++)
			for (let green = 0; green <= steps; green++)
				for (let red = 0; red <= steps; red++) {
					const light = [red, green, blue].map((code) =>
						decodeLogC(code / steps),
					) as unknown as Rgb;
					const want = referenceHdr(light, WARM, gains);
					const got = lookUp(table, light);
					for (let channel = 0; channel < 3; channel++)
						worst = Math.max(
							worst,
							Math.abs(
								linearToSrgb(clamped(got[channel] as number)) -
									linearToSrgb(clamped(want[channel] as number)),
							) * 255,
						);
				}
		expect(worst).toBeLessThan(8);
	});
});
