// Raycasts and overlap queries in a live engine. The raycast page builds one scene in null3D and in
// three.js and casts the same seeded rays through both: every raycast must give three.js's
// Raycaster's hits, on both GPU paths, whose meshes the engine stores differently, and in every
// thread mode. A batch of 10,000 rays must give each ray's own raycast, and its work must reach
// the job workers where the mode has them.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import type { RaycastResults } from '../pages/lib/raycast.ts';

interface RaycastPage {
	ok: boolean;
	error?: string;
	mode: { build: string; jobWorkers: number };
	results: RaycastResults;
	failures: string[];
	frames: number;
	jobBusyMs: number[];
}

/** Opens the raycast page with `switches` and returns its result, which must have no error. */
async function open(page: Page, switches: string): Promise<RaycastPage> {
	await page.goto(`raycast.html?${switches}`);
	const result = await pageResult<RaycastPage>(page, 90_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	return result;
}

/** Checks the page's results: no mismatch with three.js, and enough hits to mean something. */
function expectParity({ results }: RaycastPage, where: string): void {
	expect([where, results.mismatches, results.examples]).toEqual([where, 0, []]);
	expect(results.rays).toBe(600);
	expect(results.closestHits).toBeGreaterThan(250);
	expect(results.allHits).toBeGreaterThan(results.closestHits);
	expect([where, results.overlapMisses]).toEqual([where, 0]);
	expect(results.overlapChecks).toBe(results.closestHits);
	expect([where, results.batchMismatches]).toEqual([where, 0]);
	expect(results.batchHits).toBeGreaterThan(3_000);
}

const switchesOf = (mode: EngineMode, tier: string) =>
	[`gpu=${tier}`, mode.query].filter(Boolean).join('&');

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`raycasts give three.js's hits, and batches run on the job workers, on ${tier}`, async ({
		page,
	}) => {
		const mode = ENGINE_MODES[0];
		const result = await open(page, switchesOf(mode, tier));
		expectParity(result, tier);
		expect(result.mode.jobWorkers).toBeGreaterThan(0);
		expect(result.jobBusyMs).toHaveLength(result.mode.jobWorkers);
		// Each frame of the measurement cast 10,000 rays, which kept the job workers busy.
		expect(result.jobBusyMs.every((ms) => ms > 0)).toBe(true);
	});

for (const mode of ENGINE_MODES.slice(1))
	test(`raycasts give three.js's hits in ${mode.name} mode`, async ({ page }) => {
		const result = await open(page, switchesOf(mode, 'webgl2'));
		expectParity(result, mode.name);
	});
