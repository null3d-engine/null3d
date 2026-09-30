import { describe, expect, it } from 'bun:test';
import { encodePng } from '../../packages/cli/src/png.js';
import { type CaptureResult, captureProblems } from './capture-checks.ts';
import { ENGINE_MODES } from './engine-checks.ts';

const [pipelined] = ENGINE_MODES;

/** A capture page's result for a 2 x 1 frame: `frame` as captureFrame read it, `image` as capture gave it. */
function result(frame: number[], image: number[], afterStop = 'E1414'): CaptureResult {
	const png = encodePng({ width: 2, height: 1, data: new Uint8Array(image) });
	return {
		mode: pipelined,
		width: 2,
		height: 1,
		pixels: Buffer.from(frame).toString('base64'),
		image: Buffer.from(png).toString('base64'),
		imageType: 'image/png',
		afterStop,
	};
}

describe('captureProblems', () => {
	it('accepts an image of the frame, made opaque', () => {
		expect(
			captureProblems(result([1, 2, 3, 0, 4, 5, 6, 200], [1, 2, 3, 255, 4, 5, 6, 255]), pipelined),
		).toEqual([]);
	});

	it('finds an image whose pixels differ from the frame, or that keeps the GPU alpha', () => {
		expect(
			captureProblems(
				result([1, 2, 3, 255, 4, 5, 6, 255], [1, 2, 9, 255, 4, 5, 6, 255]),
				pipelined,
			),
		).toEqual(['1 of 8 bytes of the image differ from the frame']);
		expect(
			captureProblems(result([1, 2, 3, 0, 4, 5, 6, 0], [1, 2, 3, 0, 4, 5, 6, 0]), pipelined),
		).toEqual(['2 of 8 bytes of the image differ from the frame']);
	});

	it('finds a capture after the stop that did not fail with E1414', () => {
		const frame = [1, 2, 3, 255, 4, 5, 6, 255];
		expect(captureProblems(result(frame, frame, 'an image'), pipelined)).toEqual([
			'a capture after the engine stopped gave an image, not E1414',
		]);
	});

	it('finds an image of another type or size', () => {
		const frame = [1, 2, 3, 255, 4, 5, 6, 255];
		expect(
			captureProblems({ ...result(frame, frame), imageType: 'image/jpeg' }, pipelined),
		).toEqual(['the image is image/jpeg']);
		expect(captureProblems({ ...result(frame, frame), width: 1, height: 2 }, pipelined)).toEqual([
			'the image is 2 x 1, the frame 1 x 2',
		]);
	});
});
