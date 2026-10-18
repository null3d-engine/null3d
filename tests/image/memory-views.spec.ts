// The engine's memory grows in many steps while a scene sets up, and parts of the scene that the
// sketch set up once and then left alone must keep no views of the memory at older sizes. Chrome
// counts each buffer object of a shared memory at its full length, so a thread may hold one buffer
// object per memory (hard rule 20, .dev/implementation-notes.md "Views of the shared memory"). The
// test counts them in heap snapshots of the page and of the sketch and render workers. It then
// checks Chrome's memory figure of each of those workers against the memory's size and the
// worker's own heap. The page's measurement releases idle job workers so they can answer.
import { expect, test } from '@playwright/test';
import { type HeapSnapshot, retainerChains, takeHeapSnapshot } from '../lib/heap-retainers.ts';
import { pageResultWhileProgressing } from '../lib/page-result.ts';
import { sharedStores, workerSessions } from '../lib/shared-buffers.ts';

interface MemoryViewsResult {
	error?: string;
	mode: { build: string; sketchThread: string; renderThread: string };
	/** The memory's size after each step of the sketch. */
	sizes: number[];
	failures: string[];
}

/** The fewest steps that must grow the memory, so the test covers views made at many sizes. */
const MIN_GROWTHS = 8;
/** What Chrome may count for a worker beyond the memory and the worker's heap. */
const MARGIN_BYTES = 16 * 2 ** 20;
/** The workers that answer the debugger: job workers block between jobs. */
const WORKERS = ['sketch-worker', 'render-worker'] as const;
/**
 * The run fails when its page notes no new step for this long. The sketch notes a step after each
 * of its 24 growth steps, and the growth batches sit on a layer that the camera does not draw, so a
 * step takes the memory's growth and a frame. The wait leaves a slow software GPU room, while a
 * stuck growth still fails.
 */
const STALL_MS = 30_000;
/** The most time the run may take in all, as it always had. */
const RUN_LIMIT_MS = 4 * 60_000;

/** Why a thread fails: each memory store that it views through more than one buffer object. */
function extraBuffers(thread: string, heap: HeapSnapshot): string | undefined {
	const doubled = sharedStores(heap).filter((store) => store.objects > 1);
	if (doubled.length === 0) return undefined;
	const chains = retainerChains(heap, 'SharedArrayBuffer').slice(0, 3);
	return `${thread} holds ${doubled.map((store) => `${store.objects} buffer objects of one ${(store.bytes / 2 ** 20).toFixed(1)} MiB store`).join(', ')}:\n\n${chains.join('\n\n')}`;
}

test('each thread holds one buffer object of the shared memory after it grew in many steps', async ({
	page,
}) => {
	test.setTimeout(RUN_LIMIT_MS);
	await page.goto('memory-views.html');
	const result = await pageResultWhileProgressing<MemoryViewsResult>(page, STALL_MS);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.mode).toMatchObject({
		build: 'threaded',
		sketchThread: 'worker',
		renderThread: 'render-worker',
	});
	const growths = new Set(result.sizes).size - 1;
	expect(growths).toBeGreaterThanOrEqual(MIN_GROWTHS);
	const memoryBytes = Math.max(...result.sizes);

	const problems: string[] = [];
	const { cdp, workers } = await workerSessions(page, WORKERS);
	await cdp.send('HeapProfiler.collectGarbage');
	const pageProblem = extraBuffers('the page', await takeHeapSnapshot(cdp));
	if (pageProblem) problems.push(pageProblem);
	const heaps = new Map<string, number>();
	for (const [name, worker] of workers) {
		const problem = extraBuffers(name, await worker.heapSnapshot());
		if (problem) problems.push(problem);
		const { usedSize } = await worker.send<{ usedSize: number }>('Runtime.getHeapUsage');
		heaps.set(name, usedSize);
	}
	expect(problems).toEqual([]);

	// SwiftShader's headless browser has heap snapshots but offers no page memory measurement.
	if (test.info().project.name.startsWith('chromium-swiftshader')) return;
	const measured = (await page.evaluate('window.__measureMemoryViews?.()')) as
		| { breakdown: { bytes: number; attribution: { url?: string }[] }[] }
		| undefined;
	if (!measured) throw new Error('the browser offers no page memory measurement');
	for (const name of WORKERS) {
		const counted = measured.breakdown
			.filter((entry) => entry.attribution.some((place) => place.url?.includes(name)))
			.reduce((sum, entry) => sum + entry.bytes, 0);
		const bound = memoryBytes + (heaps.get(name) ?? 0) + MARGIN_BYTES;
		expect(counted, `Chrome's figure for ${name} beyond the memory and its heap`).toBeLessThan(
			bound,
		);
	}
});
