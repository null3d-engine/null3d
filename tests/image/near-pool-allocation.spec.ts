// The vegetation near pool's per-frame call, in a live engine: a page calls `update` once a frame,
// and while the camera stands the call reads the camera and returns. Rule 1 allows no allocation in
// a TypeScript hot path. The page's loop runs while the engine is paused, and Chrome's heap profiler
// samples it (tests/lib/allocations.ts).
import { expect, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the near pool's per-frame call allocates nothing on ${tier}`, ALONE, async ({ page }) => {
		test.setTimeout(600_000);
		await page.goto(`near-pool-loop.html?threads=off&gpu=${tier}`);
		const result = await pageResult<{ mode?: string; loop?: string }>(page, 400_000);
		expect(result.loop).toBe('function');
		const runLoop = (iterations: number, runs: number) =>
			page.evaluate(
				({ iterations, runs }) => {
					const loop = (globalThis as { __null3dNearPoolLoop?: (iterations: number) => void })
						.__null3dNearPoolLoop;
					for (let run = 0; run < runs; run++) loop?.(iterations);
				},
				{ iterations, runs },
			);
		const plan = {
			warmUpRuns: 40,
			warmUpIterations: 200,
			sampledIterations: 10_000,
			// The pool's own call, and the engine's camera read that it makes.
			counted: /\/packages\/(vegetation\/src\/render\/near-pool\.ts|engine\/src\/scene\/scene\.ts)/,
			pauseEngine: true,
		};
		expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
	});
