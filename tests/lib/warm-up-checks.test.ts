import { describe, expect, it } from 'bun:test';
import { type WarmUpResult, warmUpProblems } from './warm-up-checks.ts';

/** A warm-up page's result in which only the pipelines that `directDraws` implies were built. */
function result(directDraws: boolean, firstFramePipelines: number): WarmUpResult {
	return {
		tier: 'webgpu',
		directDraws,
		firstFramePipelines,
		warmUpMs: 1,
		playPipelines: 0,
		addedPipelines: 1,
		afterPipelines: 0,
		magenta: 100,
		failures: [],
	};
}

describe('warmUpProblems', () => {
	it('accepts the culling pipeline on the indirect path', () => {
		expect(warmUpProblems(result(false, 15), 'webgpu')).toEqual([]);
	});

	it('accepts one pipeline fewer when the device draws directly', () => {
		expect(warmUpProblems(result(true, 14), 'webgpu')).toEqual([]);
	});

	it('holds a direct-draw device to the pipelines that its path builds', () => {
		expect(warmUpProblems(result(true, 16), 'webgpu')).toEqual([
			'the first frame built 16 pipelines, not 14 or 15',
		]);
		expect(warmUpProblems(result(false, 13), 'webgpu')).toEqual([
			'the first frame built 13 pipelines, not 15 or 16',
		]);
	});

	it("accepts the final pass's 8-bit variant, which a dropped render scale builds", () => {
		expect(warmUpProblems(result(false, 16), 'webgpu')).toEqual([]);
		expect(warmUpProblems(result(true, 15), 'webgpu')).toEqual([]);
	});
});
