import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { compareToReference } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface RetainResult {
	error?: string;
	beforeDetach: number;
	onPageWhileDetached: boolean;
	atDetach: number;
	afterWait: number;
	inSecond: boolean;
	afterAttach: number;
	rebuilds: number;
	removedHeard: number;
	failures: string[];
	width: number;
	height: number;
	pixels: string;
}

for (const mode of ENGINE_MODES)
	test(`an engine keeps its scene off the page and draws it again when attached, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`retain.html?gpu=webgpu&${mode.query}`);
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
		expect(result.removedHeard).toBe(0);
		compareToReference(
			'scene',
			'webgpu',
			Buffer.from(result.pixels, 'base64'),
			result.width,
			result.height,
		);
	});
