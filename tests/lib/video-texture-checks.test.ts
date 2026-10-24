import { describe, expect, it } from 'bun:test';
import {
	type VideoTextureResult,
	videoTextureNote,
	videoTextureProblems,
} from './video-texture-checks.ts';

/** A run that passed, with the figures that a run of the page gives. */
function result(changes: Partial<VideoTextureResult> = {}): VideoTextureResult {
	return {
		budget: 2 * 1024 * 1024,
		width: 640,
		height: 360,
		maxSize: 512,
		frame: { width: 512, height: 288 },
		played: true,
		copy: { count: 120, medianMs: 1.5, p95Ms: 2.2 },
		playing: { mean: 576 * 1024, p99: 576 * 1024, frames: 120 },
		paused: { mean: 0, p99: 0, frames: 120 },
		samples: [
			{ at: 'the top half', video: [96, 160, 224], data: [96, 160, 224] },
			{ at: 'the bottom half', video: [224, 160, 64], data: [224, 160, 64] },
		],
		...changes,
	};
}

describe('the video texture page', () => {
	it('passes a video whose frames stay within the budget, scaled and the right way up', () => {
		expect(videoTextureProblems(result())).toEqual([]);
	});

	it('fails a browser that played no video', () => {
		expect(
			videoTextureProblems(
				result({
					played: false,
					width: 0,
					height: 0,
					frame: { width: 1, height: 1 },
					playing: { mean: 0, p99: 0, frames: 60 },
				}),
			),
		).toEqual([
			'the browser did not play the video',
			'the browser played no video: its size stayed 0 x 0',
			'the video sent the texture no frame while it played',
		]);
	});

	it('fails a frame that uploads over the budget, and a paused video that uploads', () => {
		const frame = 2300 * 1024;
		expect(
			videoTextureProblems(
				result({
					budget: 128 * 1024,
					playing: { mean: frame, p99: frame, frames: 120 },
					paused: { mean: 64, p99: 64, frames: 120 },
				}),
			),
		).toEqual([
			'a frame uploaded 2300.0 KiB, over the 128.0 KiB that one frame may upload',
			'the texture uploaded 64 bytes in a frame while its video was paused',
		]);
	});

	it("fails a frame that keeps the video's size instead of the scaled one", () => {
		expect(videoTextureProblems(result({ frame: { width: 640, height: 360 } }))).toEqual([
			"the texture took 640 x 360 texels, past the 512 that a frame's widest side may take",
		]);
	});

	it('fails a frame of another shape than the video', () => {
		expect(videoTextureProblems(result({ frame: { width: 512, height: 512 } }))).toEqual([
			"the texture took 512 x 512 texels, not the shape of the video's 640 x 360",
		]);
	});

	it('fails a picture that is upside down', () => {
		const [top, bottom] = result().samples;
		expect(
			videoTextureProblems(
				result({
					samples: [
						{ at: 'the top half', video: bottom?.data ?? [], data: top?.data ?? [] },
						{ at: 'the bottom half', video: top?.data ?? [], data: bottom?.data ?? [] },
					],
				}),
			),
		).toEqual([
			"the video's half shows rgb(224, 160, 64) at the top half, not the rgb(96, 160, 224) that the same colour shows from data",
			"the video's half shows rgb(96, 160, 224) at the bottom half, not the rgb(224, 160, 64) that the same colour shows from data",
		]);
	});

	it('gives the run the figures of the video and its paused window', () => {
		const note = videoTextureNote(result());
		expect(note).toContain('paused: 0 bytes at p99');
		expect(note).toContain(
			"the page's copy of a frame: 1.50 ms at the median, 2.20 ms at p95 of 120",
		);
		expect(note).toContain('the texture is 512 x 288');
		expect(note).toContain('the top half: rgb(96, 160, 224) against rgb(96, 160, 224) from data');
	});
});
