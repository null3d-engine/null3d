// The anti-aliasing mode changes while the engine runs. The sketch sets a new mode, and the change
// resolves once a frame in the new mode is on screen. No frame draws without its pipelines, and the
// frame matches the frame of an engine that starts in the new mode. In compatibility mode, MSAA
// draws on the 8-bit path and the other modes draw HDR color, and engine.capabilities.hdr follows
// the mode, on the page and in the sketch.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

type Antialias = 'msaa' | 'fxaa' | 'none';

interface ChangeResult {
	error?: string;
	tier: string;
	sketch: { settings: { antialias: Antialias }; hdr: boolean };
	hdr: { before: boolean; after: boolean; direct: boolean };
	skippedDraws: number;
	pipelines: number;
	frames: number;
	pixels: number;
	changedPixels: number;
	differFromDirect: number;
}

/** Changes the mode on a GPU path, in the thread mode that `query` asks for. */
async function change(
	page: Page,
	gpu: string,
	from: Antialias,
	to: Antialias,
	query = '',
): Promise<ChangeResult> {
	await page.goto(`antialias-change.html?gpu=${gpu}&from=${from}&to=${to}&${query}`);
	const result = await pageResult<ChangeResult>(page, 60_000);
	expect(result.error).toBeUndefined();
	return result;
}

/**
 * Whether WebGPU draws HDR color in a mode: always on core WebGPU, and in compatibility mode with
 * one sample per pixel. On WebGL2 it depends on the device's float targets.
 */
const drawsHdr = (gpu: string, antialias: Antialias) => gpu !== 'compat' || antialias !== 'msaa';

function check(result: ChangeResult, gpu: string, from: Antialias, to: Antialias): void {
	expect(result.sketch.settings.antialias).toBe(to);
	// The new pipelines were built before any frame drew with them, and the new mode shows.
	expect(result.pipelines).toBeGreaterThan(0);
	expect(result.skippedDraws).toBe(0);
	expect(result.changedPixels).toBeGreaterThan(0);
	expect(result.differFromDirect).toBe(0);
	// The page and the sketch report the path of the new mode, as a start in that mode does.
	expect([result.hdr.after, result.sketch.hdr]).toEqual([result.hdr.direct, result.hdr.direct]);
	if (gpu !== 'webgl2')
		expect(result.hdr).toEqual({
			before: drawsHdr(gpu, from),
			after: drawsHdr(gpu, to),
			direct: drawsHdr(gpu, to),
		});
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const) {
	for (const [from, to] of [
		['msaa', 'fxaa'],
		['fxaa', 'msaa'],
		['msaa', 'none'],
	] as const) {
		test(`the anti-aliasing mode changes from ${from} to ${to} while the engine runs on ${gpu}`, async ({
			page,
		}) => {
			check(await change(page, gpu, from, to), gpu, from, to);
		});
	}
}

// Each thread mode records and draws the change on other threads, and compatibility mode changes
// between the 8-bit path and HDR color.
for (const mode of ENGINE_MODES.filter(({ query }) => query !== '')) {
	test(`the anti-aliasing mode changes in compatibility mode, ${mode.name}`, async ({ page }) => {
		check(await change(page, 'compat', 'msaa', 'fxaa', mode.query), 'compat', 'msaa', 'fxaa');
	});
}
