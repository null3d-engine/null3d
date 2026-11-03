// A still camera over a grove draws a far shadow cascade again only when a plant that moves reaches
// it (tests/pages/vegetation-shadow-count.ts). A plant whose material names a sway distance stands
// still past it, so a far cascade that only such a plant reaches keeps the layer it holds and draws
// nothing. The page places every row past the near cascades, so the far ones alone reach the grove,
// and counts the frame's draw calls three times: with the sway distance set and the air moving,
// where every far plant stands still; with the air held still; and with no distance, where every far
// plant sways. Nothing else moves, and the camera holds still, so the stopped grove must draw exactly
// what the still one draws. A cascade that still redraws, or a row that still reaches it, makes the
// stopped grove draw more and fails the check. On both GPU paths.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The frames between two far cascades' draws at the Low preset, which is four. */
const FAR_INTERVAL = 4;

interface Result {
	error?: string;
	tier: string;
	preset: string;
	swayDistance: number;
	far: boolean;
	still: boolean;
	frames: number;
	drawCalls: number;
	drawCallsLeast: number;
	/** The window's length, which the page sizes to hold a few frames. */
	seconds?: number;
	gpuMs: number | null;
}

/** The switches that place the grove's rows and hold the air. */
interface Grove {
	/** Place every row past the near cascades. */
	far?: boolean;
	/** Hold the air still. */
	still?: boolean;
}

/** The draw calls a frame of the page draws, with the plants' sway distance in meters. */
async function count(page: Page, gpu: string, sway: number, grove: Grove = {}): Promise<Result> {
	const query = `gpu=${gpu}&sway=${sway}${grove.far ? '&far' : ''}${grove.still ? '&still' : ''}`;
	await page.goto(`vegetation-shadow-count.html?${query}`);
	const result = await pageResult<Result>(page, 120_000);
	expect(result.error).toBeUndefined();
	// A far cascade is due once in this many frames at the Low preset the page runs, so a window
	// shorter than that cannot hold the frame in which the schedule held, and the least count would
	// mean nothing.
	expect(
		result.frames,
		`the ${result.seconds ?? '?'} s window held ${result.frames} frames, fewer than the ${FAR_INTERVAL} that a far cascade's interval needs`,
	).toBeGreaterThanOrEqual(FAR_INTERVAL);
	return result;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a still camera keeps the far cascades of a swaying grove on ${gpu}`, async ({ page }) => {
		test.setTimeout(300_000);
		// Every row is past the near cascades. The sway distance stops all of them, the same grove
		// holds still air, and then every plant is allowed to sway.
		const stopped = await count(page, gpu, 16, { far: true });
		const stillAir = await count(page, gpu, 16, { far: true, still: true });
		const every = await count(page, gpu, 0, { far: true });
		console.log(
			`${stopped.tier} at ${stopped.preset}: the stopped grove draws ${stopped.drawCallsLeast} calls at least and the still one ${stillAir.drawCallsLeast}, where every distance draws ${every.drawCallsLeast}`,
		);
		// The far cascades hold their layers: a plant that stands still asks for no redraw, so the
		// stopped grove draws what the still one draws. A cascade that redraws adds one draw for each
		// of the grove's plant parts, far above the steady count's noise.
		expect(Math.abs(stopped.drawCallsLeast - stillAir.drawCallsLeast)).toBeLessThanOrEqual(1);
		// The control: with no distance every plant sways, so the far cascades draw again and the
		// frame draws more. A measure that could not see a redraw would read the same here.
		expect(every.drawCallsLeast - stillAir.drawCallsLeast).toBeGreaterThanOrEqual(4);
	});
