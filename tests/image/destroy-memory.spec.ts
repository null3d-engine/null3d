// Loads and destroys models 400 times on each GPU path: a skinned and animated fox with a
// texture, a face with morph targets, and a scene with stored raycast trees, with copies, an
// instance batch and raycasts each round. The engine's start-up takes longer than a few rounds on
// a slow machine, and the heap never gives a page back, so the test finds the round from which the
// WebAssembly memory holds one figure — within a bounded warm-up — and requires it and the GPU
// memory of meshes and textures to stay there to the last round.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Checkpoint {
	round: number;
	meshBytes: number;
	textureBytes: number;
	wasmBytes: number | null;
}

interface MemoryResult {
	error?: string;
	done: { hits?: number; error?: string };
	checkpoints: Checkpoint[];
	failures: string[];
}

/** The rounds that the page draws. */
const ROUNDS = 400;

/**
 * The most pages that the heap may add over the run, per hundred rounds. The heap does not grow
 * every round: it steps up two pages, 131,072 bytes, when an allocation's temporary peak passes the
 * pages it holds, and then holds that figure for dozens of rounds. WebGL2's 400 rounds stepped five
 * times, 10 pages, and WebGPU's twice, four pages, with the mesh and texture sets flat on both. A
 * page-a-round leak would add 400. So this bound sits well above the steps and far below a leak, and
 * the settle is kept in the result as context, not as the verdict: it names the round of the last
 * step, which is the allocator's clock. Drawn at the landed head, one run passed both paths where
 * CI's run failed WebGPU at round 395, which is the same code and the same head.
 */
const GROWTH_PAGES_PER_100_ROUNDS = 4;

/** The bytes of one page of the engine's WebAssembly memory. */
const PAGE_BYTES = 65_536;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`loading and destroying models 400 times keeps the memory flat, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(690_000);
		await page.goto(`destroy-memory.html?gpu=${gpu}`);
		// 400 rounds cost 229 seconds for both paths here, where 240 rounds took 216 to 330 on CI's
		// software GPU before; the wait still allows a run twice as slow as the first of those, and
		// the test's limit clears the wait.
		const result = await pageResult<MemoryResult>(page, 660_000);
		expect(result.error).toBeUndefined();
		expect(result.done.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		// Every round's rays met the models, so each round built the meshes' trees.
		expect(result.done.hits).toBeGreaterThan(100);
		const checkpoints = result.checkpoints;
		const last = checkpoints.at(-1);
		expect(last?.round).toBe(ROUNDS);
		// The first round whose heap figure is the last one: from there the engine held one figure.
		const settled = checkpoints.findIndex((point) => point.wasmBytes === last?.wasmBytes);
		expect(settled).toBeGreaterThanOrEqual(0);
		const warm = checkpoints[settled] as Checkpoint;
		// The settle names the round of the last step, kept as the allocator's clock beside the growth.
		const added =
			((last?.wasmBytes ?? 0) - ((checkpoints[0] as Checkpoint).wasmBytes ?? 0)) / PAGE_BYTES;
		console.log(
			`${gpu}: the heap settled at round ${warm.round} and added ${added} pages over ${ROUNDS} rounds`,
		);
		// The heap's steps are the allocator's, two pages at a time; only a growth at a leak's rate
		// fails. The settle above the first figure stays in the log as the allocator's clock.
		expect(
			(last?.wasmBytes ?? 0) - ((checkpoints[0] as Checkpoint).wasmBytes ?? 0),
		).toBeLessThanOrEqual(GROWTH_PAGES_PER_100_ROUNDS * (ROUNDS / 100) * PAGE_BYTES);
		expect(warm.meshBytes).toBeGreaterThan(0);
		expect(warm.textureBytes).toBeGreaterThan(0);
		expect(warm.wasmBytes).toBeGreaterThan(0);
		const steady = checkpoints.slice(settled);
		expect(new Set(steady.map((point) => point.wasmBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.meshBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.textureBytes)).size).toBe(1);
	});
