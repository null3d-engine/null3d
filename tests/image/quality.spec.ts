// The quality presets in the browser. The ?preset= switch fixes the preset on each GPU path, and
// the engine and the sketch report the same one. The GPU path caps the preset, and the engine
// chooses from the device. The preset check then lowers a preset that the GPU cannot draw the
// scene at. Each preset's texture settings reach the core. Starts that crash the tab make the next
// start lighter. The crash note stays out of storage that the browser refuses, and leaves after the
// first seconds of play. A later start takes the stored result of the preset check. A sketch
// changes its settings, its own upload budget stays until the setting changes, and a setting that
// the engine does not take is refused. A sketch changes the preset, and no frame draws without the
// pipelines of the new preset.
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import type { PresetCheck } from '../../packages/engine/src/quality/check.ts';
import {
	checkedSettings,
	presetSettings,
	type QualityPreset,
	type QualitySettings,
} from '../../packages/engine/src/quality/presets.ts';
import type { Tier } from '../../packages/engine/src/shared/tier.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import {
	HEAVY_SPHERES,
	HEAVY_SPHERES_SOFTWARE,
	heavyCheckProblems,
	PRESET_CHANGE,
	PRESET_CHANGE_SWITCHES,
	type PresetChangeResult,
	presetChangeProblems,
} from '../lib/preset-checks.ts';

/** The texture settings that the core holds. */
interface CoreSettings {
	uploadBudget: number;
	maxAnisotropy: number;
}

/** What the sketch reports: its settings, with JSON's null for Infinity, and the core's. */
interface SketchReport {
	settings: Omit<QualitySettings, 'maxPixelRatio'> & { maxPixelRatio: number | null };
	core: CoreSettings;
}

interface QualityResult {
	ok: boolean;
	error?: string;
	mode: {
		preset: QualityPreset;
		presetCheck: PresetCheck | null;
		crashedStarts: number;
		memoryMaximumMiB: number | null;
	};
	tier: Tier;
	hints: { coarsePointer: boolean; screenMinEdge: number; deviceMemoryGB: number | null };
	sketch: SketchReport & { preset: string };
	changed?: SketchReport;
	refused?: string;
	notesAtFirstFrame: string[] | null;
	notesAfterWait?: string[] | null;
}

/** A report's settings as the engine holds them: JSON gives Infinity as null. */
function settingsOf(report: SketchReport): QualitySettings {
	const { maxPixelRatio } = report.settings;
	return { ...report.settings, maxPixelRatio: maxPixelRatio ?? Number.POSITIVE_INFINITY };
}

/**
 * The preset that the engine chose from the device and the crash notes, before the preset check
 * could lower it. A busy machine can draw even a light scene too slowly for the check.
 */
const chosen = (result: QualityResult) => result.mode.presetCheck?.from ?? result.mode.preset;

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
			const settings = presetSettings(expected as QualityPreset, {}, result.tier);
			expect(settingsOf(result.sketch)).toEqual(settings);
			// The core took the preset's texture settings before the sketch's setup ran.
			expect(result.sketch.core).toEqual({
				uploadBudget: settings.uploadBytesPerFrame,
				maxAnisotropy: settings.maxAnisotropy,
			});
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
	// The setup runs at the chosen preset, which the check measures first.
	expect([chosen(webgpu), webgpu.sketch.preset]).toEqual(['high', 'high']);
	expect(webgpu.mode.presetCheck?.rounds[0]?.preset).toBe('high');
	expect(webgpu.mode.presetCheck?.rounds.at(-1)?.preset).toBe(webgpu.mode.preset);
	expect(webgpu.notesAtFirstFrame).toHaveLength(1);
	const webgl2 = await openQuality(page, 'gpu=webgl2');
	expect(chosen(webgl2)).toBe('medium');
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
		// No preset is lighter than Low, so the engine does not check it.
		expect(result.mode.presetCheck).toBeNull();
	});
});

test('the preset option names the preset, and the GPU path still caps it', async ({ page }) => {
	expect((await openQuality(page, 'gpu=webgpu&option=ultra')).mode.preset).toBe('ultra');
	expect((await openQuality(page, 'gpu=webgpu&option=low')).mode.preset).toBe('low');
	expect((await openQuality(page, 'gpu=webgl2&option=ultra')).mode.preset).toBe('medium');
	// The switch wins over the option.
	expect((await openQuality(page, 'gpu=webgpu&option=low&preset=high')).mode.preset).toBe('high');
	// The engine checks only a preset that it chose itself.
	expect((await openQuality(page, 'gpu=webgpu&option=high')).mode.presetCheck).toBeNull();
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
	expect([chosen(normalStart), normalStart.mode.crashedStarts]).toEqual(['high', 0]);
	await crash(context, first);

	const second = await context.newPage();
	const afterOne = await openQuality(second, 'gpu=webgpu');
	expect([chosen(afterOne), afterOne.mode.crashedStarts]).toEqual(['medium', 1]);
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
	expect([chosen(normal), normal.mode.crashedStarts]).toEqual(['high', 0]);
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
	expect([chosen(result), result.mode.crashedStarts]).toEqual(['high', 0]);
	expect(result.notesAtFirstFrame).toBeNull();
});

test('a later start takes the stored preset check, and ?check=fresh measures again', async ({
	page,
}) => {
	const measured = await openQuality(page, 'gpu=webgpu');
	const check = measured.mode.presetCheck;
	expect(check?.reused).toBe(false);
	const later = await openQuality(page, 'gpu=webgpu');
	expect(later.mode.presetCheck).toEqual({ ...check, reused: true } as PresetCheck);
	// The setup already runs the preset that the check chose, with the settings its steps leave.
	const { preset } = measured.mode;
	expect([later.mode.preset, later.sketch.preset]).toEqual([preset, preset]);
	expect(settingsOf(later.sketch)).toEqual(checkedSettings('high', preset));
	const fresh = await openQuality(page, 'gpu=webgpu&check=fresh');
	expect(fresh.mode.presetCheck?.reused).toBe(false);
});

// The sketch's thread hands the change to the page, which sizes the canvas: through a message
// from a worker, or at once where the page runs the sketch.
for (const mode of ENGINE_MODES) {
	test(`a sketch changes its pixel ratio cap, and hears of the change, ${mode.name}`, async ({
		page,
	}) => {
		const result = await openQuality(
			page,
			`gpu=webgpu&preset=high&set=${JSON.stringify({ maxPixelRatio: 1.25 })}&${mode.query}`,
		);
		expect(result.changed?.settings).toEqual({ ...presetSettings('high'), maxPixelRatio: 1.25 });
		expect(result.refused).toBeUndefined();
	});
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a sketch changes its texture settings during play, and the core takes them on ${gpu}`, async ({
		page,
	}) => {
		const changes = { maxAnisotropy: 2, uploadBytesPerFrame: 1024 * 1024 };
		const result = await openQuality(
			page,
			`gpu=${gpu}&preset=medium&set=${JSON.stringify(changes)}`,
		);
		expect(result.changed?.settings).toEqual({
			...presetSettings('medium', {}, gpu),
			...changes,
		});
		expect(result.changed?.core).toEqual({ uploadBudget: 1024 * 1024, maxAnisotropy: 2 });
	});
}

test("a sketch's own upload budget stays until the setting changes", async ({ page }) => {
	const own = 2048;
	const kept = await openQuality(
		page,
		`gpu=webgpu&preset=low&budget=${own}&set=${JSON.stringify({ maxAnisotropy: 1 })}`,
	);
	expect(kept.changed?.core).toEqual({ uploadBudget: own, maxAnisotropy: 1 });
	const replaced = await openQuality(
		page,
		`gpu=webgpu&preset=low&budget=${own}&set=${JSON.stringify({ uploadBytesPerFrame: 65_536 })}`,
	);
	expect(replaced.changed?.core).toEqual({ uploadBudget: 65_536, maxAnisotropy: 2 });
});

test('a sketch that changes a setting the engine does not take gets E1213', async ({ page }) => {
	// A fixed preset skips the preset check, whose lower preset on a slow machine is a change too.
	const result = await openQuality(
		page,
		`gpu=webgpu&preset=high&set=${JSON.stringify({ shadows: 2 })}`,
	);
	expect(result.changed).toBeUndefined();
	expect(result.refused).toContain(
		'E1213: quality.set() got "shadows", which is not a setting it takes. It takes maxPixelRatio, minRenderScale, maxRenderScale, maxAnisotropy, textureMemoryMiB, uploadBytesPerFrame, shadowFilter, farCascadeInterval, followMovingCasters, shadowCascadeBlend, bloomSize, aoScale, dofSamples, reflectionScale, lodThreshold, lodShadowFactor, lodFade, softwareOcclusion or governor.',
	);
});

test("the page's antialias option replaces the preset's mode, which a sketch cannot change", async ({
	page,
}) => {
	const result = await openQuality(
		page,
		`gpu=webgpu&preset=low&antialias=msaa&set=${JSON.stringify({ antialias: 'fxaa' })}`,
	);
	expect([result.mode.preset, result.sketch.settings.antialias]).toEqual(['low', 'msaa']);
	expect(result.changed).toBeUndefined();
	expect(result.refused).toContain(
		'E1213: quality.set() got antialias, which is fixed when the engine starts. Set it with the antialias option of createEngine().',
	);
});

const heavySpheres = process.env.CI ? HEAVY_SPHERES_SOFTWARE : HEAVY_SPHERES;

for (const [gpu, highest] of [
	['webgpu', 'high'],
	['compat', 'medium'],
	['webgl2', 'medium'],
] as const) {
	test(`the preset check lowers the preset of a scene too heavy for the GPU on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const result = await openQuality(page, `gpu=${gpu}&spheres=${heavySpheres}`);
		expect(heavyCheckProblems(result.mode, highest)).toEqual([]);
	});
}

/** Opens the page that changes the preset with these switches, and returns its result. */
async function openPresetChange(page: Page, query: string): Promise<PresetChangeResult> {
	await page.goto(`preset-change.html?${query}`);
	const result = await pageResult<PresetChangeResult & { error?: string }>(page, 60_000);
	expect(result.error).toBeUndefined();
	return result;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`setPreset changes every setting and draws no frame without its pipelines on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const result = await openPresetChange(
				page,
				[`gpu=${gpu}`, ...PRESET_CHANGE_SWITCHES, mode.query].join('&'),
			);
			expect(presetChangeProblems(result, PRESET_CHANGE.from, PRESET_CHANGE.to)).toEqual([]);
		});
	}

	test(`a new pipeline without a warm-up skips the draws that need it on ${gpu}`, async ({
		page,
	}) => {
		// This shows that the counter finds frames that drew without their pipelines. CI's software
		// GPU often builds the pipeline before the next frame, so no frame skips a draw there.
		test.skip(Boolean(process.env.CI), 'the software GPU builds pipelines before the next frame');
		const result = await openPresetChange(page, `gpu=${gpu}&swap`);
		expect(result.pipelines).toBeGreaterThan(0);
		expect(result.skippedDraws).toBeGreaterThan(0);
	});
}
