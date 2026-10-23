// A sun that moves slowly redraws the sky's environment only at its steps, so the light that the
// scene takes from the sky moves in steps of its own. This test sweeps the sun slowly, as a time of
// day does, and weighs each step in the picture: no two captured frames may lie further apart than
// a step that a viewer would see, and the sweep as a whole must move the light.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Frame {
	mirror: number[];
	rough: number[];
}

/** The captures before the sweep. */
const BEFORE = 2;
/**
 * The most that two frames may lie apart, in levels of 255. A step of half a degree of sun, the
 * least that a map draws for, moved the light 4 to 5 levels on the Mac's GPU at a sun 4 to 8
 * degrees up, which is where it changes fastest. A map that lagged a whole step more, or drew the
 * sweep in one go, would show far more than this.
 */
const STEP = 8;
/** The least that the sweep must move the light, in levels of 255, for the test to weigh steps. */
const SWEPT = 15;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** The largest difference between two colors' channels. */
const distance = (a: number[], b: number[]) =>
	Math.max(...a.map((value, c) => Math.abs(value - (b[c] as number))));

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a slow sun's light steps smoothly on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`sky-step.html?gpu=${gpu}&fps=20`);
		const result = await pageResult<{ error?: string; tier: string; frames: Frame[] }>(
			page,
			90_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const frames = result.frames;
		const report = frames
			.map((f, k) => `${k}: ${f.mirror.map(Math.round)} ${f.rough.map(Math.round)}`)
			.join('; ');
		const first = frames[BEFORE - 1] as Frame;
		const last = frames.at(-1) as Frame;
		expect(distance(first.rough, last.rough), report).toBeGreaterThan(SWEPT);
		for (let k = 1; k < frames.length; k++) {
			const before = frames[k - 1] as Frame;
			const after = frames[k] as Frame;
			expect(distance(after.mirror, before.mirror), report).toBeLessThanOrEqual(STEP);
			expect(distance(after.rough, before.rough), report).toBeLessThanOrEqual(STEP);
		}
	});
