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
 * The rounds of churn that must follow the heap's settle. A slower runner's start-up arrives over
 * more rounds: the settlements read 131, 158, 185, 192, 202, 257 and 267 as the runners slowed, and
 * each time the heap held one figure to the end afterwards. A fixed bound on the settle chased that
 * climb four times and would not converge, so the rule is the churn instead: a settle at least 60
 * rounds before the end shows the memory held across the churn, whatever the runner's speed. A leak
 * never repeats the last round's figure early, so it settles at the end and fails this rule.
 */
const CHURN_ROUNDS = 60;

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
		// The engine's start-up reached that figure early enough that the churn tests it afterwards.
		expect(warm.round).toBeLessThanOrEqual(ROUNDS - CHURN_ROUNDS);
		expect(warm.meshBytes).toBeGreaterThan(0);
		expect(warm.textureBytes).toBeGreaterThan(0);
		expect(warm.wasmBytes).toBeGreaterThan(0);
		const steady = checkpoints.slice(settled);
		expect(new Set(steady.map((point) => point.wasmBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.meshBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.textureBytes)).size).toBe(1);
	});
