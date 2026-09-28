// The sketch's step after a pause: the first frame after the page resumes the sketch counts no time, so
// no step comes near the length of the pause.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** Well under the page's 600 ms pause, and above the longest step the engine allows. */
const LONGEST_STEP_S = 0.5;

for (const mode of ENGINE_MODES) {
	test(`a pause is not one long step, ${mode.name}`, async ({ page }) => {
		await page.goto(`engine.html?gpu=webgpu&seconds=1&pause&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.count.largestStep).toBeLessThan(LONGEST_STEP_S);
	});
}
