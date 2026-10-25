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

/** A cloud of `side`³ splats on a lattice through a box of `size` metres each way, each splat
 * with a weight of its own. */
function lattice(side: number, size: number): SplatData {
	const count = side ** 3;
	const positions = new Float32Array(count * 3);
	const scales = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const colors = new Float32Array(count * 4);
	let i = 0;
	for (let z = 0; z < side; z++)
		for (let y = 0; y < side; y++)
			for (let x = 0; x < side; x++) {
				positions[i * 3] = ((x + 0.5) / side) * size;
				positions[i * 3 + 1] = ((y + 0.5) / side) * size;
				positions[i * 3 + 2] = ((z + 0.5) / side) * size;
				const scale = 1 + i * 1e-6;
				scales.set([scale, scale, scale], i * 3);
				rotations[i * 4 + 3] = 1;
				colors.set([1, 1, 1, 1], i * 4);
				i++;
			}
	return { count, positions, scales, rotations, colors };
}

/** The same splats, listed in the opposite order. */
function reversed(data: SplatData): SplatData {
	const { count } = data;
	const positions = new Float32Array(count * 3);
	const scales = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const colors = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		const from = count - 1 - i;
		positions.set(data.positions.subarray(from * 3, from * 3 + 3), i * 3);
		scales.set(data.scales.subarray(from * 3, from * 3 + 3), i * 3);
		rotations.set(data.rotations.subarray(from * 4, from * 4 + 4), i * 4);
		colors.set(data.colors.subarray(from * 4, from * 4 + 4), i * 4);
	}
	return { count, positions, scales, rotations, colors };
}

describe('chunkSplats', () => {
	it('cuts a cloud into chunks of about the target load', async () => {
		// Eight thousand splats at a target of one thousand: two cells on a side, eight chunks.
		const { chunks, total } = await chunkSplats(lattice(20, 100), { splatsPerChunk: 1_000 });
		expect(total).toBe(8_000);
		expect(chunks.length).toBe(8);
		for (const chunk of chunks) expect(chunk.count).toBe(1_000);
	});

	it('makes more, smaller chunks of a cloud with more splats', async () => {
		// The same cloud at a quarter of the target holds four times the cells on a side.
		const { chunks } = await chunkSplats(lattice(20, 100), { splatsPerChunk: 250 });
		expect(chunks.length).toBe(64);
		for (const chunk of chunks) expect(chunk.count).toBe(125);
	});

	it('cuts the same cloud the same way every time', async () => {
		const first = await chunkSplats(lattice(10, 50), { splatsPerChunk: 125 });
		const again = await chunkSplats(lattice(10, 50), { splatsPerChunk: 125 });
		expect(again.chunks.map((chunk) => [chunk.count, [...chunk.center]])).toEqual(
			first.chunks.map((chunk) => [chunk.count, [...chunk.center]]),
		);
	});

	it('puts a splat in the same chunk whatever order the cloud lists them', async () => {
		const options = { splatsPerChunk: 250 };
		const cut = await chunkSplats(lattice(20, 100), options);
		const other = await chunkSplats(reversed(lattice(20, 100)), options);
		expect(other.chunks.length).toBe(cut.chunks.length);
		cut.chunks.forEach((chunk, i) => {
			const beside = other.chunks[i] as (typeof other.chunks)[number];
			expect(beside.count).toBe(chunk.count);
			expect([...beside.center]).toEqual([...chunk.center]);
			expect([...beside.positions]).toEqual([...chunk.positions]);
		});
	});

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
