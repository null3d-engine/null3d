// Loads and destroys models 100 times on each GPU path: a skinned and animated fox with a
// texture, a face with morph targets, and a scene with stored raycast trees, with copies, an
// instance batch and raycasts each round. From the tenth round to the last, the engine's
// WebAssembly memory and the GPU memory of meshes and textures stay the same.
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

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`loading and destroying models 100 times keeps the memory flat, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		await page.goto(`destroy-memory.html?gpu=${gpu}`);
		const result = await pageResult<MemoryResult>(page, 220_000);
		expect(result.error).toBeUndefined();
		expect(result.done.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		// Every round's rays met the models, so each round built the meshes' trees.
		expect(result.done.hits).toBeGreaterThan(100);
		const [warm, last] = result.checkpoints;
		expect(warm?.round).toBe(10);
		expect(last?.round).toBe(100);
		expect(warm?.meshBytes).toBeGreaterThan(0);
		expect(warm?.textureBytes).toBeGreaterThan(0);
		expect(warm?.wasmBytes).toBeGreaterThan(0);
		expect(last?.meshBytes).toBe(warm?.meshBytes);
		expect(last?.textureBytes).toBe(warm?.textureBytes);
		expect(last?.wasmBytes).toBe(warm?.wasmBytes);
	});
