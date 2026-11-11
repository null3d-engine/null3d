import { describe, expect, it } from 'bun:test';
import { type WarmUpResult, warmUpProblems } from './warm-up-checks.ts';

/** A warm-up page's result in which only the pipelines that the two presets imply were built. */
function result(
	directDraws: boolean,
	firstFramePipelines: number,
	preset = 'high',
	tier = 'webgpu',
	playPreset = preset,
): WarmUpResult {
	return {
		tier,
		firstFramePreset: preset,
		playPreset,
		directDraws,
		firstFramePipelines,
		warmUpMs: 1,
		playPipelines: 0,
		addedPipelines:
			tier === 'webgpu' && (playPreset === 'high' || playPreset === 'ultra')
				? 3
				: tier === 'webgl2'
					? 2
					: 1,
		afterPipelines: 0,
		magenta: 100,
		failures: [],
	};
}

describe('warmUpProblems', () => {
	it('accepts the GPU-driven pipelines on the indirect path', () => {
		expect(warmUpProblems(result(false, 38), 'webgpu')).toEqual([]);
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

	it("judges the added quad at the preset in force when it warmed up, not the first frame's", () => {
		// The check stepped from High to Medium after the first frame: the frame's 38 pipelines are
		// High's, and the quad warms up at Medium and builds its depth pipeline there or not at all.
		expect(warmUpProblems(result(false, 38, 'high', 'webgpu', 'medium'), 'webgpu')).toEqual([]);
		// Had it warmed up at High, its depth pipeline would be one of the three it builds.
		expect(warmUpProblems({ ...result(false, 38), addedPipelines: 1 }, 'webgpu')).toEqual([
			"the added object built 1 pipelines at 'high', not 3",
		]);
	});

	it('allows one more pipeline when the preset steps down during play', () => {
		// The software GPU steps High to Medium; the scale change builds the final pass's 8-bit
		// variant, so the object's measure holds two where its path builds one.
		expect(
			warmUpProblems(
				{ ...result(false, 38, 'high', 'webgpu', 'medium'), addedPipelines: 2 },
				'webgpu',
			),
		).toEqual([]);
		expect(
			warmUpProblems(
				{ ...result(false, 38, 'high', 'webgpu', 'medium'), addedPipelines: 3 },
				'webgpu',
			),
		).toEqual(["the added object built 3 pipelines at 'medium', not 1 or 2"]);
		// A warm-up at the same preset stays exact.
		expect(warmUpProblems({ ...result(false, 38), addedPipelines: 4 }, 'webgpu')).toEqual([
			"the added object built 4 pipelines at 'high', not 3",
		]);
	});

	it('accepts one pipeline fewer when the device draws directly', () => {
		expect(warmUpProblems(result(true, 37), 'webgpu')).toEqual([]);
	});

	it('holds a direct-draw device to the pipelines that its path builds', () => {
		expect(warmUpProblems(result(true, 16), 'webgpu')).toEqual([
			"the first frame built 16 pipelines at 'high', not 37 or 38",
		]);
		expect(warmUpProblems(result(false, 13), 'webgpu')).toEqual([
			"the first frame built 13 pipelines at 'high', not 38 or 39",
		]);
	});

	it("accepts the final pass's 8-bit variant, which a dropped render scale builds", () => {
		expect(warmUpProblems(result(false, 39), 'webgpu')).toEqual([]);
		expect(warmUpProblems(result(true, 38), 'webgpu')).toEqual([]);
	});

	it('names the preset it needs when a page reports none', () => {
		expect(warmUpProblems({ ...result(false, 38), firstFramePreset: null }, 'webgpu')).toEqual([
			'the first frame reported no preset, which this check has no pipeline count for on webgpu; it needs one of low, medium, high, ultra',
		]);
		expect(warmUpProblems({ ...result(false, 38), playPreset: null }, 'webgpu')).toEqual([
			"the object's warm-up reported no preset, which this check has no pipeline count for on webgpu; it needs one of low, medium, high, ultra",
		]);
	});

	it('names a preset that it has no count for instead of judging at another', () => {
		expect(warmUpProblems(result(false, 38, 'cinematic', 'webgpu', 'high'), 'webgpu')).toEqual([
			"the first frame reported the preset 'cinematic', which this check has no pipeline count for on webgpu; it needs one of low, medium, high, ultra",
		]);
		expect(warmUpProblems(result(false, 38, 'high', 'webgpu', 'cinematic'), 'webgpu')).toEqual([
			"the object's warm-up reported the preset 'cinematic', which this check has no pipeline count for on webgpu; it needs one of low, medium, high, ultra",
		]);
	});
});
