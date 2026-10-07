// KTX2 files in a live engine, in every thread mode on both GPU paths: each file becomes the
// compressed format that the device's features allow, the GPU memory counts its blocks, and the
// calls that must fail give their codes. ?compression= limits the families, as on a device with
// one of them or none. The KTX2 loader and the transcoder's module download once, when the first
// KTX2 file loads, and the transcoder's task once in each job worker that runs it. A page without
// KTX2 files downloads none of them. With a meshopt glTF file at the same time, each decoder runs
// in the engine's own workers and compiles once per page. A second visit takes each file's texels
// from the cache of transcoded textures, and downloads no part of the transcoder.
import { expect, type Page, test } from '@playwright/test';
import type { CompressionFamily } from '../../packages/engine/src/page/switches.ts';
import { ENGINE_MODES, modeProblems } from '../lib/engine-checks.ts';
import { type Ktx2Result, ktx2Problems } from '../lib/ktx2-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/**
 * The files of the KTX2 loader, the transcoder's task and its module, by their addresses on the dev
 * server and in a production build, which adds a hash to each name.
 */
const KTX2_FILES: Record<string, RegExp> = {
	loader: /\/scene\/ktx2\.ts$|\/ktx2-[\w-]{8}\.js$/,
	task: /\/scene\/ktx2-transcode\.ts$|\/ktx2-transcode-[\w-]{8}\.js$/,
	wasm: /\/basis_transcoder(-[\w-]{8})?\.wasm$/,
};

/** Records the address of every request that the page and its workers make. */
function recordRequests(page: Page): string[] {
	const urls: string[] = [];
	page.context().on('request', (request) => urls.push(new URL(request.url()).pathname));
	return urls;
}

/** How many of the requests fetched each file of the KTX2 loader and the transcoder. */
function ktx2Downloads(urls: readonly string[]): Record<string, number> {
	return Object.fromEntries(
		Object.entries(KTX2_FILES).map(([file, path]) => [
			file,
			urls.filter((url) => path.test(url)).length,
		]),
	);
}

/**
 * Loads the KTX2 page with the switches in `query`, and checks what its textures recorded against
 * the device's compressed families, or the `allowed` ones among them. Returns the page's result
 * and requests.
 */
async function checkTextures(
	page: Page,
	query: string,
	allowed?: readonly CompressionFamily[],
): Promise<{ result: Ktx2Result & { error?: string }; requests: string[] }> {
	const requests = recordRequests(page);
	await page.goto(`ktx2-files.html?${query}`);
	const result = await pageResult<Ktx2Result & { error?: string }>(page, 60_000);
	expect(result.error).toBeUndefined();
	const production = test.info().project.name === 'production build';
	expect(ktx2Problems(result, { allowed, production })).toEqual([]);
	return { result, requests };
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES)
		test(`KTX2 files become the device's compressed formats, on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const { result, requests } = await checkTextures(page, `gpu=${gpu}&${mode.query}`);
			expect(modeProblems(result.mode, mode)).toEqual([]);
			// One thread loads the files and compiles the transcoder, so the loader and the module
			// download once for all six. Each worker that runs the task imports it once.
			const { loader, task, wasm } = ktx2Downloads(requests);
			expect({ loader, wasm }).toEqual({ loader: 1, wasm: 1 });
			expect(task).toBeGreaterThan(0);
		});
	// Each family alone, as on a device that has only it, and none, as on a device without any.
	for (const family of ['astc', 'bc', 'etc2', 'none'] as const)
		test(`?compression=${family} keeps KTX2 files to its formats, on ${gpu}`, async ({ page }) => {
			const allowed = family === 'none' ? [] : [family];
			await checkTextures(page, `gpu=${gpu}&compression=${family}`, allowed);
		});
}

// The engine test page, whose start the startup benchmark times, loads no KTX2 file.
for (const mode of ENGINE_MODES)
	test(`a page without KTX2 files downloads no part of the KTX2 loader or the transcoder, ${mode.name}`, async ({
		page,
	}) => {
		const requests = recordRequests(page);
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<{ error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(requests.some((path) => /\/null3d_bg(-[\w-]+)?\.wasm$/.test(path))).toBe(true);
		expect(ktx2Downloads(requests)).toEqual({ loader: 0, task: 0, wasm: 0 });
	});

/** The engine worker that a worker's script address names, such as `job-worker`. */
const workerName = (url: string) =>
	/\/([a-z]+-worker)(-[\w-]{8})?\.(js|ts)$/.exec(new URL(url).pathname)?.[1] ?? url;

/** How many requests fetched a file whose address matches `path`. */
const countOf = (requests: readonly string[], path: RegExp) =>
	requests.filter((url) => path.test(url)).length;

// The on-demand loader compiles each decoder's module once, in the thread that runs the sketch, and
// sends it to the engine's own workers. The KTX2 transcoder runs in the job workers, or in the one
// task worker where the engine has no job workers. The meshopt decoder runs in the glTF worker,
// where the file is parsed. No other worker starts.
for (const mode of ENGINE_MODES)
	test(`the meshopt and KTX2 decoders run in the engine's workers and compile once, ${mode.name}`, async ({
		page,
	}) => {
		const workers: string[] = [];
		page.on('worker', (worker) => workers.push(workerName(worker.url())));
		const requests = recordRequests(page);
		await page.goto(`ktx2-files.html?gpu=webgl2&decoders&${mode.query}`);
		const result = await pageResult<{
			error?: string;
			recorded: { bounds: number[]; formats: string[] };
		}>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.recorded.formats).toHaveLength(8);
		expect(result.recorded.bounds.some((v) => v !== 0)).toBe(true);
		expect(countOf(requests, KTX2_FILES.wasm as RegExp)).toBe(1);
		expect(countOf(requests, /\/meshopt_decoder(-[\w-]{8})?\.wasm$/)).toBe(1);
		const started = [...new Set(workers)].sort();
		const allowed =
			mode.build === 'single'
				? ['gltf-worker', 'probe-worker', 'task-worker']
				: ['gltf-worker', 'job-worker', 'probe-worker', 'render-worker', 'sketch-worker'];
		expect(started.filter((name) => !allowed.includes(name))).toEqual([]);
		expect(started).toContain('gltf-worker');
		expect(started).toContain(mode.build === 'single' ? 'task-worker' : 'job-worker');
	});

/** What the texture cache page reports for one visit. */
interface CacheVisit {
	error?: string;
	entriesBefore: number | null;
	entriesAfter: number | null;
	transcoder: boolean;
	textures: { format: string; bytes: number }[];
}

/** One visit of the texture cache page with the KTX2 test files, in the page's browser profile. */
async function cacheVisit(page: Page, query: string): Promise<CacheVisit> {
	await page.goto(`texture-cache.html?${query}`);
	const result = await pageResult<CacheVisit>(page, 60_000);
	expect(result.error).toBeUndefined();
	return result;
}

/** The KTX2 test files that the texture cache page loads. */
const CACHE_PAGE_FILES = 3;

for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a second visit takes KTX2 textures from the cache, without the transcoder, on ${gpu}`, async ({
		page,
	}) => {
		const requests = recordRequests(page);
		const first = await cacheVisit(page, `gpu=${gpu}`);
		expect(first.entriesBefore).toBe(0);
		expect(first.entriesAfter).toBe(CACHE_PAGE_FILES);
		expect(first.transcoder).toBe(true);
		const { loader, task, wasm } = ktx2Downloads(requests);
		expect({ loader, wasm }).toEqual({ loader: 1, wasm: 1 });
		expect(task).toBeGreaterThan(0);
		requests.length = 0;
		const second = await cacheVisit(page, `gpu=${gpu}`);
		expect(second.entriesBefore).toBe(CACHE_PAGE_FILES);
		expect(second.transcoder).toBe(false);
		expect(second.textures).toEqual(first.textures);
		expect(ktx2Downloads(requests)).toEqual({ loader: 1, task: 0, wasm: 0 });
	});

	test(`?texture-cache=off transcodes KTX2 files on every visit, and stores nothing, on ${gpu}`, async ({
		page,
	}) => {
		const query = `gpu=${gpu}&texture-cache=off`;
		const first = await cacheVisit(page, query);
		const second = await cacheVisit(page, query);
		expect([first.entriesAfter, second.entriesBefore]).toEqual([0, 0]);
		expect([first.transcoder, second.transcoder]).toEqual([true, true]);
		expect(second.textures).toEqual(first.textures);
	});
}
