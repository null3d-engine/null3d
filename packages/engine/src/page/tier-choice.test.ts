import { describe, expect, it } from 'bun:test';
import type { GpuPath } from '../shared/tier';
import type { WorkerProbe } from '../workers/probe-worker';
import type { CapabilityReport, WorkerProbeFailure } from './capabilities';
import { chooseTier, noTierError } from './engine';

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
			directDraws: false,
			drawPath: 'no-probe',
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

describe('a build that ships one GPU path', () => {
	/** A build that holds the WebGPU shaders alone, as the plugin's shaders.gpuPaths makes one. */
	const webgpuOnly = (path: GpuPath): boolean => path === 'webgpu';

	const worker = {
		requestAnimationFrame: true,
		offscreenWebGL2: true,
		offscreenWebGPU: false,
		directDraws: false,
		drawPath: 'no-probe',
		webgpuError: undefined,
	} as const;

	it('treats the path that the build does not ship as unavailable', () => {
		const report = reportWith({ ...worker });
		expect(chooseTier(report, 'webgl2', true, webgpuOnly)).toBeNull();
		expect(chooseTier(report, 'auto', true, webgpuOnly)).toBeNull();
		expect(chooseTier(report, 'webgl2', true)).toEqual({
			tier: 'webgl2',
			forceCompat: false,
		});
	});

	it('names the build, and the option that left the path out, when no tier is usable', () => {
		const report = reportWith({ ...worker });
		const error = noTierError(report, 'auto', true, webgpuOnly);
		expect(error.message).toContain('E1308');
		expect(error.message).toContain('shaders.gpuPaths');
		expect(error.message).toContain('WebGL2');
	});

	it('keeps E1301 when the build ships both paths and the browser offers neither', () => {
		const report = reportWith({ failure: 'no-answer', error: 'no probe worker answered' });
		const error = noTierError(report, 'auto', true);
		expect(error.message).toContain('E1301');
	});
});
