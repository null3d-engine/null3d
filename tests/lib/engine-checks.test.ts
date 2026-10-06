// The engine checks' frame-rate rule: a real GPU's results keep the frame-rate checks, and a
// software GPU's leave them out, as the GPU sets the pace there.
import { describe, expect, it } from 'bun:test';
import {
	drewOnSoftwareGpu,
	ENGINE_MODES,
	type EngineResult,
	engineProblems,
} from './engine-checks.ts';

const SWIFTSHADER =
	'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const MAC_GPU = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)';

const spread = (median: number, count: number) => ({ median, count, mean: median });

/** A result of one second, at a median frame interval of `intervalMs`, from the GPU that `renderer` names. */
function slowResult(renderer: string | null, intervalMs: number): EngineResult {
	const frames = Math.floor(1000 / intervalMs);
	return {
		mode: { ...ENGINE_MODES[0], jobWorkers: 2 },
		capabilities: { tier: 'webgl2', threaded: true, features: [] },
		report: {
			crossOriginIsolated: true,
			atomicsWaitAsync: true,
			webgl2: { renderer },
			webgpu: { adapterInfo: null },
		},
		stats: {
			frames,
			cpuMs: spread(1, frames),
			intervalMs: spread(intervalMs, frames),
			presentedFps: 1000 / intervalMs,
			threads: {},
			gpuMs: null,
			visibleEntries: null,
			load: { firstFrameMs: 1, firstFrameDoneMs: 1, probeMs: 1, coreMs: 1 },
			memory: { wasmBytes: 1 },
			completedFps: 1,
			gpuLatencyMs: null,
			completionSignal: 'fence',
			refreshHz: null,
			mainThread: null,
		},
		count: { updates: frames, largestStep: 0 },
		stages: [],
		messages: [],
		stopMs: 0,
		seconds: 1,
	} as unknown as EngineResult;
}

/** The problems of the frame-rate checks alone. */
const paceProblems = (result: EngineResult) =>
	engineProblems(result, ENGINE_MODES[0] as (typeof ENGINE_MODES)[number], 'webgl2').filter(
		(problem) => /median frame interval|measured only|refresh rate/.test(problem),
	);

describe('the frame-rate checks of the engine page', () => {
	it('tells a software GPU from a real one by the names that the probe reports', () => {
		const report = (renderer: string | null) => slowResult(renderer, 16).report;
		expect(drewOnSoftwareGpu(report(SWIFTSHADER))).toBe(true);
		expect(drewOnSoftwareGpu(report('llvmpipe (LLVM 17.0.6, 256 bits)'))).toBe(true);
		expect(drewOnSoftwareGpu(report(MAC_GPU))).toBe(false);
		expect(drewOnSoftwareGpu(report(null))).toBe(false);
		const adapter = { vendor: 'google', architecture: 'swiftshader', device: '' };
		expect(drewOnSoftwareGpu({ ...report(null), webgpu: { adapterInfo: adapter } })).toBe(true);
	});

	it('keeps them for a real GPU, and leaves them out for a software GPU', () => {
		expect(paceProblems(slowResult(MAC_GPU, 100))).toEqual([
			'measured only 10 frames',
			'median frame interval 100 ms',
			'measured a refresh rate of null Hz',
		]);
		expect(paceProblems(slowResult(SWIFTSHADER, 100))).toEqual([]);
		expect(paceProblems(slowResult(MAC_GPU, 16))).toEqual(['measured a refresh rate of null Hz']);
	});
});
