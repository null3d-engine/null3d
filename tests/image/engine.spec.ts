import { expect, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult, engineProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** Runs in the page: the result the test page published, once it exists. */
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine runs ${mode.name} on ${gpu}`, async ({ page }) => {
			await page.goto(`engine.html?gpu=${gpu}&seconds=2&${mode.query}`);
			const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(engineProblems(result, mode, gpu)).toEqual([]);
		});
	}
}
