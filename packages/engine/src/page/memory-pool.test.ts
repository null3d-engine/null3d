import { afterEach, describe, expect, it } from 'bun:test';
import { keepMemory, keptMemories, POOL_SIZE, releaseMemories, takeMemory } from './memory-pool';

const CORE = 'https://example.com/null3d_bg.wasm';
const key = { core: CORE, maximum: 64 };
const memory = (initial = 2) => new WebAssembly.Memory({ initial, maximum: 64, shared: true });

afterEach(releaseMemories);

describe('the memory pool', () => {
	it('gives a kept memory to the next engine with the same core and maximum, once', () => {
		const kept = memory();
		keepMemory(kept, key);
		expect(takeMemory({ core: CORE, maximum: 32 }, 1)).toBeUndefined();
		expect(takeMemory({ core: `${CORE}?v=2`, maximum: 64 }, 1)).toBeUndefined();
		expect(takeMemory(key, 1)).toBe(kept);
		expect(takeMemory(key, 1)).toBeUndefined();
	});

	it("clears the memory's first pages, where the core keeps its data, and leaves the rest", () => {
		const kept = memory(3);
		const bytes = new Uint8Array(kept.buffer);
		bytes.fill(7);
		keepMemory(kept, key);
		expect(takeMemory(key, 2)).toBe(kept);
		expect(bytes.subarray(0, 2 * 65_536).every((byte) => byte === 0)).toBe(true);
		expect(bytes[2 * 65_536]).toBe(7);
	});

	it('takes no memory smaller than the core needs at its start', () => {
		keepMemory(memory(1), key);
		expect(takeMemory(key, 2)).toBeUndefined();
	});

	it('keeps at most its size, dropping the oldest first', () => {
		const memories = Array.from({ length: POOL_SIZE + 1 }, () => memory());
		for (const kept of memories) keepMemory(kept, key);
		expect(keptMemories()).toBe(POOL_SIZE);
		expect(takeMemory(key, 1)).toBe(memories[1]);
	});

	it('keeps a memory only once', () => {
		const kept = memory();
		keepMemory(kept, key);
		keepMemory(kept, key);
		expect(keptMemories()).toBe(1);
	});

	it('lets a memory go when its time ends, or when the page releases the pool', async () => {
		keepMemory(memory(), key, 5);
		keepMemory(memory(), { core: CORE, maximum: 32 });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(keptMemories()).toBe(1);
		releaseMemories();
		expect(keptMemories()).toBe(0);
	});
});
