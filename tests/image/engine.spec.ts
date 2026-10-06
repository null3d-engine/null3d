import { expect, type Page, test } from '@playwright/test';
import { ISOLATION_HEADERS } from '../../packages/vite-plugin/src/index.ts';
import {
	isFirstUseShaderPart,
	LATER_PARTS,
	TRANSCODER_FILES,
} from '../../tools/lib/size-report.ts';
import {
	ENGINE_MODES,
	type EngineChecks,
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

/**
 * The engine checks without their frame-rate checks, for the tests whose job is not the pace of the
 * frame loop. The engine must still run after its start, at whatever rate the machine draws. A busy
 * runner can slow every frame of a short measurement, which says nothing about what these tests
 * check. The tests that run each thread mode check the pace, and so do those that wake the threads
 * with messages. On a software GPU no test checks it, as the GPU sets the pace there.
 */
const notPacing: EngineChecks = { pacing: false };

/**
 * The fewest frames that the tests without Atomics.waitAsync count after the pause, to show that
 * its end woke the threads. The page counts until they come, however slowly the GPU draws them.
 */
const RESUMED_FRAMES = 11;

const singleThreaded = ENGINE_MODES.find((mode) => mode.build === 'single');
if (!singleThreaded) throw new Error('no single-threaded engine mode');
const drawingOnPage = ENGINE_MODES.find(({ name }) => name === 'drawing on the main thread');
if (!drawingOnPage) throw new Error('no mode that draws on the main thread');

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
			expect(engineProblems(result, mode, 'webgl2', notPacing)).toEqual([]);
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
		expect(engineProblems(result, mode, 'webgl2', notPacing)).toEqual([]);
		const trail = result.trail ?? [];
		const step = (name: string) => trail.findIndex((line) => line.endsWith(` ms ${name}`));
		const core = step('core');
		expect(core).toBeGreaterThan(0);
		// Each step's time is whole milliseconds since the page started, as resource timing counts.
		const coreAt = Number.parseInt(trail[core] as string, 10);
		const files: Record<string, RegExp> = { 'the sketch module': /\/empty-sketch[^/]*\.[jt]s$/ };
		// The loader is null3d.js, or null3d-<hash>.js once bundled, where the hash may hold any of
		// the characters of URL-safe base64, the underscore among them.
		if (mode.sketchThread === 'main')
			files["the core's loader"] = /\/null3d(-[\w-]+)?\.js(\?no-inline)?$/;
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

/** The core, on the dev server and in a production build. */
const CORE_FILE = /\/null3d_bg(-[\w-]+)?\.wasm(\?|$)/;
/** A device's shader file of either GPU path, on the dev server and in a production build. */
const SHADER_FILE = /\/shaders-(glsl|wgsl)[^/]*\.[jt]s(\?|$)/;
/** The longest time that a test holds the core's download back. */
const CORE_HOLD_MS = 10_000;

/**
 * Holds the core's download back until any thread asks for a device's shader file, or for at most
 * `CORE_HOLD_MS`. Returns the order of the two events, each named once: `shaders` when a thread
 * asks for the shader file, and `core` when the core's download goes on.
 */
async function holdCoreForShaders(page: Page): Promise<string[]> {
	const order: string[] = [];
	const note = (event: string) => {
		if (!order.includes(event)) order.push(event);
	};
	let shadersAsked: () => void = () => undefined;
	const asked = new Promise<void>((resolve) => {
		shadersAsked = resolve;
	});
	page.context().on('request', (request) => {
		if (!SHADER_FILE.test(request.url())) return;
		note('shaders');
		shadersAsked();
	});
	await page.context().route(CORE_FILE, async (route) => {
		await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, CORE_HOLD_MS))]);
		note('core');
		await route.continue();
	});
	return order;
}

// The thread that draws asks for the device's shader file as soon as the probe has chosen the GPU
// path and the device's fixed bits, so the file downloads with the core. The test holds the core
// back until a thread asks for the file. A start that asks for it only after the core would wait
// for the hold's limit, and see the file's request after the core's. This holds in every thread
// mode, and where the page draws because a worker cannot.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES)
		test(`the thread that draws asks for its shaders while the core downloads, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			const order = await holdCoreForShaders(page);
			await page.goto(`engine.html?gpu=${gpu}&seconds=1&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			await page.context().unrouteAll({ behavior: 'ignoreErrors' });
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, gpu, notPacing)).toEqual([]);
			expect(order).toEqual(['shaders', 'core']);
		});
	test(`the page asks for its shaders while the core downloads where a worker cannot draw, on ${gpu}`, async ({
		page,
	}) => {
		await workersCannotDraw(page);
		const order = await holdCoreForShaders(page);
		await page.goto(`engine.html?gpu=${gpu}&seconds=1`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		await page.context().unrouteAll({ behavior: 'ignoreErrors' });
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, drawingOnPage, gpu, notPacing)).toEqual([]);
		expect(order).toEqual(['shaders', 'core']);
	});
}

/** The early script that the Vite plugin adds to each built page whose scripts load the core. */
const EARLY_SCRIPT = /\/early-core-[\w-]{8}\.js(\?|$)/;
/** A script of a production build. */
const BUILT_SCRIPT = /\/assets\/[^/]+\.js(\?|$)/;

// In a production build, the early script starts the core's download before the page's own scripts
// have arrived, and the engine compiles that download, so the core downloads once. The test holds
// every other script back until the core's request goes out. A core that waits for the page's
// scripts would wait for the hold's limit, and see its request after theirs. An early script that
// picked the other build than the engine does would make the engine download a second core.
for (const mode of ENGINE_MODES)
	test(`the early script starts the core's download before the page's scripts arrive, ${mode.name}`, async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== 'production build',
			'only a production build has the early script',
		);
		const order: string[] = [];
		const cores: string[] = [];
		let coreAsked: () => void = () => undefined;
		const asked = new Promise<void>((resolve) => {
			coreAsked = resolve;
		});
		page.context().on('request', (request) => {
			if (!CORE_FILE.test(request.url())) return;
			cores.push(new URL(request.url()).pathname);
			if (!order.includes('core')) order.push('core');
			coreAsked();
		});
		await page.context().route(BUILT_SCRIPT, async (route) => {
			if (!EARLY_SCRIPT.test(route.request().url())) {
				await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, CORE_HOLD_MS))]);
				if (!order.includes('scripts')) order.push('scripts');
			}
			await route.continue();
		});
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		await page.context().unrouteAll({ behavior: 'ignoreErrors' });
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, 'webgl2', notPacing)).toEqual([]);
		expect(order).toEqual(['core', 'scripts']);
		expect(cores).toHaveLength(1);
	});

/** The text as a regular expression that matches it alone. */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The address of each file that loads only when a sketch first uses its feature, on the dev server
 * and in a production build, which names a file after its module and adds a hash. The size report
 * lists these files apart from the start, and the transcoder's files with them.
 */
const FIRST_USE_FILES: readonly RegExp[] = [
	...[
		...new Set(
			LATER_PARTS.filter(({ afterFirstFrame }) => !afterFirstFrame).map(({ module }) => module),
		),
	].map((module) => {
		const stem = (module.split('/').at(-1) as string).replace(/\.ts$/, '');
		return new RegExp(`/${escaped(module)}$|/${escaped(stem)}-[\\w-]{8}\\.js$`);
	}),
	...TRANSCODER_FILES.map((file) => {
		const dot = file.lastIndexOf('.');
		return new RegExp(`/${escaped(file.slice(0, dot))}(-[\\w-]{8})?${escaped(file.slice(dot))}$`);
	}),
];

/**
 * True for the address of a shader build's device module of a feature that loads on first use: the
 * module itself on the dev server, and its file with a hash in a production build.
 */
function isFirstUseShaderFile(path: string): boolean {
	const name = path.split('/').at(-1) as string;
	const stem = /^(shaders-[a-z0-9-]+)(-[\w-]{8})?\.js$/.exec(name)?.[1];
	return stem !== undefined && isFirstUseShaderPart(`${stem}.js`);
}

// A page that uses no feature that loads on first use downloads none of their files, on either GPU
// path and in every thread mode: neither their code nor their shader builds. The engine test page
// uses none, and the startup benchmark times it.
for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`a page that uses no feature that loads on first use downloads none of their files, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			const requests: string[] = [];
			page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
			await page.goto(`engine.html?gpu=${gpu}&seconds=1&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, gpu, notPacing)).toEqual([]);
			expect(requests.some((path) => /\/null3d_bg(-[\w-]+)?\.wasm$/.test(path))).toBe(true);
			expect(
				requests.filter(
					(path) => FIRST_USE_FILES.some((file) => file.test(path)) || isFirstUseShaderFile(path),
				),
			).toEqual([]);
		});

/** Sketches of the image tests, each of which uses one feature whose shader builds load on first use. */
const FIRST_USE_SHADER_SKETCHES = [
	{ feature: 'lines', sketch: 'tests/pages/sketches/lines-sketch.ts' },
	{ feature: 'sprites', sketch: 'tests/pages/sketches/sprites-sketch.ts' },
	{ feature: 'background', sketch: 'tests/pages/sketches/texture-background-sketch.ts' },
] as const;

// A page that uses one such feature downloads that feature's shader file once, for its device's
// fixed bits, and no other feature's shader file. The production build serves no image test page.
for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const { feature, sketch } of FIRST_USE_SHADER_SKETCHES)
		test(`the first use of ${feature} downloads its shader file once on ${gpu}`, async ({
			page,
		}, testInfo) => {
			test.skip(testInfo.project.name === 'production build', 'no image test page');
			const requests: string[] = [];
			page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
			await page.goto(
				`image.html?gpu=${gpu}&hold=0&size=320x180&sketch=${encodeURIComponent(`/${sketch}`)}`,
			);
			const result = await pageResult<{ error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			const shaderFiles = requests.filter(isFirstUseShaderFile);
			expect(shaderFiles).toHaveLength(1);
			expect(shaderFiles[0]).toMatch(new RegExp(`/shaders-${feature}-(wgsl|glsl)[^/]*$`));
		});

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
			expect(engineProblems(result, pipelined, gpu, notPacing)).toEqual([]);
		});
	}
	test(`the engine starts the job workers that ?jobs= asks for on ${gpu}`, async ({ page }) => {
		const mode = { ...pipelined, query: 'jobs=3', jobWorkers: 3 };
		await page.goto(`engine.html?gpu=${gpu}&seconds=1&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, gpu, notPacing)).toEqual([]);
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
		expect(engineProblems(result, singleThreaded, gpu, notPacing)).toEqual([]);
	});
}

// Where a worker cannot draw, the page draws, and the sketch worker computes the frames in
// pipelined mode. Low latency needs the sketch worker to draw, so it falls back to pipelined mode
// too, with a warning in development builds, and engine.mode says so.
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
			expect(engineProblems(result, drawingOnPage, gpu, notPacing)).toEqual([]);
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
		const switches = `gpu=webgl2&seconds=1&pause&resumed-frames=${RESUMED_FRAMES}&${mode.query}`;
		await page.goto(`engine.html?${switches}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		await restoreWaitAsync(page);
		expect(result.error).toBeUndefined();
		expect(result.report.atomicsWaitAsync).toBe(false);
		expect(engineProblems(result, mode, 'webgl2')).toEqual([]);
		expect(result.pause?.paused.frames, 'frames computed during the pause').toBe(0);
		expect(result.pause?.resumed.frames ?? 0, 'frames after the pause').toBeGreaterThanOrEqual(
			RESUMED_FRAMES,
		);
	});
}
