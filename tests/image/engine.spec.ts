import { expect, test } from '@playwright/test';

interface EngineResult {
	error?: string;
	mode: { build: string; latency: string; renderThread: string; jobWorkers: number };
	capabilities: { tier: string; threaded: boolean };
	intervals: { count: number; median: number; p95: number };
	count: { updates: number; frame: number };
}

/** Runs in the page: the result the test page published, once it exists. */
const readResult = () => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult;

const MODES = [
	{
		name: 'pipelined',
		query: '',
		latency: 'pipelined',
		renderThread: 'render-worker',
		build: 'threaded',
	},
	{
		name: 'low latency',
		query: 'latency=low',
		latency: 'low',
		renderThread: 'game-worker',
		build: 'threaded',
	},
	{
		name: 'single-threaded',
		query: 'threads=off',
		latency: 'single',
		renderThread: 'main',
		build: 'single',
	},
	{
		name: 'drawing on the main thread',
		query: 'render=main',
		latency: 'pipelined',
		renderThread: 'main',
		build: 'threaded',
	},
] as const;

/** Slower than this median frame interval means the loop is not keeping up with the display. */
const MAX_MEDIAN_INTERVAL_MS = 34;
const MIN_FRAMES = 30;

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of MODES) {
		test(`the engine runs ${mode.name} on ${gpu}`, async ({ page }) => {
			await page.goto(`/engine.html?gpu=${gpu}&seconds=2&${mode.query}`);
			const handle = await page.waitForFunction(readResult, undefined, { timeout: 30_000 });
			const result = (await handle.jsonValue()) as EngineResult;
			expect(result.error).toBeUndefined();
			expect(result.mode.build).toBe(mode.build);
			expect(result.mode.latency).toBe(mode.latency);
			expect(result.mode.renderThread).toBe(mode.renderThread);
			expect(result.mode.jobWorkers >= 1).toBe(mode.build === 'threaded');
			expect(result.capabilities.tier.startsWith(gpu)).toBe(true);
			expect(result.intervals.count).toBeGreaterThan(MIN_FRAMES);
			expect(result.intervals.median).toBeLessThan(MAX_MEDIAN_INTERVAL_MS);
			expect(result.count.updates).toBeGreaterThan(MIN_FRAMES);
		});
	}
}
