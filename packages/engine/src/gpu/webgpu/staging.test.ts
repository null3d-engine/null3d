import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { MAX_CAPACITY, MIN_CAPACITY, StagingRing, WINDOW_FRAMES } from './staging';

const MIB = 1024 * 1024;

const scope = globalThis as { GPUBufferUsage?: unknown; GPUMapMode?: unknown };
beforeAll(() => {
	scope.GPUBufferUsage = { MAP_WRITE: 2, COPY_SRC: 4 };
	scope.GPUMapMode = { WRITE: 2 };
});
afterAll(() => {
	delete scope.GPUBufferUsage;
	delete scope.GPUMapMode;
});

/** A device whose buffers map at once, and which lists every buffer it made. */
function fakeDevice() {
	const buffers: { size: number; destroyed: boolean }[] = [];
	const device = {
		createBuffer({ size }: GPUBufferDescriptor) {
			const buffer = {
				size,
				destroyed: false,
				getMappedRange: () => new ArrayBuffer(size),
				unmap() {},
				mapAsync: () => Promise.resolve(),
				destroy() {
					buffer.destroyed = true;
				},
			};
			buffers.push(buffer);
			return buffer;
		},
	};
	return { device: device as unknown as GPUDevice, buffers };
}

const encoder = { copyBufferToBuffer() {} } as unknown as GPUCommandEncoder;
const target = {} as GPUBuffer;
const source = new ArrayBuffer(8 * MIB);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Stages writes of `sizes` in one frame, submits it, and waits until its buffer is mapped again. */
async function frame(ring: StagingRing, sizes: number[]): Promise<boolean[]> {
	const staged = sizes.map((size) => ring.write(target, 0, source, 0, size));
	ring.flush(encoder);
	ring.afterSubmit();
	ring.endFrame();
	await settle();
	return staged;
}

describe('StagingRing', () => {
	it('replaces a buffer far larger than recent frames need with a smaller one', async () => {
		const { device, buffers } = fakeDevice();
		const ring = new StagingRing(device);
		await frame(ring, [6 * MIB]);
		expect(ring.capacities()).toEqual([8 * MIB]);
		for (let f = 0; f < 2 * WINDOW_FRAMES; f++) await frame(ring, [4096]);
		expect(ring.capacities()).toEqual([MIN_CAPACITY]);
		expect(buffers.filter((buffer) => !buffer.destroyed).map((buffer) => buffer.size)).toEqual([
			MIN_CAPACITY,
		]);
	});

	it('keeps a buffer that recent frames still need', async () => {
		const { device } = fakeDevice();
		const ring = new StagingRing(device);
		await frame(ring, [6 * MIB]);
		for (let f = 0; f < WINDOW_FRAMES; f++) await frame(ring, [4096]);
		expect(ring.capacities()).toEqual([8 * MIB]);
	});

	it('grows no buffer past the largest capacity, and leaves the rest to the queue', async () => {
		const { device } = fakeDevice();
		const ring = new StagingRing(device);
		const staged: boolean[] = [];
		for (let f = 0; f < 6; f++) staged.push(...(await frame(ring, new Array(6).fill(4 * MIB))));
		expect(Math.max(...ring.capacities())).toBe(MAX_CAPACITY);
		expect(staged).toContain(false);
		expect(ring.write(target, 0, new ArrayBuffer(MAX_CAPACITY + 4), 0, MAX_CAPACITY + 4)).toBe(
			false,
		);
	});
});
