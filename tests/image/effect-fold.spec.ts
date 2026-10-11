// A custom effect with a loop folds into the final pass beside the vignette, on every GPU tier.
// While bloom is on the fold builds nothing, as bloom reads the effects' image. Once bloom is off
// the fold's joined shader builds, and none fails or stays unbuilt, so the effect needs no pass of
// its own. A loop once made the WebGL2 fold define the final pass's main twice, and the effect fell
// back to a pass of its own with the same image.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface EffectFoldResult {
	error?: string;
	tier: string;
	builtWithBloom: string[];
	built: string[];
	failed: number[] | null;
	keptApart: number[] | null;
	skippedDraws: number;
	pipelines: number;
	failures: string[];
}

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

for (const { tier, query } of TIERS)
	test(`a looping custom effect folds into the final pass on ${tier}`, async ({ page }) => {
		const warnings: string[] = [];
		page.on('console', (message) => {
			if (message.text().includes('joined custom effects failed')) warnings.push(message.text());
		});
		await page.goto(`effect-fold.html?${query}`);
		const result = await pageResult<EffectFoldResult>(page, 60_000);
		console.log(`effect fold on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		expect(warnings).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.keptApart).toEqual([]);
		expect(result.builtWithBloom).not.toContain('effectFold');
		expect(result.built).toContain('effectFold');
		expect(result.skippedDraws).toBe(0);
	});
