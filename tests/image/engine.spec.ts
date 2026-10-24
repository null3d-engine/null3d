import { expect, type Page, type Route, test } from '@playwright/test';
import {
	SHADER_FEATURES,
	type ShaderFeature,
} from '../../packages/engine/src/generated/shader-features.ts';
import { ISOLATION_HEADERS } from '../../packages/vite-plugin/src/index.ts';
import { FIRST_USE_FILES, isFirstUseShaderPart, LATER_PARTS } from '../../tools/lib/size-report.ts';
import { ALONE } from '../lib/alone.ts';
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

test.describe.configure({ mode: 'parallel' });

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

/** The worker probe's script, in development and in a production build. */
const PROBE_WORKER = /\/probe-worker[^/]*\.(js|ts)(\?|$)/;

/** The job workers' script, which every job worker loads. */
const JOB_WORKER = /\/job-worker[^/]*\.(js|ts)(\?|$)/;

/**
 * Serves `body` in place of the worker probe's script. The response keeps the server's headers,
 * whose cross-origin isolation headers an isolated page needs to start a worker at all.
 */
async function replaceProbe(route: Route, body: string): Promise<void> {
	const response = await route.fetch();
	await route.fulfill({ response, contentType: 'text/javascript', body });
}

/**
 * Serves the worker probe as a worker that can draw with neither GPU path, as in a browser without
 * a GPU context for an offscreen canvas in a worker.
 */
async function workersCannotDraw(page: Page): Promise<void> {
	await page
		.context()
		.route(PROBE_WORKER, (route) =>
			replaceProbe(
				route,
				'postMessage({ requestAnimationFrame: true, offscreenWebGL2: false, offscreenWebGPU: false });',
			),
		);
}

/**
 * Serves the worker probe as a worker that says it has loaded and then never answers, as a stalled
 * GPU call does, for the first `stalls` probe workers. Later ones get the real probe.
 */
async function probeStalls(page: Page, stalls: number): Promise<{ served: number }> {
	const counts = { served: 0 };
	await page.context().route(PROBE_WORKER, (route) => {
		if (counts.served++ >= stalls) return route.fallback();
		return replaceProbe(route, "postMessage('loaded');");
	});
	return counts;
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
		if (mode.sketchThread === 'main') files["the core's loader"] = /\/null3d(-[\w-]+)?\.js$/;
		if (mode.renderThread === 'main') files['the renderer'] = /\/draw(-[^/]*)?\.[jt]s$/;
		for (const [what, file] of Object.entries(files)) {
			const asked = result.downloads?.find(({ name }) => file.test(name))?.startTime;
			expect(asked, what).toBeLessThan(coreAt);
		}
		if (mode.build === 'single') return;
		// Job workers start only as the work asks for them, which an empty sketch never does.
		expect(step('null3d-job-0: started')).toBe(-1);
		const workers: string[] = [];
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
 * The address of a part's module on the dev server, and of its file with a hash in a build. A part
 * whose module the start also holds has no file of its own on the dev server, since the page
 * downloads the start's copy, so `builtOnly` asks for its built file alone: that file belongs to
 * the thread that loads it on demand, and a page that fetches it at its start has loaded code early.
 */
function partPatterns(modules: readonly string[], { builtOnly = false } = {}): RegExp[] {
	return [...new Set(modules)].map((module) => {
		const stem = (module.split('/').at(-1) as string).replace(/\.ts$/, '');
		const built = `/${escaped(stem)}-[\\w-]{8}\\.js$`;
		return builtOnly ? new RegExp(built) : new RegExp(`/${escaped(module)}$|${built}`);
	});
}

/**
 * The address of each file that loads only when a sketch first uses its feature, on the dev server
 * and in a production build, which names a file after its module and adds a hash. The size report
 * lists these files apart from the start, and the WebAssembly modules that load on first use with
 * them.
 */
const FIRST_USE_PARTS = LATER_PARTS.filter(
	({ afterFirstFrame, onFirstCall }) => !afterFirstFrame && !onFirstCall,
);
const FIRST_USE_PATTERNS: readonly RegExp[] = [
	...partPatterns(
		FIRST_USE_PARTS.filter(({ alsoInStart }) => !alsoInStart).map(({ module }) => module),
	),
	...partPatterns(
		FIRST_USE_PARTS.filter(({ alsoInStart }) => alsoInStart).map(({ module }) => module),
		{ builtOnly: true },
	),
	...FIRST_USE_FILES.map((file) => {
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

/** The address of the parts that load at the first call that reads them, not with a feature. */
const FIRST_CALL_PATTERNS: readonly RegExp[] = partPatterns(
	LATER_PARTS.filter(({ onFirstCall }) => onFirstCall).map(({ module }) => module),
);

/** The address of the frame figures that `measure()` reads. */
const FRAME_FIGURES = partPatterns(['page/frame-stats.ts']);

// A page that uses no feature that loads on first use downloads none of their files, on either GPU
// path and in every thread mode: neither their code nor their shader builds. Nor does it download
// the renderers of the GPU path that it does not draw with. The engine test page uses no such
// feature, and the startup benchmark times it. Its measurement then reads the frame figures, which
// come in a file of their own.
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
					(path) =>
						FIRST_USE_PATTERNS.some((file) => file.test(path)) || isFirstUseShaderFile(path),
				),
			).toEqual([]);
			const renderers = (path: string) => new RegExp(`/${path}-renderers(\\.ts|-[\\w-]{8}\\.js)$`);
			const other = gpu === 'webgpu' ? 'webgl2' : 'webgpu';
			expect(requests.some((path) => renderers(gpu).test(path))).toBe(true);
			expect(requests.filter((path) => renderers(other).test(path))).toEqual([]);
			// The measurement reads the frame figures, so their file arrives.
			expect(requests.some((path) => FRAME_FIGURES.some((file) => file.test(path)))).toBe(true);
		});

// The frame figures behind measure() and the fixes of the errors' messages are large and read
// rarely, so each loads at the first call that reads it. A page that neither measures nor throws
// downloads neither file: ?nomeasure skips the engine test page's measurement.
for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`a page that measures nothing and throws nothing downloads neither file, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			const requests: string[] = [];
			page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
			await page.goto(`engine.html?gpu=${gpu}&seconds=1&nomeasure&${mode.query}`);
			const result = await pageResult<{ error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(
				requests.filter((path) => FIRST_CALL_PATTERNS.some((file) => file.test(path))),
			).toEqual([]);
		});

/**
 * Sketches of the image tests that use one feature whose shader builds load on first use. Every
 * other feature draws in the first-use sketch, whose `?feature=` names it.
 */
const FIRST_USE_SKETCHES: Partial<Record<ShaderFeature, string>> = {
	lines: 'tests/pages/sketches/lines-sketch.ts',
	sprites: 'tests/pages/sketches/sprites-sketch.ts',
	particles: 'tests/pages/sketches/particles-sketch.ts',
	background: 'tests/pages/sketches/texture-background-sketch.ts',
	transmission: 'tests/pages/sketches/transmission-sketch.ts',
	// Both suns cast shadows for their feature's picture, and their scenes let the sun draw contact
	// shadows, which load ambient occlusion's shader file on first use. The switch turns those off,
	// so the page downloads its own feature's file alone.
	translucency: 'tests/pages/sketches/translucency-sketch.ts?no-contact',
	subsurface: 'tests/pages/sketches/subsurface-sketch.ts?no-contact',
	coat_sheen: 'tests/pages/sketches/coat-sheen-sketch.ts?noenv',
	weighted: 'tests/pages/sketches/weighted-sketch.ts',
	decals: 'tests/pages/sketches/decal-first-use-sketch.ts',
	// The motion pass draws only while a pass reads the motion, and the debug view reads it, so
	// the motion vectors sketch asks for that view.
	motion: 'tests/pages/sketches/motion-vectors-sketch.ts?case=slide',
	probe_grid: 'tests/pages/sketches/probe-grid-sketch.ts',
};

/** Page switches that a feature needs besides its sketch: the test switches that turn it on. */
const FIRST_USE_SWITCHES: Partial<Record<ShaderFeature, string>> = {
	instance_index: '&instances=index',
	occlusion: '&occlusion=on',
};

/**
 * The features whose first use needs frames that the engine draws, which hold mode has none of. A
 * pick asked before any draw answers by ray and loads no shader, so picking runs on a live page
 * that the sketch tells when its pick has settled. The guide says why it differs.
 */
const FIRST_USE_LIVE: ReadonlySet<ShaderFeature> = new Set(['picking']);

/**
 * The feature whose shader file a feature downloads on each GPU path, where it is another's, and
 * null where the path has no file for it: WebGPU morphs in the skinning pass, only WebGPU reads
 * index-only instance data and culls by occlusion on the GPU, only WebGPU copies a view's
 * image, where WebGL2 draws the view into its target directly, and only WebGPU builds the pass
 * that picks a mesh's cluster patches, where WebGL2 draws the mesh whole.
 */
const FEATURE_FILE_OWNERS: Partial<
	Record<ShaderFeature, Partial<Record<'webgpu' | 'webgl2', ShaderFeature | null>>>
> = {
	morph: { webgpu: 'skinning' },
	instance_index: { webgl2: null },
	occlusion: { webgl2: null },
	views: { webgl2: null },
	cluster_levels: { webgl2: null },
};

/**
 * How long a first-use page may take to answer. The page itself waits for the frame's pipelines to
 * build for up to 30 s (`BUILD_WAIT_LIMIT_MS`), and answers with its error when that runs out. So
 * the test must wait longer than the page's own limit, or it races the page and reports a bare
 * timeout in place of the page's answer. The clear coat and sheen page builds 24 pipelines, more
 * than any other feature's page, and needs about 30 s for them on CI's software GPU: it passed at
 * 30.2 s and failed at 30.5 s and 30.6 s while this wait was 30 s.
 */
const FIRST_USE_WAIT_MS = 60_000;

// A page that uses one such feature downloads that feature's shader file once, for its device's
// fixed bits, and no other feature's shader file. The features come from the shader manifest's
// first-use tables, so a new table gets a test, and fails it until a sketch uses that feature. The
// production build serves no image test page.
for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const feature of SHADER_FEATURES)
		test(`the first use of ${feature} downloads its shader file once on ${gpu}`, async ({
			page,
		}, testInfo) => {
			test.skip(testInfo.project.name === 'production build', 'no image test page');
			// A decal material with any map cannot build its pipeline on a WebGPU device: the
			// pipeline layout asks for 17 sampled textures in the fragment stage, one over the device's
			// default limit of 16 (E1305), so no decal draws there. The decals image tests fail with it
			// too, on both reference sets. This case runs again once the engine binds one fewer.
			test.skip(
				feature === 'decals' && gpu === 'webgpu',
				'a decal material with a map exceeds the WebGPU per-stage sampled-texture limit (E1305)',
			);
			const requests: string[] = [];
			page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
			const sketch =
				FIRST_USE_SKETCHES[feature] ??
				`tests/pages/sketches/first-use-sketch.ts?feature=${feature}`;
			const address = FIRST_USE_LIVE.has(feature)
				? `first-use-live.html?gpu=${gpu}&sketch=${encodeURIComponent(`/${sketch}`)}`
				: `image.html?gpu=${gpu}&hold=0&preset=high&size=320x180${FIRST_USE_SWITCHES[feature] ?? ''}&sketch=${encodeURIComponent(`/${sketch}`)}`;
			await page.goto(address);
			const result = await pageResult<{ error?: string }>(page, FIRST_USE_WAIT_MS);
			expect(result.error).toBeUndefined();
			const shaderFiles = requests.filter(isFirstUseShaderFile);
			const owner = FEATURE_FILE_OWNERS[feature]?.[gpu];
			if (owner === null) {
				expect(shaderFiles).toEqual([]);
				return;
			}
			expect(shaderFiles).toHaveLength(1);
			// The shader files spell a feature's name with hyphens.
			const file = (owner ?? feature).replaceAll('_', '-');
			expect(shaderFiles[0]).toMatch(new RegExp(`/shaders-${file}-(wgsl|glsl)[^/]*$`));
		});

// GPU occlusion culling runs only on WebGPU, where the first-use test turns it on. A scene whose
// walls are marked occluders downloads no shader file with the culling off.
test('marked occluders download no occlusion shader file with ?occlusion=off on webgpu', async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name === 'production build', 'no image test page');
	const requests: string[] = [];
	page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
	const sketch = encodeURIComponent('/tests/pages/sketches/room-sketch.ts');
	await page.goto(`image.html?gpu=webgpu&hold=0&size=320x180&occlusion=off&sketch=${sketch}`);
	const result = await pageResult<{ error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(requests.filter(isFirstUseShaderFile)).toEqual([]);
});

/**
 * Serves the job workers' script with a line at its top that stops the worker named `worker` before
 * it starts, so the engine reports it as a job worker that did not start.
 */
async function jobWorkerFails(page: Page, worker: string): Promise<void> {
	await page.context().route(JOB_WORKER, async (route) => {
		const response = await route.fetch();
		const stop = `if (self.name === ${JSON.stringify(worker)}) throw new Error(${JSON.stringify(`${worker} did not start on purpose`)});\n`;
		await route.fulfill({ response, body: stop + (await response.text()) });
	});
}

// A job worker that does not start is survivable, as the engine's own notes say: the engine runs on
// with the workers it has, and the on-demand loader sends its tasks only to those. The KTX2 sketch
// loads a file during its setup, so the page needs one task to finish. The loader used to send that
// task to a job worker by index, started or not, and a worker that did not start never answers: the
// page then drew nothing at all. Firefox lost the download of that worker's core on 16 October 2026,
// in real-browsers, with one of two job workers gone. Each case here loads a page that must finish a
// task of the loader, and every case keeps the engine to two job workers.
for (const [what, stop] of [
	[
		'no job worker starts',
		(page: Page) => page.context().route(JOB_WORKER, (route) => route.abort()),
	],
	['the second of two job workers starts', (page: Page) => jobWorkerFails(page, 'null3d-job-1')],
	['the first of two job workers starts', (page: Page) => jobWorkerFails(page, 'null3d-job-0')],
] as const) {
	test(`a page draws where ${what}`, async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'production build', 'no image test page');
		await stop(page);
		const sketch = encodeURIComponent('/tests/pages/sketches/ktx2-hdr-sketch.ts');
		await page.goto(
			`image.html?gpu=webgl2&hold=0&preset=high&size=320x180&jobs=2&sketch=${sketch}`,
		);
		const result = await pageResult<{ error?: string; pixels?: string }>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.pixels?.length ?? 0).toBeGreaterThan(0);
	});
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine runs ${mode.name} on ${gpu}`, ALONE, async ({ page }) => {
			await page.goto(`engine.html?gpu=${gpu}&seconds=2&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, gpu)).toEqual([]);
		});
	}
	// A page that runs the sketch and draws steps the sketch right before each draw, which is low
	// latency, whether the page asked for low latency or for drawing on the main thread.
	for (const query of ['sketch-thread=main&latency=low', 'sketch-thread=main&render=main']) {
		test(
			`the engine runs the sketch and draws on the main thread with ?${query} on ${gpu}`,
			ALONE,
			async ({ page }) => {
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
			},
		);
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
	test(`the engine starts no job workers for a scene without parallel work on ${gpu}`, async ({
		page,
	}) => {
		const mode = { ...pipelined, query: 'jobs=3', jobWorkers: 3 };
		await page.goto(`engine.html?gpu=${gpu}&seconds=1&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, gpu, notPacing)).toEqual([]);
		// Only job workers that run record frames, so the figures name none.
		const jobThreads = Object.keys(result.stats.threads).filter((name) => name.startsWith('job-'));
		expect(jobThreads).toEqual([]);
	});
	test(`the engine starts job workers as the parallel work grows, up to the most that ?jobs= sets, on ${gpu}`, async ({
		page,
	}) => {
		const mode = { ...pipelined, query: 'jobs=3', jobWorkers: 3 };
		// Asks for 2 job workers after the first 30 busy frames, and for the third after 30 more. A
		// software GPU draws so few frames a second that its window must be longer than four. CI draws
		// with SwiftShader in every Chrome project, the production build among them, and only the plain
		// project's name says so.
		const soft =
			Boolean(process.env.CI) || test.info().project.name.startsWith('chromium-swiftshader');
		const seconds = soft ? 30 : 4;
		await page.goto(`engine.html?gpu=${gpu}&seconds=${seconds}&${mode.query}&sketch=busy`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, gpu, notPacing)).toEqual([]);
		const jobThreads = Object.keys(result.stats.threads).filter((name) => name.startsWith('job-'));
		expect(jobThreads.sort()).toEqual(['job-0', 'job-1', 'job-2']);
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
// too, with a warning in development builds, and engine.mode says so. engine.mode names the reason,
// and a development build warns once that the page draws.
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
			expect(result.mode.renderFallback).toBe('no-surface');
			const fallback = warnings.filter((text) => text.includes('pipelined mode'));
			const development = testInfo.project.name !== 'production build';
			expect(fallback.length).toBe(latency === 'low' && development ? 1 : 0);
			const pageDraws = warnings.filter((text) => text.includes('the page draws instead'));
			expect(pageDraws.length).toBe(development ? 1 : 0);
		});

// A probe worker that stalls gets a second one with a longer limit, so a machine that was busy for
// a moment still draws in a worker for the rest of the session.
test('a second probe worker answers for one that stalled, and a worker draws', async ({ page }) => {
	const probes = await probeStalls(page, 1);
	await page.goto('engine.html?gpu=webgl2&seconds=1');
	const result = await pageResult<EngineResult & { error?: string }>(page, 60_000);
	await page.context().unrouteAll({ behavior: 'ignoreErrors' });
	expect(result.error).toBeUndefined();
	expect(probes.served).toBe(2);
	expect(result.mode.renderThread).toBe('render-worker');
	expect(result.mode.renderFallback).toBeNull();
});

// A browser without Atomics.waitAsync, such as Firefox before 145, runs every threaded mode. Its
// threads wake each other with messages instead: for each frame, for a pause and its end, and for
// the stop, which must end the job workers' loops.
for (const mode of THREADED_MODES) {
	test(`the engine runs without Atomics.waitAsync, ${mode.name}`, ALONE, async ({ page }) => {
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
