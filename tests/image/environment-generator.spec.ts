// The built-in room that the engine makes on the GPU, against the asset tool's map of the room, on
// every GPU path. Both follow the same steps (D-19): the trace, the blur of 0.04 radians, the
// chain of halved levels and the GGX filter of each level. The tool works in 32-bit floats on the
// CPU, and the GPU keeps each step's texels as shared-exponent floats and filters with the GPU's
// own precision, so the two differ by small steps. The comparison tone maps each texel first, as
// the parity test does, so it counts a difference as much as a picture shows it.
//
// The generator makes the whole map in one go, as the engine does at load (D-66). The test prints
// the first map's time, as at load. NULL3D_ENV_RUNS=<n> times n more maps after it, for the
// generator's cost in D-19.
import { expect, test } from '@playwright/test';
import { readEnvironment } from '../../packages/cli/src/assets/env.js';
import { environmentMap } from '../../packages/cli/src/assets/formats.js';
import { averageLight, fromRgb9e5 } from '../lib/environment-maps.ts';
import { pageResult } from '../lib/page-result.ts';

interface GeneratorResult {
	ok: boolean;
	error?: string;
	tier: string;
	errors: string[];
	prepareTime: number;
	times: number[];
	callTimes: number[];
	gpuTimes: number[];
	size: number;
	levels: string[];
}

/** How far each level may lie from the tool's, in steps of 1/255 after tone mapping: mean / p99. */
const TOLERANCE = { mean: 0.25, p99: 1 };
/** How far each level's total light may lie from the tool's. */
const RATIO = 0.005;

/** Every texel of a level as shared-exponent words, from the page's bytes or the tool's file. */
const words = (bytes: Uint8Array) =>
	new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const runs = Number(process.env.NULL3D_ENV_RUNS ?? '0');
const tool = environmentMap({ builtin: 'room' }, { size: 256, format: 'rgb9e5ufloat' });
const env = readEnvironment(tool);
// Reinhard's operator at an exposure that puts the room's average light at a third of white.
const exposure = 0.5 / averageLight(env.sh);
const tone = (x: number) => (255 * x * exposure) / (1 + x * exposure);

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`the built-in room made on ${gpu} matches the asset tool's map`, async ({ page }) => {
		test.setTimeout(240_000);
		await page.goto(`environment-generator.html?gpu=${gpu}&runs=${runs}`);
		const result = await pageResult<GeneratorResult>(page, 200_000);
		expect(result.error).toBeUndefined();
		expect(result.errors).toEqual([]);
		const lines: string[] = [];
		const failures: string[] = [];
		result.levels.forEach((base64, level) => {
			const ours = words(Uint8Array.from(Buffer.from(base64, 'base64')));
			const { offset, length } = env.levels[level] as { offset: number; length: number };
			const theirs = words(tool.subarray(offset, offset + length));
			expect(ours.length).toBe(theirs.length);
			const steps = new Float64Array(ours.length);
			let [sumOurs, sumTheirs] = [0, 0];
			for (let k = 0; k < ours.length; k++) {
				const a = fromRgb9e5(ours[k] as number)[0];
				const b = fromRgb9e5(theirs[k] as number)[0];
				steps[k] = Math.abs(tone(a) - tone(b));
				sumOurs += a;
				sumTheirs += b;
			}
			const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
			const p99 = steps.sort()[Math.floor(0.99 * (steps.length - 1))] as number;
			const ratio = sumOurs / sumTheirs;
			lines.push(
				`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}, ratio ${ratio.toFixed(4)}`,
			);
			if (mean > TOLERANCE.mean || p99 > TOLERANCE.p99)
				failures.push(`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}`);
			if (Math.abs(ratio - 1) > RATIO)
				failures.push(`level ${level}: the total light differs by ${ratio.toFixed(4)}`);
		});
		const ms = (times: number[]) => times.map((t) => t.toFixed(1)).join(', ');
		lines.push(
			`pipelines in the background: ${result.prepareTime.toFixed(1)} ms; maps, first at load, in ms: ${ms(result.times)}`,
			`the thread's time in each call, ms: ${ms(result.callTimes)}; GPU times in ms: ${ms(result.gpuTimes)}`,
		);
		console.log(`${result.tier}\n${lines.join('\n')}`);
		expect(failures).toEqual([]);
	});
