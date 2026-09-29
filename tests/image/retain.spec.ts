// An engine that keeps its scene while its canvas is off the page, as a single-page app does. The
// scene it draws when attached again must match the image test manifest's scene test.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { borrowedRun, environmentNamed, imageProblems } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import type { ItemResult } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

interface RetainResult {
	error?: string;
	beforeDetach: number;
	onPageWhileDetached: boolean;
	atDetach: number;
	afterWait: number;
	inSecond: boolean;
	afterAttach: number;
	rebuilds: number;
	pipelines: number;
	removedHeard: number;
	failures: string[];
	width: number;
	height: number;
	pixels: string;
}

for (const tier of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`an engine keeps its scene off the page and draws it again when attached, on ${tier}, ${mode.name}`, async ({
			page,
		}, testInfo) => {
			await page.goto(`retain.html?gpu=${tier}&${mode.query}`);
			const result = await pageResult<RetainResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			// Off the page, the scene stops: at most the frame in progress when it left finishes.
			expect(result.onPageWhileDetached).toBe(false);
			expect(result.afterWait - result.atDetach).toBeLessThanOrEqual(1);
			// Back on the page, the same scene carries on from where it stopped, with nothing rebuilt.
			expect(result.inSecond).toBe(true);
			expect(result.afterAttach).toBeGreaterThan(result.afterWait);
			expect(result.atDetach).toBeGreaterThanOrEqual(result.beforeDetach);
			expect(result.rebuilds).toBe(0);
			expect(result.pipelines).toBe(0);
			expect(result.removedHeard).toBe(0);
			const run = borrowedRun(manifestRun('scene', tier, mode.name), 'retain');
			const place = { environment: environmentNamed(testInfo.project.name) };
			expect(imageProblems(run, result as unknown as ItemResult, place)).toEqual([]);
		});
