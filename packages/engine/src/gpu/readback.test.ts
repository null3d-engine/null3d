import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { captureWebGPU, readbackWebGPU } from './readback';

const scope = globalThis as {
	GPUBufferUsage?: unknown;
	GPUMapMode?: unknown;
	GPUTextureUsage?: unknown;
};
beforeAll(() => {
	scope.GPUBufferUsage = { MAP_READ: 1, COPY_DST: 8 };
	scope.GPUMapMode = { READ: 1 };
	scope.GPUTextureUsage = { COPY_SRC: 1, RENDER_ATTACHMENT: 16 };
});
afterAll(() => {
	delete scope.GPUBufferUsage;
	delete scope.GPUMapMode;
	delete scope.GPUTextureUsage;
});

interface FakeOptions {
	/** The out-of-memory error that the scope reports, if any. */
	outOfMemory?: string;
	/** The device's loss, if the device is lost. */
	lost?: GPUDeviceLostInfo;
	/** True when the map succeeds. */
	maps?: boolean;
}

/** A device whose 2 x 1 texture holds two pixels, and whose map succeeds or fails as asked. */
function fakeDevice({ outOfMemory, lost, maps = false }: FakeOptions) {
	const scopes: string[] = [];
	const log: string[] = [];
	const row = new Uint8Array(256);
	row.set([1, 2, 3, 4, 5, 6, 7, 8]);
	const device = {
		pushErrorScope: (filter: string) => scopes.push(filter),
		popErrorScope: () => {
			scopes.pop();
			return Promise.resolve(outOfMemory ? ({ message: outOfMemory } as GPUError) : null);
		},
		createTexture: () => {
			log.push(`texture in ${scopes.join(',')}`);
			return {
				width: 2,
				height: 1,
				format: 'rgba8unorm',
				destroy: () => log.push('texture destroyed'),
			};
		},
		createBuffer: () => {
			log.push(`buffer in ${scopes.join(',')}`);
			return {
				mapAsync: () =>
					maps ? Promise.resolve() : Promise.reject(new Error('map async was not successful')),
				getMappedRange: () => row.buffer,
				unmap: () => {},
				destroy: () => log.push('buffer destroyed'),
			};
		},
		createCommandEncoder: () => ({ copyTextureToBuffer: () => {}, finish: () => ({}) }),
		queue: { submit: () => log.push('submitted') },
		lost: lost ? Promise.resolve(lost) : new Promise(() => {}),
	} as unknown as GPUDevice;
	return { device, scopes, log };
}

describe('a WebGPU readback', () => {
	it('reads the pixels, and leaves no error scope open', async () => {
		const { device, scopes, log } = fakeDevice({ maps: true });
		const pixels = await captureWebGPU(device, 2, 1, 'rgba8unorm', () => log.push('drawn'));
		expect([...pixels]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(scopes).toEqual([]);
		expect(log).toEqual([
			'texture in out-of-memory',
			'drawn',
			'buffer in out-of-memory',
			'submitted',
			'buffer destroyed',
			'texture destroyed',
		]);
	});

	it('names an allocation that ran out of memory as the cause of a failed map', async () => {
		const { device, log } = fakeDevice({ outOfMemory: 'not enough memory for the texture' });
		await expect(captureWebGPU(device, 2, 1, 'rgba8unorm', () => {})).rejects.toThrow(
			'the GPU ran out of memory for the readback: not enough memory for the texture',
		);
		expect(log).toContain('buffer destroyed');
		expect(log).toContain('texture destroyed');
	});

	it('names the loss of the device, with its reason', async () => {
		const lost = { reason: 'unknown', message: 'the GPU process stopped' } as GPUDeviceLostInfo;
		const { device } = fakeDevice({ lost });
		const texture = device.createTexture({} as GPUTextureDescriptor);
		await expect(readbackWebGPU(device, texture)).rejects.toThrow(
			'the GPU device was lost during the readback (unknown: the GPU process stopped)',
		);
	});

	it("gives the map's own error when WebGPU names no cause", async () => {
		const { device } = fakeDevice({});
		const texture = device.createTexture({} as GPUTextureDescriptor);
		await expect(readbackWebGPU(device, texture)).rejects.toThrow(
			'the readback failed: map async was not successful',
		);
	});

	it('closes its error scope when the drawing throws', async () => {
		const { device, scopes, log } = fakeDevice({ maps: true });
		const failing = captureWebGPU(device, 2, 1, 'rgba8unorm', () => {
			throw new Error('the replay failed');
		});
		await expect(failing).rejects.toThrow('the replay failed');
		expect(scopes).toEqual([]);
		expect(log).toContain('texture destroyed');
	});
});
