import { describe, expect, it } from 'bun:test';
import { bakeGrade, GRADE_SIZE, type GradeValues, type Rgb, whiteBalanceGains } from './grading';

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

/** The color that the table holds at a texel, with the texel clamped at the table's edges. */
function texelAt(table: Float32Array, at: readonly number[]): Rgb {
	const last = GRADE_SIZE - 1;
	return texelValue(
		table,
		Math.min(Math.max(at[0] as number, 0), last),
		Math.min(Math.max(at[1] as number, 0), last),
		Math.min(Math.max(at[2] as number, 0), last),
	);
}

/**
 * The graded color of `c` as the final pass reads the baked table: the table's square-root grid,
 * then a linear filter between the eight texels of the cell that holds the color, which is what
 * the final pass's sampler does. A tetrahedral read of four texels was measured and is worse for
 * this table: see D-214.
 */
function lookUp(table: Float32Array, c: Rgb): Rgb {
	const pos = c.map(texel);
	const low = pos.map(Math.floor);
	const share = pos.map((value, axis) => value - (low[axis] as number));
	const out: [number, number, number] = [0, 0, 0];
	for (let corner = 0; corner < 8; corner++) {
		const at = [0, 1, 2].map((axis) =>
			Math.min((low[axis] as number) + ((corner >> axis) & 1), GRADE_SIZE - 1),
		);
		const weight = [0, 1, 2].reduce(
			(product, axis) =>
				product *
				(((corner >> axis) & 1) === 1 ? (share[axis] as number) : 1 - (share[axis] as number)),
			1,
		);
		const texel = texelAt(table, at);
		for (let channel = 0; channel < 3; channel++)
			out[channel] = (out[channel] as number) + weight * (texel[channel] as number);
	}
	return out;
}

describe('the built-in grading table', () => {
	it('holds four numbers per texel, red fastest', () => {
		expect(bakeGrade(WARM).length).toBe(GRADE_SIZE ** 3 * 4);
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
	});

	/**
	 * The tint's meaning in closed form: each step of 1 halves or doubles the green channel, and
	 * the factors then keep the luma at 1. A test that read only green's direction would pass a
	 * tint that halved twice as fast.
	 */
	it('halves the green channel at a tint of 1 and doubles it at -1', () => {
		const normalized = (channels: Rgb): Rgb => {
			const level = lumaOf(channels);
			return [channels[0] / level, channels[1] / level, channels[2] / level];
		};
		const magenta = normalized([1, 0.5, 1]);
		const green = normalized([1, 2, 1]);
		for (let channel = 0; channel < 3; channel++) {
			expect(whiteBalanceGains(6500, 1)[channel] as number).toBeCloseTo(
				magenta[channel] as number,
				5,
			);
			expect(whiteBalanceGains(6500, -1)[channel] as number).toBeCloseTo(
				green[channel] as number,
				5,
			);
		}
	});

	it('keeps every white balance at a luma of 1', () => {
		for (const temperature of [1667, 3200, 6500, 9000, 25000])
			for (const tint of [-1, -0.4, 0, 0.7, 1])
				expect(lumaOf(whiteBalanceGains(temperature, tint))).toBeCloseTo(1, 4);
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

/** The highlights' share of a split tone at a graded luma, from the balance and its smoothstep. */
function highlightShare(level: number, balance: number): number {
	const mid = 0.5 + 0.4 * balance;
	const t = clamped((level - (mid - 0.25)) / 0.5);
	return t * t * (3 - 2 * t);
}

/**
 * The graded display color that the controls define for `c`, written here from their documented
 * order: white balance, saturation around the luma, lift and gamma and gain per channel, then the
 * split tone. The function calls nothing of the engine. The test takes the white-balance factors
 * from it, and the tests above pin the tint's halving and the luma those factors keep.
 */
function reference(c: Rgb, values: GradeValues, whiteBalance: Rgb): Rgb {
	const balanced: Rgb = [c[0] * whiteBalance[0], c[1] * whiteBalance[1], c[2] * whiteBalance[2]];
	const level = lumaOf(balanced);
	const colored: Rgb = [
		level + (balanced[0] - level) * values.saturation,
		level + (balanced[1] - level) * values.saturation,
		level + (balanced[2] - level) * values.saturation,
	];
	// A channel takes its lift before its gamma, and its gain after it.
	const toned: Rgb = [0, 1, 2].map((channel) => {
		const lifted = Math.max((colored[channel] as number) + (values.lift[channel] as number), 0);
		return lifted ** (1 / (values.gamma[channel] as number)) * (values.gain[channel] as number);
	}) as unknown as Rgb;
	const share = values.strength * highlightShare(lumaOf(toned), values.balance);
	const shadows = chromaOf(values.shadows);
	const highlights = chromaOf(values.highlights);
	return [0, 1, 2].map((channel) =>
		Math.max(
			(toned[channel] as number) +
				(shadows[channel] as number) * (values.strength - share) +
				(highlights[channel] as number) * share,
			0,
		),
	) as unknown as Rgb;
}

/** The display color that a texel of the table stands for: the square of its place along each axis. */
function texelColor(red: number, green: number, blue: number): Rgb {
	const last = GRADE_SIZE - 1;
	return [(red / last) ** 2, (green / last) ** 2, (blue / last) ** 2];
}

/** The color that the table holds at a texel: red fastest, then green, then blue. */
function texelValue(table: Float32Array, red: number, green: number, blue: number): Rgb {
	const at = 4 * (red + GRADE_SIZE * (green + GRADE_SIZE * blue));
	return [table[at] as number, table[at + 1] as number, table[at + 2] as number];
}

/** Texels of every kind: black, white, the middle, and colors on three axes. */
const TEXELS = [
	[0, 0, 0],
	[3, 17, 29],
	[7, 24, 11],
	[16, 16, 16],
	[31, 31, 31],
	[31, 0, 0],
	[0, 31, 0],
	[0, 0, 31],
] as const;

describe('the baked table against an analytic reference', () => {
	/**
	 * Each control alone has a closed form. The check reads a texel and compares it with that form at
	 * the color the texel stands for, so a wrong order, a wrong exponent or a wrong grid fails here.
	 */
	it('holds the closed form of each control alone on its texels', () => {
		const cases: { name: string; values: GradeValues; want: (c: Rgb) => Rgb }[] = [
			{
				name: 'lift',
				values: { ...NEUTRAL, lift: [0.1, 0.2, 0.3] },
				want: (c) => [c[0] + 0.1, c[1] + 0.2, c[2] + 0.3],
			},
			{
				name: 'gamma',
				values: { ...NEUTRAL, gamma: [0.5, 2, 1.25] },
				want: (c) => [c[0] ** 2, c[1] ** 0.5, c[2] ** (1 / 1.25)],
			},
			{
				name: 'gain',
				values: { ...NEUTRAL, gain: [1.5, 1, 0.5] },
				want: (c) => [c[0] * 1.5, c[1], c[2] * 0.5],
			},
			{
				name: 'saturation',
				values: { ...NEUTRAL, saturation: 0.4 },
				want: (c) => {
					const level = lumaOf(c);
					return [
						level + (c[0] - level) * 0.4,
						level + (c[1] - level) * 0.4,
						level + (c[2] - level) * 0.4,
					];
				},
			},
		];
		for (const { name, values, want } of cases) {
			const table = bakeGrade(values);
			for (const [red, green, blue] of TEXELS) {
				const expected = want(texelColor(red, green, blue));
				const got = texelValue(table, red, green, blue);
				for (let channel = 0; channel < 3; channel++)
					expect(got[channel], `${name} at texel ${red},${green},${blue}`).toBeCloseTo(
						expected[channel] as number,
						6,
					);
			}
		}
	});

	/**
	 * The worst distance of the table from the reference at one color, of an 8-bit step. The table
	 * keeps a channel's overshoot past white, and the canvas takes it away.
	 */
	function errorAt(table: Float32Array, c: Rgb, values: GradeValues, gains: Rgb): number {
		const want = reference(c, values, gains);
		const got = lookUp(table, c);
		let worst = 0;
		for (let channel = 0; channel < 3; channel++)
			worst = Math.max(
				worst,
				Math.abs(clamped(got[channel] as number) - clamped(want[channel] as number)) * 255,
			);
		return worst;
	}

	/** The 26 neighbors of a point, for the search that refines a grid's worst color. */
	const NEIGHBORS = [-1, 0, 1]
		.flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => [x, y, z] as const)))
		.filter(([x, y, z]) => x !== 0 || y !== 0 || z !== 0);

	/** How many of a grid's best colors the search refines: the peak may sit near any of them. */
	const CANDIDATES = 32;

	/**
	 * The worst distance over a grid of colors, then refined around the grid's best candidates with
	 * a shrinking step. The peak of a cell's error lies between grid points, so a grid alone misses
	 * it, and starting from one point alone misses a peak in another cell. `grid` reports the grid's
	 * own figure, which is what a plain sweep of the cube gives.
	 */
	function worstError(
		values: GradeValues,
		steps: number,
	): { grid: number; worst: number; at: Rgb } {
		const table = bakeGrade(values);
		const gains = whiteBalanceGains(values.whiteBalance[0], values.whiteBalance[1]);
		const candidates: { worst: number; at: Rgb }[] = [];
		for (let blue = 0; blue <= steps; blue++)
			for (let green = 0; green <= steps; green++)
				for (let red = 0; red <= steps; red++) {
					const c: Rgb = [red / steps, green / steps, blue / steps];
					const worst = errorAt(table, c, values, gains);
					if (
						candidates.length === CANDIDATES &&
						worst <= (candidates[CANDIDATES - 1] as { worst: number }).worst
					)
						continue;
					candidates.push({ worst, at: c });
					candidates.sort((a, b) => b.worst - a.worst);
					if (candidates.length > CANDIDATES) candidates.pop();
				}
		const grid = (candidates[0] as { worst: number }).worst;
		let best = { worst: 0, at: [0, 0, 0] as Rgb };
		for (const candidate of candidates) {
			let found = candidate;
			let step = 1 / steps;
			while (step > 1e-5) {
				let better = false;
				for (const [x, y, z] of NEIGHBORS) {
					const c = [
						clamped((found.at[0] as number) + x * step),
						clamped((found.at[1] as number) + y * step),
						clamped((found.at[2] as number) + z * step),
					] as unknown as Rgb;
					const worst = errorAt(table, c, values, gains);
					if (worst > found.worst) {
						found = { worst, at: c };
						better = true;
					}
				}
				if (!better) step *= 0.5;
			}
			if (found.worst > best.worst) best = found;
		}
		return { grid, worst: best.worst, at: best.at };
	}

	it('matches the analytic grade on the grid that the recorded figure used', () => {
		const measured = worstError(WARM, 16);
		// 17 points an axis: 0.91 of a step on the grid, and the search around its best colors gives
		// 0.97. See the test below for the worst that the table reaches anywhere in the cube.
		expect(measured.grid).toBeCloseTo(0.91, 1);
		expect(measured.worst).toBeCloseTo(0.97, 1);
		expect(measured.worst).toBeLessThan(1);
	});

	it('misses by about two steps at its worst, a saturated yellow', () => {
		// 49 points an axis give 1.71 on the grid, and the search around their best colors gives
		// 2.01. The search around the best of 65 points finds 2.03, at red and green near white with
		// blue at zero. The grade clamps the blue channel at zero there and the table holds 0.008,
		// so a cell that spans the clamp misses the reference by two steps.
		const searched = worstError(WARM, 48);
		expect(searched.grid).toBeCloseTo(1.71, 1);
		expect(searched.worst).toBeCloseTo(2.01, 1);
		const { worst, at } = worstError(WARM, 64);
		expect(worst).toBeCloseTo(2.03, 1);
		expect(worst).toBeLessThan(2.1);
		expect(at[0] as number).toBeGreaterThan(0.9);
		expect(at[1] as number).toBeGreaterThan(0.9);
		expect(at[2] as number).toBeLessThan(0.01);
	});

	it('tints black with the shadows and white with the highlights', () => {
		const shadows: Rgb = [0.1, 0.2, 0.6];
		const highlights: Rgb = [0.9, 0.7, 0.4];
		const table = bakeGrade({ ...NEUTRAL, shadows, highlights, strength: 1 });
		const black = texelValue(table, 0, 0, 0);
		const white = texelValue(table, GRADE_SIZE - 1, GRADE_SIZE - 1, GRADE_SIZE - 1);
		const shadowChroma = chromaOf(shadows);
		const highlightChroma = chromaOf(highlights);
		for (let channel = 0; channel < 3; channel++) {
			expect(black[channel] as number).toBeCloseTo(Math.max(shadowChroma[channel] as number, 0), 6);
			expect(white[channel] as number).toBeCloseTo(1 + (highlightChroma[channel] as number), 6);
		}
	});

	it('brightens a channel whose gamma is above 1 and darkens one below 1', () => {
		const table = bakeGrade({ ...NEUTRAL, gamma: [2, 1, 0.5] });
		const c = texelColor(16, 16, 16);
		const got = texelValue(table, 16, 16, 16);
		expect(got[0] as number).toBeGreaterThan(c[0]);
		expect(got[1] as number).toBeCloseTo(c[1], 6);
		expect(got[2] as number).toBeLessThan(c[2]);
	});

	it('keeps the luma of a grey through a white balance', () => {
		const table = bakeGrade({ ...NEUTRAL, whiteBalance: [3200, 0.4], saturation: 0.4 });
		// Saturation and white balance both keep the luma, so a grey keeps its brightness.
		const c: Rgb = [0.42, 0.42, 0.42];
		const got = lookUp(table, c);
		const level = lumaOf(got);
		expect(level).toBeCloseTo(lumaOf(c), 2);
	});
});
