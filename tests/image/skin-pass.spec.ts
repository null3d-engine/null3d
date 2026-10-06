// The WebGPU skinning pass skins fixed meshes as the CPU does, in every layout of joints and
// weights that the renderer makes, and a draw reads each part's skinned vertices from its region.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { type SkinPassResult, skinPassProblems } from '../lib/skin-pass-checks.ts';

for (const tier of ['webgpu', 'compat'] as const)
	test(`the skinning pass skins every layout of joints and weights, on ${tier}`, async ({
		page,
	}) => {
		await page.goto(`skin-pass.html?gpu=${tier}`);
		const result = await pageResult<SkinPassResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(skinPassProblems(result)).toEqual([]);
		// The cases that the renderer never makes isolate a device's fault; each must still pass here.
		expect(result.cases.filter(({ ok }) => !ok).map(({ name }) => name)).toEqual([]);
	});
