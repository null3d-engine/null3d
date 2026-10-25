// A draw whose count the GPU writes, in a live engine: the loop writes the per-instance rows and the
// count every iteration, as a page that moves a field of instances does each frame. Rule 1 allows
// no allocation in a TypeScript hot path, and the WebGL2 path splits each row's matrix into the
// instance batch's arrays there. The page's loop runs while the engine is paused, and Chrome's heap
// profiler samples it (tests/lib/allocations.ts).
import { expect, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

for (const tier of ['webgpu', 'webgl2'] as const)
	test(
		`the instance draw's row and count writes allocate nothing on ${tier}`,
		ALONE,
		async ({ page }) => {
			await page.goto(`feature-instances-loop.html?threads=off&gpu=${tier}`);
			const result = await pageResult<{ mode?: string; loop?: string }>(page, 120_000);
			expect(result.loop).toBe('function');
			const runLoop = (iterations: number, runs: number) =>
				page.evaluate(
					({ iterations, runs }) => {
						const loop = (
							globalThis as { __null3dFeatureInstancesLoop?: (iterations: number) => void }
						).__null3dFeatureInstancesLoop;
						for (let run = 0; run < runs; run++) loop?.(iterations);
					},
					{ iterations, runs },
				);
			const plan = {
				warmUpRuns: 40,
				warmUpIterations: 200,
				sampledIterations: 10_000,
				// The adapter's row and count writes, and the core's generated glue.
				counted: /\/packages\/engine\/(src\/scene\/feature-instances\.ts|dist\/wasm\/)/,
				pauseEngine: true,
			};
			expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
		},
	);
