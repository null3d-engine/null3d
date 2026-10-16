// The volumetric fog in play, where each frame blends the last frame's grid: the blend that hold
// mode, and so every held image test, never runs. Each GPU path draws the sun scene at Medium's
// grid with a still camera (tests/pages/fog-live.ts), and compatibility mode and WebGL2 must draw
// WebGPU's image. WebGL2 counts rows from the bottom and reads the last frame's grid with code of
// its own, so a wrong read there shows as a different image.
import { expect, type Page, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface FogLiveResult {
	error?: string;
	tier: string;
	frames: number;
	pixels: string;
	failures: string[];
}

// The blend never settles to one image: each frame's offset cycles every 16 frames, and the last
// frame keeps a weight of 0.9, so two loads of the same path differ by the phase of that cycle. On
// the Mac on 13 October 2026, two WebGPU loads differed over 1.22% of pixels by more than 8 in a
// channel and over 0.02% by more than 16, and WebGL2 sat at 3.00% and 1.48%. A history read from
// the wrong place moves the whole blend, far past these figures, so the bound sits above the noise.
/** The most a channel may differ for two pixels to count as the same. */
const CHANNEL = 16;
/** The share of pixels that may differ from WebGPU's frame. */
const MAX_DIFFERENT = 0.06;
/**
 * The fewest frames of play before the capture: enough for the blend to settle. The page waits for
 * this many frames rather than a time, because a software renderer draws only a few a second.
 */
const MIN_FRAMES = 20;
/**
 * How long one load may take: the page's own cap on the settle, the load, and the capture. It sits
 * above that cap so that a page which settles slowly still reports its own frame count, rather than
 * the run reporting that it heard nothing.
 */
const LOAD_TIMEOUT_MS = 60_000;

async function load(page: Page, gpu: string) {
	await page.goto(`fog-live.html?gpu=${gpu}`);
	const result = await pageResult<FogLiveResult>(page, LOAD_TIMEOUT_MS);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.frames).toBeGreaterThanOrEqual(MIN_FRAMES);
	return result;
}

// Both other paths against one WebGPU frame. The two tests this replaces each drew their own
// WebGPU frame, so the scene was loaded four times over the pair where three do now, and each
// path was judged against a different frame of a blend whose phase cycles. The comparisons are
// soft, so one path's verdict does not hide the other's.
test("the volumetric fog in play draws WebGPU's image on compat and webgl2", async ({ page }) => {
	// Three loads of the heaviest live scene here, each of which may settle for as long as its own
	// cap allows.
	test.setTimeout(240_000);
	const webgpu = await load(page, 'webgpu');
	const reference = Buffer.from(webgpu.pixels, 'base64');
	for (const gpu of ['compat', 'webgl2'] as const) {
		const other = await load(page, gpu);
		expect
			.soft(
				differentShare(Buffer.from(other.pixels, 'base64'), reference, CHANNEL),
				`${gpu} draws WebGPU's image`,
			)
			.toBeLessThanOrEqual(MAX_DIFFERENT);
	}
});
