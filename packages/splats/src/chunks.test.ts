// The cut of a cloud into chunks: nearby splats together, the most important first, and each chunk's
// bounds. The test makes two groups of splats far apart, and cuts each group into a chunk.
import { describe, expect, it } from 'bun:test';
import { chunkSplats } from './chunks';
import type { SplatData } from './format';

/** A cloud of two groups of four splats, 100 m apart, with the first splat of each the largest. */
function cloud(): SplatData {
	const positions = new Float32Array(8 * 3);
	for (let i = 4; i < 8; i++) positions[i * 3] = 100;
	const scales = new Float32Array([
		3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1,
	]);
	const rotations = new Float32Array(8 * 4);
	const colors = new Float32Array(8 * 4);
	for (let i = 0; i < 8; i++) {
		rotations[i * 4 + 3] = 1;
		colors.set([1, 1, 1, 1], i * 4);
	}
	return { count: 8, positions, scales, rotations, colors };
}

describe('chunkSplats', () => {
	it('puts nearby splats in one chunk, with the important ones first', async () => {
		const { chunks, total } = await chunkSplats(cloud(), { splatsPerChunk: 2 });
		expect(total).toBe(8);
		expect(chunks.length).toBe(2);
		for (const chunk of chunks) {
			expect(chunk.count).toBe(4);
			// The largest splat of each group comes first, because a coarser level keeps it.
			expect(chunk.scales[0]).toBe(chunk.center[0] < 50 ? 3 : 2);
		}
		// Each group's splats share a place, so its chunk's bounds are that point.
		expect([...(chunks[0]?.center ?? [])]).toEqual([0, 0, 0]);
		expect(chunks[0]?.radius).toBe(0);
	});

	it('sees each chunk as it is ready, and hands the thread back between them', async () => {
		const seen: number[] = [];
		let yields = 0;
		const { chunks } = await chunkSplats(cloud(), {
			splatsPerChunk: 2,
			onChunk: (chunk) => seen.push(chunk.count),
			yieldTo: async () => {
				yields++;
			},
		});
		expect(seen).toEqual(chunks.map((chunk) => chunk.count));
		expect(yields).toBe(chunks.length);
	});

	it('makes no chunk of an empty cloud', async () => {
		const empty = {
			count: 0,
			positions: new Float32Array(0),
			scales: new Float32Array(0),
			rotations: new Float32Array(0),
			colors: new Float32Array(0),
		};
		expect(await chunkSplats(empty)).toEqual({ chunks: [], total: 0 });
	});
});
