// Pipelines build before the first frame and never during play: a scene of ten pipelines warms up
// in its setup, and an object added during play waits for its warm-up before it shows. On every
// GPU tier and in every thread mode, and on WebGL2 without background compiles too.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { type WarmUpResult, warmUpProblems } from '../lib/warm-up-checks.ts';

const TIERS = [
	{ name: 'webgpu', tier: 'webgpu', gpu: 'webgpu', query: 'gpu=webgpu' },
	{ name: 'webgpu-compat', tier: 'webgpu-compat', gpu: 'webgpu', query: 'gpu=compat' },
	{ name: 'webgl2', tier: 'webgl2', gpu: 'webgl2', query: 'gpu=webgl2' },
	{
		name: 'webgl2 without background compiles',
		tier: 'webgl2',
		gpu: 'webgl2',
		query: 'gpu=webgl2&compile=wait',
	},
] as const;

for (const { name, tier, gpu, query } of TIERS)
	for (const mode of ENGINE_MODES)
		test(`the first frame builds every pipeline and play builds none on ${name}, ${mode.name}`, async ({
			page,
		}) => {
			await page.goto(`warm-up.html?${query}&${mode.query}`);
			const result = await pageResult<WarmUpResult & { error?: string }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(tier);
			expect(warmUpProblems(result, gpu)).toEqual([]);
		});
