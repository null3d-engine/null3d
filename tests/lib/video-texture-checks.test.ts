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
		width: 320,
		height: 180,
		playing: { mean: 230 * 1024, p99: 230 * 1024, frames: 120 },
		paused: { mean: 0, p99: 0, frames: 120 },
		left: [128, 128, 128],
		right: [128, 128, 128],
		off: 0,
		withinTolerance: true,
		...changes,
	};
}

describe('the video texture page', () => {
	it('passes a video whose frames stay within the budget and whose paused frames upload nothing', () => {
		expect(videoTextureProblems(result())).toEqual([]);
	});

	it('fails a browser that played no video', () => {
		expect(
			videoTextureProblems(
				result({ width: 0, height: 0, playing: { mean: 0, p99: 0, frames: 60 } }),
			),
		).toEqual([
			'the browser played no video: its size stayed 0 x 0',
			'the video sent the texture no frame while it played',
		]);
	});

	it('fails a frame that uploads over the budget, and a paused video that uploads', () => {
		const frame = 230 * 1024;
		expect(
			videoTextureProblems(
				result({
					budget: 128 * 1024,
					playing: { mean: frame, p99: frame, frames: 120 },
					paused: { mean: 64, p99: 64, frames: 120 },
				}),
			),
		).toEqual([
			'a frame uploaded 230.0 KiB, over the 128.0 KiB that one frame may upload',
			'the texture uploaded 64 bytes in a frame while its video was paused',
		]);
	});

	it("fails a frame whose colours are not the page's", () => {
		expect(
			videoTextureProblems(result({ left: [64, 128, 128], off: 64, withinTolerance: false })),
		).toEqual([
			"the video's half of the frame shows rgb(64, 128, 128), not the rgb(128, 128, 128) that the same colour shows from data",
		]);
	});

	it('gives the run the figures of the video and its paused window', () => {
		expect(videoTextureNote(result())).toContain('paused: 0 bytes at p99');
	});
});
