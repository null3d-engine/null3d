// Vertex updates in a live engine. A ray must hit a mesh where its last update put its vertices,
// and a loop of updates of every kind must allocate nothing.
import { expect, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

test('vertex updates allocate nothing, and rays hit the updated mesh', ALONE, async ({ page }) => {
	await page.goto('vertex-loop.html?threads=off');
	const result = await pageResult<{ error?: string; loop: string; hits: number[] }>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(result.loop).toBe('function');
	// The ray hits the flat grid, then the grid one unit higher.
	expect(result.hits).toEqual([0, 1]);
	const runLoop = (iterations: number, runs: number) =>
		page.evaluate(
			({ iterations, runs }) => {
				const loop = (globalThis as { __null3dVertexLoop?: (iterations: number) => void })
					.__null3dVertexLoop;
				for (let run = 0; run < runs; run++) loop?.(iterations);
			},
			{ iterations, runs },
		);
	const plan = {
		warmUpRuns: 40,
		warmUpIterations: 200,
		sampledIterations: 5_000,
		// The mesh's update, the checks and copies of its arrays, the engine memory's views, and the
		// core's generated glue.
		counted: /\/packages\/engine\/(src\/scene\/(resources|mesh-arrays|memory)\.ts|dist\/wasm\/)/,
		pauseEngine: true,
	};
	expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
});
