// GPU occlusion culling on the WebGPU tiers: in a room whose walls hide most of a field of spheres,
// the engine with occlusion culling draws every view of a fast-turning camera as the engine without
// it does, pixel for pixel. Each turn faces another wall, so the objects that drew in the frame
// before are the wrong ones, and the second phase must draw the rest in the same frame. The image
// tests check the culled scenes in hold mode, where every object draws in the second phase.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface OcclusionResult {
	error?: string;
	tier: string;
	occlusion: { off: boolean; on: boolean };
	views: number;
	differingPixels: number[];
	failures: string[];
}

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
] as const;

for (const { tier, query } of TIERS)
	test(`occlusion culling draws what culling without it draws on ${tier}`, async ({ page }) => {
		test.setTimeout(150_000);
		await page.goto(`occlusion.html?${query}`);
		const result = await pageResult<OcclusionResult>(page, 120_000);
		console.log(`occlusion on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		expect(result.occlusion).toEqual({ off: false, on: true });
		expect(result.differingPixels).toEqual(new Array(result.views).fill(0));
	});
