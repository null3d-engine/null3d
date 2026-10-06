// A moving caster's shadow follows it in a far cascade that keeps its layer for several frames.
// The shadow contact sketch drives a dynamic box past still ones, live, in the last of three
// cascades. The box moves a fixed step in each frame, so a slow GPU reads it where a fast one does.
// Each frame read back gives the offset between the box and its shadow. With far cascades that
// draw in every frame, the offset stays nearly the same. With far cascades that draw once in 8
// frames, it must match: a layer kept from an earlier frame would show the shadow where the box
// stood then, up to 7 frames of driving behind it. Hold mode cannot show this, as it draws one
// frame, in which every cascade draws. On both GPU paths.
//
// The sketch first sets `followMovingCasters` itself. Then each preset runs with its own setting,
// far cascades every 8th frame (the governor's longest interval), and frames read one after
// another, so a preset whose far cascades kept their turns around moving casters fails. The box
// drives in the last of the sketch's three cascades, past any preset's nearest one.
//
// Each test opens its own pages, so the tests run in parallel, and CI's shards can split them.
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ mode: 'parallel' });

interface Result {
	error?: string;
	tier: string;
	preset: string;
	offsets: (number | null)[];
}

/**
 * How far, in pixels, a frame's offset may stray from the median of every-frame cascades. The
 * offset depends on where the box is: the shadow's edges step across the far cascade's coarse
 * texels, and the box's top stands nearer the camera than the ground. So a shadow that follows its
 * box still strays by up to about a texel. A shadow two or more frames behind strays by more.
 */
const MAX_STRAY = 5;

/** The presets that each GPU path runs: WebGL2 runs none above Medium. */
const PRESETS = {
	webgpu: ['low', 'medium', 'high', 'ultra'],
	webgl2: ['low', 'medium'],
} as const;

/** Frames that a preset's run reads back, one after another, and how long the page may take. */
const PRESET_READS = 60;
const PRESET_RUN_MS = 100_000;
/**
 * Frames that a preset's run reads back on SwiftShader: three cycles of the far cascades' 8 frames,
 * so 21 frames still show a kept layer. Each read draws a frame twice on the software GPU, and on
 * CI's slowest machines the full count took nearly all of the page's time.
 */
const SWIFTSHADER_PRESET_READS = 24;

/** The frames that a preset's run reads back in the environment that the test runs in. */
const presetReads = (testInfo: TestInfo) =>
	testInfo.project.name === 'chromium-swiftshader' ? SWIFTSHADER_PRESET_READS : PRESET_READS;

async function offsets(
	page: Page,
	gpu: string,
	far: number,
	switches = '',
	timeoutMs = 60_000,
): Promise<number[]> {
	await page.goto(`moving-shadow.html?gpu=${gpu}&far=${far}${switches}`);
	const result = await pageResult<Result>(page, timeoutMs);
	expect(result.error).toBeUndefined();
	const preset = new URLSearchParams(switches).get('preset');
	if (preset) expect(result.preset, 'the page runs the preset it asks for').toBe(preset);
	const found = result.offsets.filter((offset): offset is number => offset !== null);
	expect(found, 'every frame shows the box and its shadow').toHaveLength(result.offsets.length);
	return found;
}

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a moving caster's shadow follows it in a far cascade on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		const everyFrame = await offsets(page, gpu, 1);
		const expected = median(everyFrame);

		for (const offset of everyFrame) expect(Math.abs(offset - expected)).toBeLessThan(MAX_STRAY);
		for (const offset of await offsets(page, gpu, 8))
			expect(Math.abs(offset - expected), `offsets with every frame: ${everyFrame}`).toBeLessThan(
				MAX_STRAY,
			);
	});

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const preset of PRESETS[gpu])
		test(`a moving caster's shadow follows it at ${preset} with its own setting on ${gpu}`, async ({
			page,
		}, testInfo) => {
			test.setTimeout(240_000);
			const switches = `&preset=${preset}&reads=${presetReads(testInfo)}&gap=1`;
			const expected = median(await offsets(page, gpu, 1, switches, PRESET_RUN_MS));
			const kept = await offsets(page, gpu, 8, switches, PRESET_RUN_MS);
			for (const offset of kept)
				expect(Math.abs(offset - expected), `offsets at ${preset}: ${kept}`).toBeLessThan(
					MAX_STRAY,
				);
		});
