import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { GpuErrorWatch } from './loss';

/** Stand-ins for the browser's error classes, which Bun lacks. */
class FakeGpuError {
	constructor(readonly message: string) {}
}
class FakeOutOfMemoryError extends FakeGpuError {}

const scope = globalThis as { GPUOutOfMemoryError?: unknown };
beforeAll(() => {
	scope.GPUOutOfMemoryError = FakeOutOfMemoryError;
});
afterAll(() => {
	delete scope.GPUOutOfMemoryError;
});

/** A device whose uncaptured errors the test fires. */
function fakeDevice() {
	const device = {
		onuncapturederror: null as ((event: { error: FakeGpuError }) => void) | null,
		fire(error: FakeGpuError) {
			device.onuncapturederror?.({ error });
		},
	};
	return device;
}

describe('GpuErrorWatch', () => {
	it('reports the first error of each kind once, and counts the rest', () => {
		const device = fakeDevice();
		const reports: [boolean, string][] = [];
		const watch = new GpuErrorWatch(device as unknown as GPUDevice, (outOfMemory, message) =>
			reports.push([outOfMemory, message]),
		);
		const warn = console.warn;
		const warnings: unknown[] = [];
		console.warn = (...args: unknown[]) => warnings.push(args);
		try {
			device.fire(new FakeGpuError('Buffer size exceeds the max buffer size limit.'));
			device.fire(new FakeGpuError('Invalid BindGroup.'));
			device.fire(new FakeOutOfMemoryError('Not enough memory left.'));
			device.fire(new FakeOutOfMemoryError('Not enough memory left.'));
			device.fire(new FakeGpuError('Invalid CommandBuffer.'));
		} finally {
			console.warn = warn;
		}
		expect(reports).toEqual([
			[false, 'Buffer size exceeds the max buffer size limit.'],
			[true, 'Not enough memory left.'],
		]);
		expect(watch.repeated).toBe(3);
		// Tests run as a development build, which says once that more errors came.
		expect(warnings).toHaveLength(1);
	});

	it('counts every error as rejected work where the browser lacks the out-of-memory class', () => {
		delete scope.GPUOutOfMemoryError;
		try {
			const device = fakeDevice();
			const reports: boolean[] = [];
			new GpuErrorWatch(device as unknown as GPUDevice, (outOfMemory) => reports.push(outOfMemory));
			device.fire(new FakeOutOfMemoryError('Not enough memory left.'));
			expect(reports).toEqual([false]);
		} finally {
			scope.GPUOutOfMemoryError = FakeOutOfMemoryError;
		}
	});
});
