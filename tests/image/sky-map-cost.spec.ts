// The cost of a sky map's stages on every GPU path, and on WebGPU how far its light lies from the
// same sky filtered as a file's map is. The page fills a map whole, as at load, then refreshes it
// with a moving sun, one stage at a time, as frames do, and times each stage from its call until
// the GPU has finished it. The test prints the figures for D-118. It checks that no GPU error came,
// and that the sky map's filter keeps each level within a few steps of the finer one, as D-19
// compares the room with the asset tool's map: each channel tone mapped, in steps of 1/255.
// NULL3D_SKY_RUNS=<n> times n refreshes, 8 by default.
import { expect, test } from '@playwright/test';
import { fromRgb9e5, words } from '../lib/environment-maps.ts';
import { pageResult } from '../lib/page-result.ts';

interface CostResult {
	error?: string;
	tier: string;
	fill: number;
	stages: number[][];
	gpuStages: number[][];
	prepareTime: number;
	errors: string[];
	levels?: string[];
	referenceLevels?: string[];
}

/** How far each level may lie from the finer filter's, in steps of 1/255: mean and p99. */
const TOLERANCE = { mean: 0.5, p99: 3 };
const runs = Number(process.env.NULL3D_SKY_RUNS ?? '8');

/** The median of some times. */
const median = (times: number[]) =>
	[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
const ms = (time: number) => time.toFixed(2);

/** Each level's mean and p99 difference in tone mapped steps, and the ratio of its total light. */
function compare(ours: string[], theirs: string[]): { mean: number; p99: number; ratio: number }[] {
	const reference = words(theirs[0] as string);
	let light = 0;
	for (const texel of reference) light += fromRgb9e5(texel).reduce((s, c) => s + c, 0) / 3;
	const exposure = 0.5 / (light / reference.length);
	const tone = (x: number) => (255 * x * exposure) / (1 + x * exposure);
	return ours.map((base64, level) => {
		const a = words(base64);
		const b = words(theirs[level] as string);
		const steps = new Float64Array(3 * a.length);
		let [sumA, sumB] = [0, 0];
		for (let k = 0; k < a.length; k++) {
			const x = fromRgb9e5(a[k] as number);
			const y = fromRgb9e5(b[k] as number);
			for (let c = 0; c < 3; c++) {
				steps[3 * k + c] = Math.abs(tone(x[c] as number) - tone(y[c] as number));
				sumA += x[c] as number;
				sumB += y[c] as number;
			}
		}
		const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
		const p99 = steps.sort()[Math.floor(0.99 * (steps.length - 1))] as number;
		return { mean, p99, ratio: sumA / sumB };
	});
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`a sky map's stages on ${gpu}, timed and against a finer filter`, async ({ page }) => {
		test.setTimeout(240_000);
		await page.goto(
			`sky-map-cost.html?gpu=${gpu}&runs=${runs}${process.env.NULL3D_SKY_FILTER ?? ''}`,
		);
		const result = await pageResult<CostResult>(page, 200_000);
		expect(result.error).toBeUndefined();
		const lines = [
			`pipelines in the background: ${ms(result.prepareTime)} ms; the whole map at once: ${ms(result.fill)} ms`,
			`each stage's median, from its call to the GPU's end, ms: ${result.stages.map((t) => ms(median(t))).join(', ')}`,
			`each stage's longest, ms: ${result.stages.map((t) => ms(Math.max(...t))).join(', ')}`,
		];
		if (result.gpuStages.some((t) => t.length))
			lines.push(
				`each stage's median by timer queries, ms: ${result.gpuStages.map((t) => ms(median(t))).join(', ')}`,
			);
		const problems = result.errors.map((error) => `GPU error: ${error}`);
		if (result.levels && result.referenceLevels)
			compare(result.levels, result.referenceLevels).forEach(({ mean, p99, ratio }, level) => {
				lines.push(
					`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}, ratio ${ratio.toFixed(4)}`,
				);
				if (mean > TOLERANCE.mean || p99 > TOLERANCE.p99)
					problems.push(`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}`);
			});
		console.log(`sky map on ${result.tier}\n${lines.join('\n')}`);
		expect(problems).toEqual([]);
	});
