import { describe, expect, test } from 'bun:test';
import { canvasPixels } from './canvas-watch';

describe('canvasPixels', () => {
	test('takes the device-pixel box where it agrees with the ratio', () => {
		expect(canvasPixels(960.5, 540.25, 2, 2, { width: 1921, height: 1080 }, 8192)).toEqual({
			width: 1921,
			height: 1080,
			ratio: 2,
		});
	});

	test('keeps the CSS size times the ratio where the box reports more device pixels', () => {
		// A test runner's ratio emulation on a high-density screen: the page says 1, the box twice.
		expect(canvasPixels(1920, 1080, 1, 1, { width: 3840, height: 2160 }, 8192)).toEqual({
			width: 1920,
			height: 1080,
			ratio: 1,
		});
	});

	test('keeps the CSS size times the ratio where the box reports fewer device pixels', () => {
		// Headless Chrome under an emulated ratio of 2 without a forced screen ratio: the box stays
		// at one device pixel per CSS pixel.
		expect(canvasPixels(1280, 720, 2, 4, { width: 1280, height: 720 }, 8192)).toEqual({
			width: 2560,
			height: 1440,
			ratio: 2,
		});
	});

	test('caps the ratio and ignores the box below the page ratio', () => {
		expect(canvasPixels(960, 540, 2, 1, { width: 1920, height: 1080 }, 8192)).toEqual({
			width: 960,
			height: 540,
			ratio: 1,
		});
	});

	test('fits the largest side within the most that the GPU path draws', () => {
		expect(canvasPixels(4000, 1000, 1, 1, undefined, 2000)).toEqual({
			width: 2000,
			height: 500,
			ratio: 0.5,
		});
	});
});
