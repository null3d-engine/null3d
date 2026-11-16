// The still-camera accumulation on every GPU tier, in a live engine: a scene that holds still
// blends its frames and then rests, so the thread that draws takes frames without drawing them,
// within the frames that the accumulation needs. A change draws on the next frames, and the view
// rests again. The image tests check the converged frame (tests/image/manifest.ts, `still`).
// On the WebGPU tiers the view also rests with GPU occlusion culling on, on the indirect draws
// where the culling runs: its check of what the culling saves keeps its mode and copies nothing
// while the view holds still, since a trial or a copy records other commands, and a view that
// changes never rests.
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

const CASES = [
	{ gpu: 'webgpu', switches: '' },
	{ gpu: 'compat', switches: '' },
	{ gpu: 'webgl2', switches: '' },
	{ gpu: 'webgpu', switches: '&occlusion=on&direct=off' },
	{ gpu: 'compat', switches: '&occlusion=on&direct=off' },
] as const;

for (const { gpu, switches } of CASES) {
	const name = switches ? `${gpu} with ${switches.slice(1)}` : gpu;
	test(`a still view rests and a change draws at once, on ${name}`, async ({ page }) => {
		test.setTimeout(180_000);
		// ?target-fps=1 keeps the frame-budget governor and the preset check from lowering the render
		// scale while the test measures: a lower scale resets the accumulation and draws the view
		// again, which would count as frames to rest that the still view never took.
		await page.goto(`still.html?gpu=${gpu}&still-camera=on&target-fps=1${switches}`);
		const result = await pageResult<StillResult>(page, 150_000);
		console.log(`still on ${name}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.rested).toBe(true);
		expect(result.restFrames).toBeLessThanOrEqual(REST_FRAMES);
		expect(result.drewAfterChange).toBe(true);
		expect(result.restedAgain).toBe(true);
		expect(result.restAgainFrames).toBeLessThanOrEqual(REST_FRAMES);
	});
}
