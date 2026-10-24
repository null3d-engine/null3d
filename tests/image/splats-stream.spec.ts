// The splats add-on's streaming: a page reads a small index, and the add-on downloads only the
// chunks that its view needs, so the cloud draws before its whole file has arrived. The test asks
// for a cloud larger than the capped budget, so the selection wants a part of it, and checks that
// some chunks loaded, that the whole cloud did not, and that no chunk failed.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What the streaming page reports. */
interface StreamResult {
	error?: string;
	streamed: boolean;
	failures: string[];
	cloud: number;
	presentedFps: number;
	first: {
		drawn: number;
		loaded: number;
		chunks: number;
		loadedBytes: number;
		bytes: number;
	};
	splats: {
		total: number;
		drawn: number;
		chunks: number;
		loaded: number;
		failed: number;
		budget: number;
		bytes: number;
		loadedBytes: number;
	};
}

test('a splat stream draws before its whole cloud arrives, and carries no hole', async ({
	page,
}) => {
	test.setTimeout(180_000);
	// A cloud of many chunks, larger than the capped budget, so the view wants only a part of it.
	// Two measured seconds keep the run short on the software renderer and still draw frames.
	await page.goto('splats-stream.html?gpu=webgl2&splats=400000&budget=10000&seconds=2');
	const result = await pageResult<StreamResult>(page, 150_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.streamed).toBe(true);
	// The draw stayed inside its cap, and the cloud drew.
	expect(result.splats.drawn).toBeGreaterThan(0);
	expect(result.splats.drawn).toBeLessThanOrEqual(10_000);
	expect(result.first.drawn).toBeGreaterThan(0);
	// The view wanted some of the chunks, but not all of them, so the whole file never arrived.
	expect(result.first.loaded).toBeGreaterThan(0);
	expect(result.first.loaded).toBeLessThan(result.first.chunks);
	expect(result.first.loadedBytes).toBeLessThan(result.first.bytes);
	// No chunk failed, so the cloud has no hole.
	expect(result.splats.failed).toBe(0);
	expect(result.splats.loadedBytes).toBeLessThan(result.splats.bytes);
	expect(result.presentedFps).toBeGreaterThan(0);
});
