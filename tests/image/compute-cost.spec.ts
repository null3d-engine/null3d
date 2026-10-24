// What the compute path costs, on each GPU path and render scale: the effect cost page's compute
// scene, whose vertex offset reads a texture that a pass writes in the same frame. The page times
// it with the pass off and on in turns, then reads the stats overlay for the memory of each side:
// the pass's target texture, the buffers and the engine's wasm.
// It runs only with NULL3D_COMPUTE_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_COMPUTE_COST=1 bun run test:browser -- compute-cost.spec.ts.
// Each test waits for a quiet computer, within a time limit, and prints the load beside its
// figures (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	memoryLine,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const scale of [1, 0.5])
		test(`the compute path on ${gpu} at scale ${scale}, timed on and off`, async ({ page }) => {
			test.skip(
				!process.env.NULL3D_COMPUTE_COST,
				'set NULL3D_COMPUTE_COST to time the compute path',
			);
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`effect-cost.html?effect=compute&gpu=${gpu}&scale=${scale}&fixed`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`COMPUTECOST ${result.tier} at scale ${scale}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					memoryLine('off', result.memory?.off),
					sideLine('on', result.on, 3),
					memoryLine('on', result.memory?.on),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
			expect(result.memory?.on?.ready, 'the overlay showed the figures with the pass on').toBe(
				true,
			);
			expect(
				result.memory?.on?.gpuTextureBytes,
				'the overlay showed the GPU textures',
			).not.toBeNull();
		});
