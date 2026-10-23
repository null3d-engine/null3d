// A custom effect with a loop folds into the final pass beside the vignette, on every GPU tier.
// While bloom is on the fold builds nothing, as bloom reads the effects' image. Once bloom is off
// the fold's joined shader builds, and none fails or stays unbuilt, so the effect needs no pass of
// its own. A loop once made the WebGL2 fold define the final pass's main twice, and the effect fell
// back to a pass of its own with the same image. The page runs without anti-aliasing: where MSAA
// cannot draw float targets, the effect turns FXAA on, and effects never fold beside FXAA. A WebGL2
// device without background compiles, such as SwiftShader, keeps the fold unbuilt by design.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface EffectFoldResult {
	error?: string;
	tier: string;
	backgroundCompiles: boolean;
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
		// The page waits up to half a minute for the fold's build, and a loaded software GPU starts
		// the engine slowly besides: on 20 October 2026 a shard's run reached the test's limit
		// before the page reported. Give the page room to say what it found.
		test.setTimeout(150_000);
		const warnings: string[] = [];
		page.on('console', (message) => {
			if (message.text().includes('joined custom effects failed')) warnings.push(message.text());
		});
		await page.goto(`effect-fold.html?${query}`);
		const result = await pageResult<EffectFoldResult>(page, 120_000);
		console.log(`effect fold on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		expect(warnings).toEqual([]);
		// The page waits its own budget for the fold to settle, then asks once more. A null says the
		// report never came, which a software GPU's slow build can cause: that names itself here
		// rather than reading as a shape mismatch further down.
		expect(result.failed, 'the join timing report arrived').not.toBeNull();
		expect(result.failed).toEqual([]);
		expect(result.builtWithBloom).not.toContain('effectFold');
		if (result.backgroundCompiles) {
			expect(result.keptApart).toEqual([]);
			expect(result.built).toContain('effectFold');
		} else expect(result.keptApart).toHaveLength(1);
		expect(result.skippedDraws).toBe(0);
	});
