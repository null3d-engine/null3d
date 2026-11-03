import { describe, expect, it } from 'bun:test';
import { type WarmUpResult, warmUpProblems } from './warm-up-checks.ts';

/** A warm-up page's result in which only the pipelines that `directDraws` implies were built. */
function result(
	directDraws: boolean,
	firstFramePipelines: number,
	preset = 'high',
	tier = 'webgpu',
): WarmUpResult {
	return {
		tier,
		firstFramePreset: preset,
		directDraws,
		firstFramePipelines,
		warmUpMs: 1,
		playPipelines: 0,
		addedPipelines:
			tier === 'webgpu-compat'
				? 1
				: preset === 'high' || preset === 'ultra' || tier === 'webgl2'
					? 2
					: 1,
		afterPipelines: 0,
		magenta: 100,
		failures: [],
	};
}

describe('warmUpProblems', () => {
	it('accepts the GPU-driven pipelines on the indirect path', () => {
		expect(warmUpProblems(result(false, 31), 'webgpu')).toEqual([]);
	});

	it('follows the preset the first frame drew at, not the one the page ends on', () => {
		// At Medium the WebGPU path draws no bounce, so it builds no screen work.
		expect(warmUpProblems(result(false, 21, 'medium'), 'webgpu')).toEqual([]);
		// WebGL2 pays the six from Medium up, and only 22 at Low.
		expect(warmUpProblems(result(false, 28, 'medium', 'webgl2'), 'webgl2')).toEqual([]);
		expect(warmUpProblems(result(false, 22, 'low', 'webgl2'), 'webgl2')).toEqual([]);
		// Compatibility mode draws the 8-bit path, which has no bounce at any preset.
		expect(warmUpProblems(result(false, 21, 'high', 'webgpu-compat'), 'webgpu')).toEqual([]);
	});

	it('accepts one pipeline fewer when the device draws directly', () => {
		expect(warmUpProblems(result(true, 30), 'webgpu')).toEqual([]);
	});

	it('holds a direct-draw device to the pipelines that its path builds', () => {
		expect(warmUpProblems(result(true, 16), 'webgpu')).toEqual([
			'the first frame built 16 pipelines, not 30 or 31',
		]);
		expect(warmUpProblems(result(false, 13), 'webgpu')).toEqual([
			'the first frame built 13 pipelines, not 31 or 32',
		]);
	});

	it("accepts the final pass's 8-bit variant, which a dropped render scale builds", () => {
		expect(warmUpProblems(result(false, 32), 'webgpu')).toEqual([]);
		expect(warmUpProblems(result(true, 31), 'webgpu')).toEqual([]);
	});
});
