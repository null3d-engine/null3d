// Losing the GPU. When it comes back, the engine starts a new device and carries on drawing without
// a failure, in every thread mode and on both GPU paths. When it never comes back, the engine gives
// up, stops drawing and tells the page with E1302.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface LossResult {
	tier: string;
	code: string | null;
	framesAfter?: number;
	lostMidFrame?: boolean;
	error?: string;
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine draws on after a GPU loss on ${gpu}, ${mode.name}`, async ({ page }) => {
			await page.goto(`gpu-loss.html?gpu=${gpu}&simulate&${mode.query}`);
			const result = await pageResult<LossResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.code).toBeNull();
			expect(result.framesAfter ?? 0).toBeGreaterThan(0);
		});
	}
}

for (const query of ['threads=off', 'render=main']) {
	test(`a WebGL2 context that never comes back reaches onFailure, ${query}`, async ({ page }) => {
		await page.goto(`gpu-loss.html?gpu=webgl2&${query}`);
		const result = await pageResult<LossResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe('webgl2');
		expect(result.code).toBe('E1302');
	});
}

test('the engine draws on after a WebGL2 context loss in the middle of a frame', async ({
	page,
}) => {
	await page.goto('gpu-loss.html?gpu=webgl2&render=main&mid-frame');
	const result = await pageResult<LossResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.tier).toBe('webgl2');
	expect(result.lostMidFrame).toBe(true);
	expect(result.code).toBeNull();
	expect(result.framesAfter ?? 0).toBeGreaterThan(0);
});
