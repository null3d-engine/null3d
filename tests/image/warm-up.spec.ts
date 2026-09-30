// Pipelines build before the first frame and never during play: a scene of ten pipelines warms up
// in its setup, and an object added during play waits for its warm-up before it shows. On every
// GPU tier and in every thread mode.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface WarmUpResult {
	error?: string;
	tier: string;
	firstFramePipelines: number | null;
	warmUpMs: number | null;
	playPipelines: number;
	addedPipelines: number;
	afterPipelines: number;
	magenta: number;
	failures: string[];
}

/** The render pipelines of the pipelines sketch: lit and unlit on four vertex formats, and two. */
const SCENE_PIPELINES = 10;

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
	{ tier: 'webgl2', query: 'gpu=webgl2&compile=wait', name: 'webgl2 without background compiles' },
] as const;

for (const { tier, query, ...named } of TIERS)
	for (const mode of ENGINE_MODES) {
		const name = 'name' in named ? named.name : tier;
		test(`the first frame builds every pipeline and play builds none on ${name}, ${mode.name}`, async ({
			page,
		}) => {
			await page.goto(`warm-up.html?${query}&${mode.query}`);
			const result = await pageResult<WarmUpResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			expect(result.tier).toBe(tier);
			// WebGPU also builds the culling pass's compute pipeline.
			const culling = tier === 'webgl2' ? 0 : 1;
			expect(result.firstFramePipelines).toBe(SCENE_PIPELINES + culling);
			expect(result.warmUpMs).toBeGreaterThanOrEqual(0);
			expect(result.playPipelines).toBe(0);
			// The added object's pipeline builds while it is hidden, and it shows once built.
			expect(result.addedPipelines).toBe(1);
			expect(result.afterPipelines).toBe(0);
			expect(result.magenta).toBeGreaterThan(100);
		});
	}
