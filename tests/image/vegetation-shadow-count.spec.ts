// A still camera over a grove whose near plants sway draws far shadow cascades only when a plant
// that moves reaches them (tests/pages/vegetation-shadow-count.ts). A plant whose material names a
// sway distance stands still past it, so a far cascade that only such a plant reaches keeps the
// layer it holds and draws nothing. The page counts the frame's draw calls twice: with the sway
// distance inside the grove, where the far trees stand still, and with no distance, where every
// tree sways and every far cascade draws again in every frame. Nothing else moves, and the camera
// holds still, so the two counts differ by the far cascades' redraws. On both GPU paths.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	preset: string;
	swayDistance: number;
	frames: number;
	drawCalls: number;
	gpuMs: number | null;
}

/** The draw calls a frame of the page draws, with the plants' sway distance in meters. */
async function count(page: Page, gpu: string, sway: number): Promise<Result> {
	await page.goto(`vegetation-shadow-count.html?gpu=${gpu}&sway=${sway}`);
	const result = await pageResult<Result>(page, 120_000);
	expect(result.error).toBeUndefined();
	expect(result.frames, 'the measurement covers frames').toBeGreaterThan(0);
	return result;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a still camera keeps the far cascades of a swaying grove on ${gpu}`, async ({ page }) => {
		test.setTimeout(300_000);
		// Near plants sway and the far ones stand still, then every plant sways.
		const near = await count(page, gpu, 40);
		const every = await count(page, gpu, 0);
		console.log(
			`${near.tier} at ${near.preset}: sway 40 m draws ${near.drawCalls.toFixed(1)} calls a frame, every distance draws ${every.drawCalls.toFixed(1)}`,
		);
		expect(near.drawCalls).toBeLessThan(every.drawCalls);
		// Two far cascades of three redraw every fourth frame, so their plants' draws cost about half
		// a cascade a frame over the window.
		expect(every.drawCalls - near.drawCalls).toBeGreaterThan(every.drawCalls * 0.05);
	});
