import { ISOLATION_HEADERS } from '@null3d/vite-plugin';
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult, engineProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/**
 * Serves every response to the page without the headers that make it cross-origin isolated, as a
 * host that cannot set them does.
 */
async function withoutIsolation(page: Page): Promise<void> {
	await page.route('**/*', async (route) => {
		const response = await route.fetch();
		const headers = response.headers();
		for (const name of Object.keys(ISOLATION_HEADERS)) delete headers[name.toLowerCase()];
		await route.fulfill({ response, headers });
	});
}

const singleThreaded = ENGINE_MODES.find((mode) => mode.build === 'single');
if (!singleThreaded) throw new Error('no single-threaded engine mode');

// A page gets the shared memory maximum that its memory option asks for, and the ?memory= switch
// wins over the option. The single-threaded build's memory is not shared, so it has none.
for (const mode of ENGINE_MODES) {
	test(`the engine's shared memory has the maximum that the page asks for, ${mode.name}`, async ({
		page,
	}) => {
		const maxima: (number[] | undefined)[] = [];
		for (const query of ['memory-option=2048', 'memory-option=2048&memory=512']) {
			await page.goto(`engine.html?gpu=webgl2&seconds=1&${query}&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, 'webgl2')).toEqual([]);
			maxima.push(result.sharedMemoryMiB);
		}
		expect(maxima).toEqual(mode.build === 'threaded' ? [[2048], [512]] : [[], []]);
	});
}

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
	test(`the engine runs single-threaded on ${gpu} in a page without isolation`, async ({
		page,
	}) => {
		await withoutIsolation(page);
		await page.goto(`engine.html?gpu=${gpu}&seconds=1`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		// The page still sends its result to the dev server, and the test does not wait for that.
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		expect(result.error).toBeUndefined();
		expect(result.report.crossOriginIsolated).toBe(false);
		expect(engineProblems(result, singleThreaded, gpu)).toEqual([]);
	});
}
