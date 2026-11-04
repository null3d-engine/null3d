// The volumetric fog in play, where each frame blends the last frame's grid: the blend that hold
// mode, and so every held image test, never runs. Each GPU path draws the sun scene at Medium's
// grid with a still camera (tests/pages/fog-live.ts), and compatibility mode and WebGL2 must draw
// WebGPU's image. WebGL2 counts rows from the bottom and reads the last frame's grid with code of
// its own, so a wrong read there shows as a different image. The fog draws on the HDR path alone, so
// a compatibility path that stays 8-bit draws none; the test skips that comparison with its reason.
import { expect, type Page, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import { differentShare } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface FogLiveResult {
	error?: string;
	tier: string;
	hdr: boolean;
	frames: number;
	pixels: string;
	failures: string[];
}

// The blend settles on a still camera: a cell keeps its sample point, so the last frame's grid stops
// changing, and a page that waits for the blend's frames draws the same image on every load. On the
// Mac, three loads of WebGPU's page drew the same image, with no pixel apart in a channel of 16. A
// history read from the wrong place moves the whole blend, far past that, so the bound sits well
// above it.
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
const LOAD_TIMEOUT_MS = 180_000;
/**
 * The share of pixels over which a path's fogged frame must differ from its own fog-off frame. The
 * volumetric fog covers most of the scene, so a path that draws it moves far more than this; a path
 * that draws none draws the plain fog both times, and the two frames match.
 */
const NO_FOG_SHARE = 0.01;

async function load(page: Page, gpu: string, fog: 'on' | 'off' = 'on') {
	await page.goto(`fog-live.html?gpu=${gpu}&fog=${fog}`);
	const result = await pageResult<FogLiveResult>(page, LOAD_TIMEOUT_MS);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.frames).toBeGreaterThanOrEqual(MIN_FRAMES);
	return result;
}

// Both other paths against one WebGPU frame. Each path loads the scene with the volumetric fog and
// with it off, so a path that draws no fog is skipped with its reason rather than compared with a
// frame it cannot match. The comparisons are soft, so one path's verdict does not hide the other's.
// The page counts its frames within a bounded time, so the test runs alone: in CI run 39315370327 a
// heavy file on the other worker held it to 19 frames in the page's 150 seconds.
test(
	"the volumetric fog in play draws WebGPU's image on compat and webgl2",
	ALONE,
	async ({ page }) => {
		// Six loads of the heaviest live scene here, each of which may settle for as long as its own
		// cap allows and is then captured.
		test.setTimeout(1_200_000);
		const webgpu = await load(page, 'webgpu');
		const reference = Buffer.from(webgpu.pixels, 'base64');
		const webgpuPlain = await load(page, 'webgpu', 'off');
		// The reference must show the fog, or no path's comparison means anything.
		expect(
			differentShare(reference, Buffer.from(webgpuPlain.pixels, 'base64'), CHANNEL),
			'WebGPU draws the volumetric fog',
		).toBeGreaterThan(NO_FOG_SHARE);
		for (const gpu of ['compat', 'webgl2'] as const) {
			const other = await load(page, gpu);
			const plain = await load(page, gpu, 'off');
			const fogged = differentShare(
				Buffer.from(other.pixels, 'base64'),
				Buffer.from(plain.pixels, 'base64'),
				CHANNEL,
			);
			if (fogged <= NO_FOG_SHARE) {
				// The engine draws the fog on the HDR path alone. A path that stays 8-bit draws the
				// plain fog both times, so its frame has no fog to compare.
				test.info().annotations.push({
					type: 'skip',
					description: `${gpu} draws no volumetric fog on its 8-bit path (${(fogged * 100).toFixed(2)} per cent against its own fog-off frame), so its frame is not compared with WebGPU's`,
				});
				console.log(`skipped ${gpu}: it draws no volumetric fog`);
				continue;
			}
			expect
				.soft(
					differentShare(Buffer.from(other.pixels, 'base64'), reference, CHANNEL),
					`${gpu} draws WebGPU's image`,
				)
				.toBeLessThanOrEqual(MAX_DIFFERENT);
		}
	},
);
