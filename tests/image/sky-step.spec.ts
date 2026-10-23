// A sun that moves slowly redraws the sky's environment only at its steps, so the light that the
// scene takes from the sky moves in steps of its own. This test sweeps the sun slowly, as a time of
// day does, and weighs each step in the picture: no two captured frames may lie further apart than
// a step that a viewer would see, the sweep as a whole must move the light, and it must move in as
// many steps as the sun crossed. The page reads 320 by 180 pixels and sweeps three half-degree
// steps, which keeps its work small enough for CI's software GPU: 272 captures of a 480-pixel-wide
// page gave the first version more than the ninety seconds a page may take there.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Frame {
	mirror: number[];
	rough: number[];
}

/** The captures before the sweep. */
const BEFORE = 2;
/**
 * The most that two frames may lie apart, in levels of 255. The sweep's three steps moved the light
 * 3 to 4 levels each, on the Mac's GPU and on its software GPU alike, at a sun 8 to 6.5 degrees up,
 * which is where the sky changes fastest. A map that lagged another whole step would show twice this.
 */
const STEP = 8;
/**
 * The least that the sweep must move the light, in levels of 255, for the test to weigh steps. The
 * three steps moved it about 11 levels on every GPU tier.
 */
const SWEPT = 6;
/** The least number of times the light must move: one step of the sun for each in the sweep. */
const STEPS = 3;
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
		).catch(async (failure) => {
			// A page that never reports is either slow or stopped: its trail says which, and how far
			// its captures got.
			const trail = await page.evaluate(
				() => (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? [],
			);
			throw new Error(`${(failure as Error).message}\nThe page's steps: ${trail.join('; ')}`);
		});
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const frames = result.frames;
		const report = frames
			.map((f, k) => `${k}: ${f.mirror.map(Math.round)} ${f.rough.map(Math.round)}`)
			.join('; ');
		const first = frames[BEFORE - 1] as Frame;
		const last = frames.at(-1) as Frame;
		expect(distance(first.rough, last.rough), report).toBeGreaterThan(SWEPT);
		const changes = frames
			.slice(1)
			.filter(
				(frame, k) =>
					distance(frame.mirror, (frames[k] as Frame).mirror) > 0 ||
					distance(frame.rough, (frames[k] as Frame).rough) > 0,
			).length;
		expect(changes, report).toBeGreaterThanOrEqual(STEPS);
		for (let k = 1; k < frames.length; k++) {
			const before = frames[k - 1] as Frame;
			const after = frames[k] as Frame;
			expect(distance(after.mirror, before.mirror), report).toBeLessThanOrEqual(STEP);
			expect(distance(after.rough, before.rough), report).toBeLessThanOrEqual(STEP);
		}
	});
