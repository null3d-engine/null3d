// A new render scale makes no GPU object: a sketch fixes a new render scale in each of several frames
// in a row, and the engine's frame figures count no GPU buffer, texture, sampler, bind group or
// pipeline made meanwhile. Each frame draws at the scale that the sketch fixed. A new canvas size,
// which makes new targets, shows that the count works. On every GPU tier, in every thread mode, and
// with bloom in the first mode: bloom's targets and settings follow the render scale too.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { SCALES } from '../pages/lib/render-scale.ts';

interface RenderScaleResult {
	error?: string;
	tier: string;
	steadyGpuObjects: number;
	scaledGpuObjects: number;
	scaledPipelines: number;
	resizedGpuObjects: number;
	scales: number[];
	failures: string[];
}

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

const RUNS = [
	...ENGINE_MODES.map((mode) => ({ name: mode.name, query: mode.query })),
	{ name: `${ENGINE_MODES[0].name} with bloom`, query: `${ENGINE_MODES[0].query}&bloom` },
];

for (const { tier, query } of TIERS)
	for (const run of RUNS)
		test(`a new render scale makes no GPU object on ${tier}, ${run.name}`, async ({ page }) => {
			await page.goto(`render-scale.html?${query}&${run.query}`);
			const result = await pageResult<RenderScaleResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(tier);
			expect(result.failures).toEqual([]);
			expect(result.steadyGpuObjects).toBe(0);
			expect(result.scaledGpuObjects).toBe(0);
			expect(result.scaledPipelines).toBe(0);
			expect(result.scales).toEqual(SCALES);
			expect(result.resizedGpuObjects).toBeGreaterThan(0);
		});
