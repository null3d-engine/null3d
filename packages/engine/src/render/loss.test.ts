import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { GpuErrorWatch, GpuReports } from './loss';

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
		const reports: [string, string][] = [];
		const watch = new GpuErrorWatch(device as unknown as GPUDevice, (kind, message) =>
			reports.push([kind, message]),
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
			['rejected', 'Buffer size exceeds the max buffer size limit.'],
			['memory', 'Not enough memory left.'],
		]);
		expect(watch.repeated).toBe(3);
		// Tests run as a development build, which says once that more errors came.
		expect(warnings).toHaveLength(1);
	});

	it('counts every error as rejected work where the browser lacks the out-of-memory class', () => {
		delete scope.GPUOutOfMemoryError;
		try {
			const device = fakeDevice();
			const reports: string[] = [];
			new GpuErrorWatch(device as unknown as GPUDevice, (kind) => reports.push(kind));
			device.fire(new FakeOutOfMemoryError('Not enough memory left.'));
			expect(reports).toEqual(['rejected']);
		} finally {
			scope.GPUOutOfMemoryError = FakeOutOfMemoryError;
		}
	});
});

describe('GpuReports', () => {
	it("reports a pipeline that the driver refused apart from the device's errors", () => {
		const reports: [string, string][] = [];
		const gpu = new GpuReports((kind, message) => reports.push([kind, message]));
		const warn = console.warn;
		console.warn = () => {};
		try {
			gpu.hear('rejected', 'Invalid BindGroup.');
			gpu.hear('pipeline', 'mesh lit: CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN');
			gpu.hear('pipeline', 'custom material 135: CreateGraphicsPipelines failed');
		} finally {
			console.warn = warn;
		}
		expect(reports).toEqual([
			['rejected', 'Invalid BindGroup.'],
			['pipeline', 'mesh lit: CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN'],
		]);
		expect(gpu.repeated).toBe(1);
	});
});
