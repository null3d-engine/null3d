// The still-camera accumulation on every GPU tier, in a live engine: a scene that holds still
// blends its frames and then rests, so the thread that draws takes frames without drawing them,
// within the frames that the accumulation needs. A change draws on the next frames, and the view
// rests again. The image tests check the converged frame (tests/image/manifest.ts, `still`).
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface StillResult {
	error?: string;
	tier: string;
	rested: boolean;
	restFrames?: number;
	restMs?: number;
	drewAfterChange: boolean;
	restedAgain: boolean;
	restAgainFrames?: number;
}

/**
 * The most frames a view may take to rest: the accumulation's frames, the two frames that the
 * comparison waits for, and a margin for the frames that the first pipelines take to build.
 */
const REST_FRAMES = 64 + 2 + 30;

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`a still view rests and a change draws at once, on ${gpu}`, async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto(`still.html?gpu=${gpu}&still-camera=on`);
		const result = await pageResult<StillResult>(page, 80_000);
		console.log(`still on ${gpu}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.rested).toBe(true);
		expect(result.restFrames).toBeLessThanOrEqual(REST_FRAMES);
		expect(result.drewAfterChange).toBe(true);
		expect(result.restedAgain).toBe(true);
		expect(result.restAgainFrames).toBeLessThanOrEqual(REST_FRAMES);
	});
