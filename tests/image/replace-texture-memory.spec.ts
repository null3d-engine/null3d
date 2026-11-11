// Replaces a live data texture's texels with another shape 40 times on each GPU path, and requires
// the engine's WebAssembly memory and the GPU bytes of its textures to stay flat. Each move leaves
// a GPU texture, which the backend frees once the work that named it completes; a texture that the
// backend kept would show as growth. The two shapes hold the same number of texels, so the sketch's
// own texture bytes cannot grow between them.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Checkpoint {
	round: number;
	meshBytes: number;
	textureBytes: number;
	wasmBytes: number | null;
	gpuTextureBytes: number | null;
}

interface MemoryResult {
	error?: string;
	done: { moved?: number; rounds?: number; error?: string };
	checkpoints: Checkpoint[];
	failures: string[];
}

/** Rounds in all, as the sketch makes them. */
const ROUNDS = 40;
/**
 * The rounds in which the engine's start-up may still move the heap. The GPU's own arrays and
 * targets arrive over the first frames, so a slow machine settles later.
 */
const WARM_ROUNDS = 12;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`replacing a live texture 40 times keeps the memory flat, on ${gpu}`, async ({ page }) => {
		test.setTimeout(300_000);
		await page.goto(`replace-texture-memory.html?gpu=${gpu}`);
		const result = await pageResult<MemoryResult>(page, 240_000);
		expect(result.error).toBeUndefined();
		expect(result.done.error).toBeUndefined();
		expect(result.done.moved).toBe(ROUNDS);
		expect(result.failures).toEqual([]);
		const points = result.checkpoints;
		expect(points.at(-1)?.round).toBe(ROUNDS);
		// The GPU figures come from the stats overlay; a page that read none proves nothing.
		expect(points.every((point) => point.wasmBytes !== null)).toBe(true);
		expect(points.every((point) => point.gpuTextureBytes !== null)).toBe(true);
		const last = points.at(-1) as Checkpoint;
		// The first round whose heap figure is the last one: from there the engine held one figure.
		const settled = points.findIndex((point) => point.wasmBytes === last.wasmBytes);
		expect(settled).toBeGreaterThanOrEqual(0);
		expect(settled).toBeLessThanOrEqual(WARM_ROUNDS);
		const steady = points.slice(Math.max(settled, WARM_ROUNDS));
		expect(steady.length).toBeGreaterThan(10);
		expect(new Set(steady.map((point) => point.wasmBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.meshBytes)).size).toBe(1);
		expect(new Set(steady.map((point) => point.textureBytes)).size).toBe(1);
		// The GPU bytes hold the two shapes' arrays, and no texture that a move retired. The first
		// rounds of the steady run hold both shapes, so their largest figure bounds every later one.
		const gpuBytes = steady.map((point) => point.gpuTextureBytes as number);
		const bound = Math.max(...gpuBytes.slice(0, 4));
		expect(bound).toBeGreaterThan(0);
		expect(Math.max(...gpuBytes)).toBeLessThanOrEqual(bound);
		console.log(
			`rounds ${settled} to ${ROUNDS} on ${gpu}: wasm ${last.wasmBytes} bytes, ` +
				`meshes ${last.meshBytes}, textures ${last.textureBytes}, GPU textures ${bound}`,
		);
	});
