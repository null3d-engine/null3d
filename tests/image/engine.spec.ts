import { ISOLATION_HEADERS } from '@null3d/vite-plugin';
import { expect, type Page, test } from '@playwright/test';
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineResult,
	engineProblems,
	THREADED_MODES,
} from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { restoreWaitAsync, withoutWaitAsync } from '../lib/without-wait-async.ts';

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

/**
 * Serves the worker probe as a worker that can draw with neither GPU path, as in a browser without
 * a GPU context for an offscreen canvas in a worker.
 */
async function workersCannotDraw(page: Page): Promise<void> {
	await page.context().route(/\/probe-worker[^/]*\.(js|ts)(\?|$)/, (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			body: 'postMessage({ requestAnimationFrame: true, offscreenWebGL2: false, offscreenWebGPU: false });',
		}),
	);
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

// The page starts the downloads that its start needs while the core downloads, and does not wait
// until the core is ready. With worker threads it starts the workers, which load the core's loader
// at once, and it fetches the sketch module into the browser's cache for the sketch worker. Where
// the page runs the sketch, in single-threaded mode and with the sketch on the main thread, it loads
// the core's loader and the sketch module itself. Wherever the page draws, it loads the renderer
// too.
for (const mode of ENGINE_MODES) {
	test(`the page starts its downloads before the core is ready, ${mode.name}`, async ({ page }) => {
		await page.goto(`engine.html?gpu=webgl2&seconds=1&downloads&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, 'webgl2')).toEqual([]);
		const trail = result.trail ?? [];
		const step = (name: string) => trail.findIndex((line) => line.endsWith(` ms ${name}`));
		const core = step('core');
		expect(core).toBeGreaterThan(0);
		// Each step's time is whole milliseconds since the page started, as resource timing counts.
		const coreAt = Number.parseInt(trail[core] as string, 10);
		const files: Record<string, RegExp> = { 'the sketch module': /\/empty-sketch[^/]*\.[jt]s$/ };
		// The loader is null3d.js, or null3d-<hash>.js once bundled, where the hash may hold any of
		// the characters of URL-safe base64, the underscore among them.
		if (mode.sketchThread === 'main') files["the core's loader"] = /\/null3d(-[\w-]+)?\.js$/;
		if (mode.renderThread === 'main') files['the renderer'] = /\/draw(-[^/]*)?\.[jt]s$/;
		for (const [what, file] of Object.entries(files)) {
			const asked = result.downloads?.find(({ name }) => file.test(name))?.startTime;
			expect(asked, what).toBeLessThan(coreAt);
		}
		if (mode.build === 'single') return;
		const workers = ['null3d-job-0'];
		if (mode.sketchThread === 'worker') workers.push('null3d-sketch');
		if (mode.renderThread === 'render-worker') workers.push('null3d-render');
		for (const worker of workers) {
			expect(step(`${worker}: started`), worker).toBeGreaterThanOrEqual(0);
			expect(step(`${worker}: started`), worker).toBeLessThan(core);
		}
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
	// A page that runs the sketch and draws steps the sketch right before each draw, which is low
	// latency, whether the page asked for low latency or for drawing on the main thread.
	for (const query of ['sketch-thread=main&latency=low', 'sketch-thread=main&render=main']) {
		test(`the engine runs the sketch and draws on the main thread with ?${query} on ${gpu}`, async ({
			page,
		}) => {
			const mode: EngineMode = {
				name: 'sketch and drawing on the main thread',
				query,
				build: 'threaded',
				latency: 'low',
				sketchThread: 'main',
				renderThread: 'main',
			};
			await page.goto(`engine.html?gpu=${gpu}&seconds=2&${query}`);
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

// Where a worker cannot draw, the page draws, and the sketch worker computes the frames in
// pipelined mode. Low latency needs the sketch worker to draw, so it falls back to pipelined mode
// too, with a warning in development builds, and engine.mode says so.
const drawingOnPage = ENGINE_MODES.find(({ name }) => name === 'drawing on the main thread');
if (!drawingOnPage) throw new Error('no mode that draws on the main thread');
for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const latency of ['pipelined', 'low'] as const)
		test(`a ${latency} latency start draws on the page where a worker cannot draw, on ${gpu}`, async ({
			page,
		}, testInfo) => {
			const warnings: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'warning') warnings.push(message.text());
			});
			await workersCannotDraw(page);
			await page.goto(`engine.html?gpu=${gpu}&seconds=1&latency=${latency}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			await page.context().unrouteAll({ behavior: 'ignoreErrors' });
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, drawingOnPage, gpu)).toEqual([]);
			const fallback = warnings.filter((text) => text.includes('pipelined mode'));
			const development = testInfo.project.name !== 'production build';
			expect(fallback.length).toBe(latency === 'low' && development ? 1 : 0);
		});

// A browser without Atomics.waitAsync, such as Firefox before 145, runs every threaded mode. Its
// threads wake each other with messages instead: for each frame, for a pause and its end, and for
// the stop, which must end the job workers' loops.
for (const mode of THREADED_MODES) {
	test(`the engine runs without Atomics.waitAsync, ${mode.name}`, async ({ page }) => {
		await withoutWaitAsync(page);
		await page.goto(`engine.html?gpu=webgl2&seconds=1&pause&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		await restoreWaitAsync(page);
		expect(result.error).toBeUndefined();
		expect(result.report.atomicsWaitAsync).toBe(false);
		expect(engineProblems(result, mode, 'webgl2')).toEqual([]);
		expect(result.pause?.paused.frames, 'frames computed during the pause').toBe(0);
		expect(result.pause?.resumed.frames ?? 0, 'frames after the pause').toBeGreaterThan(10);
	});
}
