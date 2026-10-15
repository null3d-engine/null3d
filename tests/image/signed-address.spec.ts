// Grows the engine's shared memory past 2 GiB and then draws and stops the engine, on each GPU
// path. The addresses the render worker and the page read from the shared Int32 slots then live
// above 2 GiB, where a signed read is negative and a view or word index made from it points outside
// the memory (hard rule 31). On WebGPU the draw list's address really passes 2 GiB, which runs the
// conversion in `render/scene-renderer.ts` on both paths. On WebGL2 the draw list packs draws into
// multi-draw calls, so its length, and so its address, stays in the engine's low heap; that path
// proves the same memory growth, drawing and stop. The test skips where the browser refuses the
// memory.
import { expect, test } from '@playwright/test';
import { pageResultWhileProgressing } from '../lib/page-result.ts';

interface SignedAddressResult {
	error?: string;
	trail?: string[];
	threaded?: boolean;
	skipped?: string;
	memoryBeforeMiB?: number;
	memoryAfterMiB?: number;
	drawListAddress?: number;
	drawListWords?: number;
	made?: number;
	presented?: number;
	stopMs?: number;
	failures?: string[];
}

/** The address at or above which a signed 32-bit read is negative. */
const SIGNED_LIMIT = 2 ** 31;
/** The run fails when its page notes no new step for this long. */
const STALL_MS = 60_000;
/** The most time the run may take in all. */
const RUN_LIMIT_MS = 4 * 60_000;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`the memory past 2 GiB draws and stops on ${gpu}`, async ({ page }) => {
		test.setTimeout(RUN_LIMIT_MS);
		await page.goto(`signed-address.html?gpu=${gpu}`);
		const result = await pageResultWhileProgressing<SignedAddressResult>(page, STALL_MS);
		// The whole result explains a failure of any assertion.
		console.log(`signed-address ${gpu}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		// A browser that refuses the 2 GiB memory, or a page that is not isolated, cannot run this.
		test.skip(result.skipped !== undefined, result.skipped ?? '');
		expect(result.threaded).toBe(true);
		// The memory really passed 2 GiB on both paths.
		expect(result.memoryAfterMiB ?? 0).toBeGreaterThanOrEqual(2048);
		expect(result.drawListAddress ?? 0).toBeGreaterThan(0);
		// WebGPU's draw list address passes 2 GiB, so the conversion is exercised for real.
		if (gpu === 'webgpu')
			expect(
				result.drawListAddress ?? 0,
				'the draw list address, which must pass 2 GiB to cover the fault',
			).toBeGreaterThanOrEqual(SIGNED_LIMIT);
		expect(result.made ?? 0).toBeGreaterThan(1_000);
		// The frames drew from the list, and the engine stopped cleanly.
		expect(result.presented ?? 0).toBeGreaterThan(0);
		expect(result.failures).toEqual([]);
		expect(result.stopMs ?? RUN_LIMIT_MS).toBeLessThan(30_000);
	});
