// The built-in room that the engine makes on the GPU, against the asset tool's map of the room, on
// every GPU path, as environment-generator-checks.ts compares them. The real-browser runner runs
// the same page and checks in each browser.
//
// The generator makes the whole map in one go, as the engine does at load (D-66). The test prints
// the first map's time, as at load. NULL3D_ENV_RUNS=<n> times n more maps after it, for the
// generator's cost in D-19.
import { expect, test } from '@playwright/test';
import { type GeneratorResult, generatorReport } from '../lib/environment-generator-checks.ts';
import { pageResult } from '../lib/page-result.ts';

const runs = Number(process.env.NULL3D_ENV_RUNS ?? '0');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`the built-in room made on ${gpu} matches the asset tool's map`, async ({ page }) => {
		test.setTimeout(240_000);
		await page.goto(`environment-generator.html?gpu=${gpu}&runs=${runs}`);
		const result = await pageResult<GeneratorResult>(page, 200_000);
		const { lines, problems } = generatorReport(result);
		const ms = (times: number[]) => times.map((t) => t.toFixed(1)).join(', ');
		lines.push(
			`pipelines in the background: ${result.prepareTime.toFixed(1)} ms; maps, first at load, in ms: ${ms(result.times)}`,
			`the thread's time in each call, ms: ${ms(result.callTimes)}; GPU times in ms: ${ms(result.gpuTimes)}`,
		);
		console.log(`${result.tier}\n${lines.join('\n')}`);
		expect(problems).toEqual([]);
	});
