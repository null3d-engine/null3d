// Loads and destroys models 140 times on each GPU path: a skinned and animated fox with a
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

/** The rounds in which the engine's start-up may still move the heap. */
const WARM_ROUNDS = 80;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`loading and destroying models 140 times keeps the memory flat, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(360_000);
		await page.goto(`destroy-memory.html?gpu=${gpu}`);
		const result = await pageResult<MemoryResult>(page, 330_000);
		expect(result.error).toBeUndefined();
		expect(result.done.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		// Every round's rays met the models, so each round built the meshes' trees.
		expect(result.done.hits).toBeGreaterThan(100);
		const checkpoints = result.checkpoints;
		const last = checkpoints.at(-1);
		expect(last?.round).toBe(140);
		// The first round whose heap figure is the last one: from there the engine held one figure.
		const settled = checkpoints.findIndex((point) => point.wasmBytes === last?.wasmBytes);
		expect(settled).toBeGreaterThanOrEqual(0);
		const warm = checkpoints[settled] as Checkpoint;
		// The engine reached that figure inside the warm-up, so the rounds after it test the churn.
		expect(warm.round).toBeLessThanOrEqual(WARM_ROUNDS);
		expect(warm.meshBytes).toBeGreaterThan(0);
		expect(warm.textureBytes).toBeGreaterThan(0);
		expect(warm.wasmBytes).toBeGreaterThan(0);
		const steady = checkpoints.slice(settled);
		expect(new Set(steady.map((point) => point.wasmBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.meshBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.textureBytes)).size).toBe(1);
	});
