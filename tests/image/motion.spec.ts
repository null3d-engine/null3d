import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** Runs in the page: the sketch's view of the motion preference. */
const state = () => (globalThis as { motionState?: () => Promise<unknown> }).motionState?.();

for (const mode of ENGINE_MODES)
	test(`the sketch follows the user's motion preference, ${mode.name}`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(`motion.html?gpu=webgpu&${mode.query}`);
		const result = await pageResult<{ error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		// Setup sees the preference the page started with, and no change is announced.
		expect(await page.evaluate(state)).toEqual({ atSetup: true, reducedMotion: true, notices: [] });

		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await expect.poll(() => page.evaluate(state)).toMatchObject({ notices: [false] });
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await expect
			.poll(() => page.evaluate(state))
			.toMatchObject({
				reducedMotion: true,
				notices: [false, true],
			});
	});
