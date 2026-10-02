import { describe, expect, it } from 'bun:test';
import { encodePng } from '../../packages/cli/src/png.js';
import { type CaptureResult, captureProblems } from './capture-checks.ts';
import { ENGINE_MODES } from './engine-checks.ts';

const [pipelined] = ENGINE_MODES;

/**
 * A capture page's result for a frame of `width` x `height`, 2 x 1 unless given: `frame` as
 * captureFrame read it, `image` as capture gave it.
 */
function result(
	frame: number[],
	image: number[],
	afterStop = 'E1414',
	[width, height] = [2, 1],
): CaptureResult {
	const png = encodePng({ width, height, data: new Uint8Array(image) });
	return {
		mode: pipelined,
		width,
		height,
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

	it("allows the one-step changes of Brave's Shields, unless the run recorded them off", () => {
		// 400 opaque pixels, so a hundredth of the bytes is 16.
		const frame = Array.from({ length: 1600 }, (_, i) => (i % 4 === 3 ? 255 : 100));
		const changed = (bytes: number, step: number) =>
			frame.map((value, i) => (i < bytes * 4 && i % 4 === 0 ? value + step : value));
		const of = (image: number[]) => result(frame, image, 'E1414', [20, 20]);
		expect(captureProblems(of(changed(16, 1)), pipelined, 'on')).toEqual([]);
		expect(captureProblems(of(changed(16, -1)), pipelined, null)).toEqual([]);
		expect(captureProblems(of(changed(16, 1)), pipelined, 'off')).toEqual([
			'16 of 1600 bytes of the image differ from the frame',
		]);
		expect(captureProblems(of(changed(16, 1)), pipelined)).toEqual([
			'16 of 1600 bytes of the image differ from the frame',
		]);
		expect(captureProblems(of(changed(17, 1)), pipelined, 'on')).toEqual([
			"17 of 1600 bytes of the image differ from the frame, more than Brave's Shields change",
		]);
		expect(captureProblems(of(changed(1, 2)), pipelined, 'on')).toEqual([
			"1 of 1600 bytes of the image differ from the frame, more than Brave's Shields change",
		]);
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
