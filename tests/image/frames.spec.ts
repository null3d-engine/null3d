// The frame loop of the thread that draws, in every thread mode. A frame callback that finds no new
// frame draws nothing, as while the page pauses the engine, and the sketch's first step after a pause
// counts no time. ?fps= holds the drawing to a fixed rate below the display's. On a GPU that falls
// behind, at most two frames wait on it, on both GPU paths.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { framesInFlight, type OverloadResult, PARTED_SHARE } from '../pages/lib/overload.ts';

type Result = EngineResult & { error?: string };

/**
 * Fewer frames in the half second after the sketch resumes means that drawing did not resume. The
 * engine draws no faster than the GPU finishes frames, and the software GPU of a busy CI machine
 * can finish only a few in that time.
 */
const MIN_FRAMES_RESUMED = 3;
/** Well under the page's 600 ms pause, and above the longest step the engine allows. */
const LONGEST_STEP_S = 0.5;
/** The rate that ?fps= holds in the test, and how far the presented rate may stray from it. */
const HELD_FPS = 30;
const HELD_FPS_SHARE = 0.1;
/** The slowest display on which the test holds the rate, with callbacks left over to skip. */
const MIN_REFRESH_HZ = 60;

for (const mode of ENGINE_MODES) {
	test(`a pause draws nothing and is not one long step, ${mode.name}`, async ({ page }) => {
		await page.goto(`engine.html?gpu=webgpu&seconds=1&pause&${mode.query}`);
		const result = await pageResult<Result>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.pause?.paused, 'frames drawn during the pause').toEqual({
			frames: 0,
			presented: 0,
		});
		expect(result.pause?.resumed.frames ?? 0).toBeGreaterThan(MIN_FRAMES_RESUMED);
		expect(result.pause?.resumed.presented ?? 0).toBeGreaterThan(MIN_FRAMES_RESUMED);
		expect(result.count.largestStep, 'the longest step').toBeLessThan(LONGEST_STEP_S);
	});

	test(`?fps=${HELD_FPS} holds the drawing at ${HELD_FPS} frames per second, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`engine.html?gpu=webgpu&seconds=2&fps=${HELD_FPS}&${mode.query}`);
		const result = await pageResult<Result>(page, 30_000);
		expect(result.error).toBeUndefined();
		const hz = result.stats.refreshHz ?? 0;
		test.skip(hz < MIN_REFRESH_HZ, `the display refreshes at ${hz} Hz, below ${MIN_REFRESH_HZ} Hz`);
		expect(result.stats.presentedFps).toBeGreaterThan(HELD_FPS * (1 - HELD_FPS_SHARE));
		expect(result.stats.presentedFps).toBeLessThan(HELD_FPS * (1 + HELD_FPS_SHARE));
	});
}

/** The engine's limit of frames waiting on the GPU. */
const FRAMES_LIMIT = 2;
/**
 * The most frames in flight that a run may report: the engine's limit, and a little more, since
 * the figure divides the median time from submit to completion by the mean completed interval.
 */
const MOST_FRAMES_IN_FLIGHT = FRAMES_LIMIT + 0.5;
/** Seconds that the page measures the overloaded step. */
const MEASURED_SECONDS = 2;

/**
 * The page measures the overloaded step for a few seconds. Below this completed rate, that holds
 * too few frames to compare the two rates. CI's software GPU draws WebGL2's HDR frames at one to
 * three frames per second.
 */
const MIN_COMPLETED_FPS = 1;

for (const tier of ['webgpu', 'webgl2'] as const) {
	test(`a GPU that falls behind has at most two frames waiting on it, ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.goto(`overload.html?gpu=${tier}&seconds=${MEASURED_SECONDS}`);
		const result = await pageResult<OverloadResult & { error?: string }>(page, 110_000);
		expect(result.error).toBeUndefined();
		const step = result.overloaded;
		test.skip(!step, 'no step of the page overloaded this GPU');
		if (!step) return;
		const figures = JSON.stringify(step);
		test.skip(
			(step.completedFps ?? Number.POSITIVE_INFINITY) <= MIN_COMPLETED_FPS,
			`the GPU finished too few frames to compare the rates: ${figures}`,
		);
		// The measurement can end with more frames waiting on the GPU than it started with, up to
		// the limit. The presented rate counts them, and the completed rate does not yet. CI's
		// software GPU finishes about three frames in the measurement, so those frames alone can
		// part the two rates by half; the check allows them.
		const waitingFps = FRAMES_LIMIT / MEASURED_SECONDS;
		expect(
			step.presentedFps,
			`the presented rate stayed above the completed rate: ${figures}`,
		).toBeLessThanOrEqual((step.completedFps ?? 0) * (1 + PARTED_SHARE) + waitingFps);
		expect(framesInFlight(step) ?? Number.POSITIVE_INFINITY, figures).toBeLessThan(
			MOST_FRAMES_IN_FLIGHT,
		);
	});
}
