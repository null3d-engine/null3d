// A grading value that changes while the scene plays, on every GPU tier. A job worker bakes the new
// table beside the frames, so the frames make no GPU object, build no pipeline and skip no draw.
// The page measures play before one change, the frames the change lands across, the frames just
// after it, and a run that changes a value in every frame. It reports each window's intervals,
// uploaded bytes, presented rate and thread times. On a real GPU the window that lands the bake and
// the one after it must both keep the display's rate, so a single stalled frame fails here.
import { expect, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

interface SwitchWindow {
	frames: number;
	intervalMedian: number;
	intervalP99: number;
	uploadMean: number;
	presentedFps: number;
	skippedDraws: number;
	gpuObjects: number;
	pipelines: number;
	sketchMs: number;
}

interface GradingSwitchResult {
	error?: string;
	tier: string;
	before: SwitchWindow;
	landed: SwitchWindow;
	next: SwitchWindow;
	during: SwitchWindow;
	after: SwitchWindow;
	jobBefore: number;
	jobDuring: number;
	failures: string[];
}

const TIERS = [
	{ query: 'webgpu', tier: 'webgpu' },
	{ query: 'compat', tier: 'webgpu-compat' },
	{ query: 'webgl2', tier: 'webgl2' },
] as const;

/**
 * True on CI's software GPU, whose frames are far slower and whose timings are not comparable. The
 * interval bounds below therefore run on a real GPU: the `chrome-real-gpu` project, which is what a
 * developer's Mac runs, and never in CI's SwiftShader browser jobs.
 */
const softwareGpu = () => test.info().project.name.includes('swiftshader');

for (const { query, tier } of TIERS)
	test(`a grading change during play stalls no frame on ${tier}`, ALONE, async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto(`grading-switch.html?gpu=${query}`);
		const result = await pageResult<GradingSwitchResult>(page, 60_000);
		console.log(`grading switch on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		// The bake's table is the change's only upload, and it lands on one frame near the change.
		expect(result.landed.uploadMean + result.next.uploadMean).toBeGreaterThan(
			result.before.uploadMean,
		);
		// The uploads stop with the changes: a run that kept uploading would leave the after window
		// as busy as the changing one.
		expect(result.after.uploadMean).toBeLessThan(result.during.uploadMean * 0.5);
		// A change builds nothing and keeps every draw.
		for (const window of [result.landed, result.next, result.during, result.after]) {
			expect(window.gpuObjects).toBe(0);
			expect(window.pipelines).toBe(0);
			expect(window.skippedDraws).toBe(0);
		}
		// The sketch keeps updating, so the bake is not on its thread.
		expect(result.during.uploadMean).toBeGreaterThan(0);
		expect(result.during.presentedFps).toBeGreaterThan(0);
		test.skip(softwareGpu(), 'the software GPU draws too slowly for a frame interval bound');
		// The window that lands the bake holds the change's own frame. Its longest frame and the
		// longest of the frames after it stay under a quarter over the steady interval, and the
		// presented rate holds: a frame that stalled would pass both bounds.
		expect(result.landed.uploadMean).toBeGreaterThan(result.before.uploadMean);
		expect(result.landed.intervalP99).toBeLessThan(result.before.intervalMedian * 1.25);
		expect(result.next.intervalP99).toBeLessThan(result.before.intervalMedian * 1.25);
		expect(result.landed.presentedFps).toBeGreaterThan(result.before.presentedFps * 0.95);
		expect(result.next.presentedFps).toBeGreaterThan(result.before.presentedFps * 0.95);
		// A value that changes in every frame keeps the middle interval too.
		expect(result.during.intervalMedian).toBeLessThan(result.before.intervalMedian * 1.25);
	});
