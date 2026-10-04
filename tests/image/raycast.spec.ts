// Raycasts and overlap queries in a live engine. The raycast page builds one scene in null3D and in
// three.js and casts the same seeded rays through both: every raycast must give three.js's
// Raycaster's hits, on both GPU paths, whose meshes the engine stores differently, and in every
// thread mode. A batch of 10,000 rays must give each ray's own raycast, and its work must reach
// the job workers where the mode has them. And a loop of every query allocates nothing.
import { expect, type Page, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
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
	// Hit points go to the screen and back as rays that pass within a tenth of a millimeter.
	expect(results.projections).toBeGreaterThan(100);
	expect(results.projectionError, where).toBeLessThan(1e-4);
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

// The scene at the Earth's radius, off any cell's center. In large-world mode the engine finds
// three.js's hits, which three.js computes in 64-bit numbers, and screen points come back to their
// hits. Without the mode, root positions round to 32 bits, half a meter there, and hits differ.
for (const tier of ['webgpu', 'webgl2'] as const)
	test(`raycasts and screen points at the Earth's radius match three.js in large-world mode, on ${tier}`, async ({
		page,
	}) => {
		expectParity(await open(page, `gpu=${tier}&far&largeWorld`), tier);
	});

test("without large-world mode, raycasts at the Earth's radius miss three.js's hits", async ({
	page,
}) => {
	const { results } = await open(page, 'gpu=webgl2&far');
	expect(results.mismatches).toBeGreaterThan(50);
});

for (const mode of ENGINE_MODES.slice(1))
	test(`raycasts give three.js's hits in ${mode.name} mode`, async ({ page }) => {
		const result = await open(page, switchesOf(mode, 'webgl2'));
		expectParity(result, mode.name);
	});

test('every query allocates nothing, with hits in each call', async ({ page }) => {
	await page.goto('query-loop.html?threads=off');
	const result = await pageResult<{ ok: boolean; error?: string; loop: string }>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(result.loop).toBe('function');
	// Every call of a whole sweep of the loop finds something, so the hits' paths run too.
	const misses = await page.evaluate(() =>
		(globalThis as { __null3dQueryLoop?: (iterations: number) => number }).__null3dQueryLoop?.(
			1_400,
		),
	);
	expect(misses).toBe(0);
	const runLoop = (iterations: number, runs: number) =>
		page.evaluate(
			({ iterations, runs }) => {
				const loop = (globalThis as { __null3dQueryLoop?: (iterations: number) => number })
					.__null3dQueryLoop;
				for (let run = 0; run < runs; run++) loop?.(iterations);
			},
			{ iterations, runs },
		);
	const plan = {
		warmUpRuns: 40,
		warmUpIterations: 500,
		sampledIterations: 20_000,
		// The query calls, the scene that passes them on, the engine memory's views, the math
		// helpers that the loop calls, and the core's generated glue. The engine's own frames run
		// on this thread between the loop's runs, and the frame checks that development builds add
		// are not the queries' work.
		counted: /\/packages\/engine\/(src\/(scene\/(queries|scene|memory)\.ts|math\/)|dist\/wasm\/)/,
	};
	expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
});
