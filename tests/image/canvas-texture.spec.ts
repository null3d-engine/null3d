// What a canvas texture's refresh costs on each GPU path: the sketch times twenty refreshes of a
// 256 x 256 rectangle of a 1024 x 1024 canvas against four of the whole canvas, and the page reports
// the middle time of each. It then measures a window of frames that refresh the rectangle and a
// window of the same drawing with no refresh, so the difference is the upload's share of a frame.
// The figures are for D-204. It runs only with NULL3D_CANVAS_COST set, in a quiet window on a
// computer with a GPU of its own: NULL3D_CANVAS_COST=1 bun run test:browser -- canvas-texture.spec.ts.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

interface Result {
	error?: string;
	tier: string;
	budget: number;
	refreshes: number;
	frames: number;
	intervalMs: number;
	idleIntervalMs: number;
	gpuMs: number | null;
	gpuIdleMs: number | null;
	cpuMs: number;
	cpuIdleMs: number;
	rectMs: number;
	wholeMs: number;
	uploadMiB: number;
	uploadP99KiB: number;
	withinBudget: boolean;
	partial: boolean;
	rateKept: boolean;
	refreshed: boolean;
}

test.use(TIMING_BROWSER);

test.skip(!process.env.NULL3D_CANVAS_COST, 'set NULL3D_CANVAS_COST to time the refresh');

/** Texels of the rectangle, in mebibytes of RGBA8 texels. */
const RECT_MIB = (256 * 256 * 4) / (1024 * 1024);
/** Texels of the whole canvas, in mebibytes of RGBA8 texels. */
const WHOLE_MIB = (1024 * 1024 * 4) / (1024 * 1024);

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a canvas screen's refresh cost on ${gpu}`, async ({ page }) => {
		test.setTimeout(costTimeout(200_000));
		const loadBefore = await waitForQuiet();
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`canvas-texture.html?gpu=${gpu}&preset=high`);
		const result = await pageResult<Result>(page, 200_000);
		expect(result.error).toBeUndefined();
		const rectCost = result.rectMs / RECT_MIB;
		const wholeCost = result.wholeMs / WHOLE_MIB;
		console.log(`load ${loadBefore} before and ${loadNow()} after on ${gpu}`);
		console.log(
			`canvas refresh on ${result.tier}: ${result.rectMs.toFixed(2)} ms for ${RECT_MIB} MiB of rectangle (${rectCost.toFixed(2)} ms/MiB); ${result.wholeMs.toFixed(2)} ms for ${WHOLE_MIB} MiB whole (${wholeCost.toFixed(2)} ms/MiB); ${result.refreshes} refreshes in ${result.frames} frames at an interval of ${result.intervalMs.toFixed(2)} ms, ${result.uploadMiB.toFixed(2)} MiB a frame on average, ${result.uploadP99KiB.toFixed(0)} KiB at p99 of ${(result.budget / 1024).toFixed(0)} KiB`,
		);
		console.log(
			`canvas frame on ${result.tier}: GPU ${result.gpuMs === null ? 'none' : result.gpuMs.toFixed(3)} ms with refreshes and ${result.gpuIdleMs === null ? 'none' : result.gpuIdleMs.toFixed(3)} ms without, CPU ${result.cpuMs.toFixed(3)} ms and ${result.cpuIdleMs.toFixed(3)} ms, interval ${result.intervalMs.toFixed(2)} ms and ${result.idleIntervalMs.toFixed(2)} ms`,
		);
		expect(result.withinBudget).toBe(true);
		expect(result.partial).toBe(true);
		expect(result.rateKept).toBe(true);
		expect(result.refreshed).toBe(true);
	});
