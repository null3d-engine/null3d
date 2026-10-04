// Software occlusion culling in a live engine: the occlusion cost page flies down a street of the
// city with the culling off and on in turns. On WebGL2 the buildings hide part of the city, so the
// frames with the culling on list fewer entries, and count the ones they hid; the frames with it
// off hide none. WebGPU ignores the setting and counts nothing. The image tests check that both
// sides draw the same image, in hold mode. Each run logs the page's figures.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Side {
	visibleEntries: number | null;
	occludedEntries: number | null;
	intervalMs: number | null;
}

interface OcclusionResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	failures: string[];
}

for (const tier of ['webgl2', 'webgpu'] as const)
	test(`software occlusion culling hides what the buildings block on ${tier}`, async ({ page }) => {
		await page.goto(`occlusion-cost.html?gpu=${tier}&rounds=1&seconds=0.5`);
		const result = await pageResult<OcclusionResult>(page, 60_000);
		console.log(`occlusion on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		const { off, on } = result;
		if (tier === 'webgpu') {
			expect([off.occludedEntries, on.occludedEntries]).toEqual([null, null]);
			return;
		}
		expect(off.occludedEntries).toBe(0);
		expect(on.occludedEntries).toBeGreaterThan(0);
		expect(on.visibleEntries).toBeLessThan(off.visibleEntries as number);
	});
