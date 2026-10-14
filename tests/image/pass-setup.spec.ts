// The WebGPU replay's render pass setup hands the browser clear colors that it reads without making
// number objects. The browser reads a dictionary's numbers through its bindings, which copy each
// fraction that an object holds unboxed into a new 12-byte number at every read. When the setup held
// its clear color that way, each render pass that drew color allocated 36 bytes there, and the
// replay went over its budget with ambient occlusion and in S4. A page sets a clearing pass and reads
// the setup's clear color in a loop, and Chrome's heap profiler samples long runs of it
// (tests/lib/allocations.ts).
import { expect, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

test('the render pass setup clear color reads without allocating', ALONE, async ({ page }) => {
	await page.goto('pass-setup.html');
	const result = await pageResult<{ clearsWhenLoading: boolean }>(page, 30_000);
	const runLoop = (iterations: number, runs: number) =>
		page.evaluate(
			({ iterations, runs }) => {
				const scope = globalThis as { __null3dPassSetupLoop?: (iterations: number) => void };
				for (let run = 0; run < runs; run++) scope.__null3dPassSetupLoop?.(iterations);
			},
			{ iterations, runs },
		);
	const plan = {
		warmUpRuns: 400,
		warmUpIterations: 2_500,
		sampledIterations: 200_000,
		// The setup and the page's loop, whose call of the browser counts the reading's objects.
		counted: /\/packages\/engine\/src\/gpu\/webgpu\/reusable\.ts|\/tests\/pages\/pass-setup\.ts/,
	};
	expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
	// A pass that loads its target gives no clear color, so the browser reads none.
	expect(result.clearsWhenLoading).toBe(false);
});
