// The quality presets in the browser. The ?preset= switch fixes the preset on each GPU path, and
// the engine and the sketch report the same one. The GPU path caps the preset, and the engine
// chooses from the device. Starts that crash the tab make the next start lighter. The crash note
// stays out of storage that the browser refuses, and leaves after the first seconds of play. A
// sketch changes its settings, and a setting that the engine does not take is refused.
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface QualityResult {
	ok: boolean;
	error?: string;
	mode: { preset: string; crashedStarts: number; memoryMaximumMiB: number | null };
	tier: string;
	hints: { coarsePointer: boolean; screenMinEdge: number; deviceMemoryGB: number | null };
	sketch: { preset: string; settings: { maxPixelRatio: number | null } };
	changed?: { maxPixelRatio: number };
	refused?: string;
	notesAtFirstFrame: string[] | null;
	notesAfterWait?: string[] | null;
}

/** The pixel ratio cap of each preset. */
const PIXEL_RATIO_CAPS: Record<string, number> = {
	low: 1.5,
	medium: 2,
	high: 2,
	ultra: Number.POSITIVE_INFINITY,
};

/** Opens the quality page with these switches, and returns its result. */
async function openQuality(page: Page, query: string): Promise<QualityResult> {
	await page.goto(`quality.html?${query}`);
	const result = await pageResult<QualityResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	return result;
}

/** Crashes the page's renderer, as a phone does to a tab that uses too much memory. */
async function crash(context: BrowserContext, page: Page): Promise<void> {
	const cdp = await context.newCDPSession(page);
	const crashed = page.waitForEvent('crash');
	// The renderer dies before it can answer the command.
	void cdp.send('Page.crash').catch(() => {});
	await crashed;
	await page.close();
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const) {
	test(`?preset= fixes each preset up to the GPU path's highest on ${gpu}`, async ({ page }) => {
		for (const preset of ['low', 'medium', 'high', 'ultra']) {
			const result = await openQuality(page, `gpu=${gpu}&preset=${preset}`);
			const expected = gpu === 'webgpu' || preset === 'low' ? preset : 'medium';
			expect([preset, result.mode.preset, result.sketch.preset]).toEqual([
				preset,
				expected,
				expected,
			]);
			// JSON gives Infinity as null.
			expect(result.sketch.settings.maxPixelRatio ?? Number.POSITIVE_INFINITY).toBe(
				PIXEL_RATIO_CAPS[expected] as number,
			);
			expect(result.mode.memoryMaximumMiB).toBe(1024);
			// The switch fixes the preset for tests, so the start keeps no crash note.
			expect(result.mode.crashedStarts).toBe(0);
			expect(result.notesAtFirstFrame).toEqual([]);
		}
	});
}

test("the engine chooses High on a desktop's WebGPU, and Medium on its WebGL2", async ({
	page,
}) => {
	const webgpu = await openQuality(page, 'gpu=webgpu');
	expect(webgpu.hints.coarsePointer).toBe(false);
	expect([webgpu.mode.preset, webgpu.sketch.preset]).toEqual(['high', 'high']);
	expect(webgpu.notesAtFirstFrame).toHaveLength(1);
	const webgl2 = await openQuality(page, 'gpu=webgl2');
	expect(webgl2.mode.preset).toBe('medium');
});

test.describe('on a phone', () => {
	test.use({
		viewport: { width: 412, height: 915 },
		contextOptions: { screen: { width: 412, height: 915 } },
		deviceScaleFactor: 2.625,
		isMobile: true,
		hasTouch: true,
	});

	test('the engine chooses Low from the coarse pointer and the small screen', async ({ page }) => {
		const result = await openQuality(page, 'gpu=webgpu');
		expect(result.hints).toMatchObject({ coarsePointer: true, screenMinEdge: 412 });
		expect([result.mode.preset, result.sketch.preset]).toEqual(['low', 'low']);
		expect(result.sketch.settings.maxPixelRatio).toBe(1.5);
	});
});

test('the preset option names the preset, and the GPU path still caps it', async ({ page }) => {
	expect((await openQuality(page, 'gpu=webgpu&option=ultra')).mode.preset).toBe('ultra');
	expect((await openQuality(page, 'gpu=webgpu&option=low')).mode.preset).toBe('low');
	expect((await openQuality(page, 'gpu=webgl2&option=ultra')).mode.preset).toBe('medium');
	// The switch wins over the option.
	expect((await openQuality(page, 'gpu=webgpu&option=low&preset=high')).mode.preset).toBe('high');
});

test('a preset option that names no preset fails the start with E1213', async ({ page }) => {
	await page.goto('quality.html?gpu=webgpu&option=epic');
	const result = await pageResult<{ ok: boolean; error?: string }>(page, 30_000);
	expect(result.ok).toBe(false);
	expect(result.error).toContain(
		`E1213: createEngine() got the preset "epic", which is not 'auto', 'low', 'medium', 'high' or 'ultra'.`,
	);
});

test('each start that crashed the tab makes the next start lighter', async ({ context }) => {
	// Each page crashes right after its first frame, before its note leaves.
	const first = await context.newPage();
	const normalStart = await openQuality(first, 'gpu=webgpu');
	expect([normalStart.mode.preset, normalStart.mode.crashedStarts]).toEqual(['high', 0]);
	await crash(context, first);

	const second = await context.newPage();
	const afterOne = await openQuality(second, 'gpu=webgpu');
	expect([afterOne.mode.preset, afterOne.mode.crashedStarts]).toEqual(['medium', 1]);
	await crash(context, second);

	// After two crashes on WebGPU, a page that leaves the GPU path to the engine gets WebGL2.
	const third = await context.newPage();
	const afterTwo = await openQuality(third, '');
	expect([afterTwo.mode.preset, afterTwo.mode.crashedStarts, afterTwo.tier]).toEqual([
		'low',
		2,
		'webgl2',
	]);
	await third.close();

	// The third start closed the page normally, so the next start is a normal one again.
	const fourth = await context.newPage();
	const normal = await openQuality(fourth, 'gpu=webgpu');
	expect([normal.mode.preset, normal.mode.crashedStarts]).toEqual(['high', 0]);
	await fourth.close();
});

test('the crash note leaves once the engine has drawn for its first seconds', async ({ page }) => {
	const result = await openQuality(page, 'gpu=webgpu&wait=6000');
	expect(result.notesAtFirstFrame).toHaveLength(1);
	expect(result.notesAfterWait).toEqual([]);
});

test('storage that the browser refuses counts as a normal start', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			get() {
				throw new DOMException('The storage is blocked.', 'SecurityError');
			},
		});
	});
	const result = await openQuality(page, 'gpu=webgpu');
	expect([result.mode.preset, result.mode.crashedStarts]).toEqual(['high', 0]);
	expect(result.notesAtFirstFrame).toBeNull();
});

test('a sketch changes its pixel ratio cap, and hears of the change', async ({ page }) => {
	const result = await openQuality(
		page,
		`gpu=webgpu&set=${JSON.stringify({ maxPixelRatio: 1.25 })}`,
	);
	expect(result.changed).toEqual({ maxPixelRatio: 1.25, minRenderScale: 0.75, maxRenderScale: 1 });
	expect(result.refused).toBeUndefined();
});

test('a sketch that changes a setting the engine does not take gets E1213', async ({ page }) => {
	const result = await openQuality(page, `gpu=webgpu&set=${JSON.stringify({ antialias: 'fxaa' })}`);
	expect(result.changed).toBeUndefined();
	expect(result.refused).toContain(
		'E1213: quality.set() got "antialias", which is not a setting it takes. It takes maxPixelRatio, minRenderScale or maxRenderScale.',
	);
});
