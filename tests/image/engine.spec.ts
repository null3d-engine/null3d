import { expect, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult, engineProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** Runs in the page: the result the test page published, once it exists. */
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine runs ${mode.name} on ${gpu}`, async ({ page }) => {
			await page.goto(`engine.html?gpu=${gpu}&seconds=2&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, gpu)).toEqual([]);
		});
	}
	const [pipelined] = ENGINE_MODES;
	if (!pipelined) throw new Error('no engine modes');
	for (const power of ['high-performance', 'low-power'] as const) {
		test(`the engine runs on ${gpu} with the ${power} GPU`, async ({ page }) => {
			await page.goto(`engine.html?gpu=${gpu}&seconds=1&power=${power}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, pipelined, gpu)).toEqual([]);
		});
	}
	test(`the engine starts the job workers that ?jobs= asks for on ${gpu}`, async ({ page }) => {
		const mode = { ...pipelined, query: 'jobs=3', jobWorkers: 3 };
		await page.goto(`engine.html?gpu=${gpu}&seconds=1&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, gpu)).toEqual([]);
		// Each job worker records every frame, so the figures name exactly three.
		const jobThreads = Object.keys(result.stats.threads).filter((name) => name.startsWith('job-'));
		expect(jobThreads).toEqual(['job-0', 'job-1', 'job-2']);
	});
}
