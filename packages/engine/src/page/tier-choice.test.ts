import { describe, expect, it } from 'bun:test';
import type { WorkerProbe } from '../workers/probe-worker';
import type { CapabilityReport, WorkerProbeFailure } from './capabilities';
import { chooseTier } from './engine';

/** A report of a browser with WebGL2 and no WebGPU, whose probe worker answered `worker`. */
function reportWith(worker: WorkerProbe | WorkerProbeFailure): CapabilityReport {
	return {
		webgpu: { compatibilityAdapter: false, coreFeaturesAndLimits: false },
		webgl2: { available: true },
		worker,
	} as unknown as CapabilityReport;
}

describe('the GPU path for a worker that draws', () => {
	it("keeps the worker's WebGL2 when its WebGPU check threw", () => {
		const report = reportWith({
			requestAnimationFrame: true,
			offscreenWebGL2: true,
			offscreenWebGPU: false,
			webgpuError: 'requestDevice() failed',
		});
		expect(chooseTier(report, 'webgl2', true)).toEqual({ tier: 'webgl2', forceCompat: false });
		expect(chooseTier(report, 'auto', true)).toEqual({ tier: 'webgl2', forceCompat: false });
	});

	it('finds no path in a worker when the probe worker gave no answer, and the page still draws', () => {
		const report = reportWith({ failure: 'no-answer', error: 'no probe worker answered' });
		expect(chooseTier(report, 'webgl2', true)).toBeNull();
		expect(chooseTier(report, 'webgl2', false)).toEqual({ tier: 'webgl2', forceCompat: false });
	});
});
