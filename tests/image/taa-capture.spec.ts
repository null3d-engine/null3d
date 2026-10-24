// D-206's proof: a captured frame with the temporal resolve on holds the image that the live canvas
// shows, on both GPU paths and with MSAA and one sample per pixel, and the resolve turns off and on
// again while the engine runs without a GPU validation fault.
import { expect, test } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';
import { pageResult } from '../lib/page-result.ts';

interface CapturePage {
	error?: string;
	tier: string;
	hdr: boolean;
	width: number;
	height: number;
	pixels: string;
}

/** One channel's mean, over every pixel of an image. */
function mean(data: Uint8Array, channel: number): number {
	let sum = 0;
	for (let i = channel; i < data.length; i += 4) sum += data[i] as number;
	return sum / (data.length / 4);
}

/** The largest value of one channel in an image. */
function largest(data: Uint8Array, channel: number): number {
	let most = 0;
	for (let i = channel; i < data.length; i += 4) most = Math.max(most, data[i] as number);
	return most;
}

/** The mean distance of two images' color channels, in 8-bit levels. */
function distance(a: Uint8Array, b: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		if (i % 4 === 3) continue;
		sum += Math.abs((a[i] as number) - (b[i] as number));
	}
	return sum / ((a.length / 4) * 3);
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const antialias of ['msaa', 'none'] as const) {
		test(`a capture with the resolve on holds the live image, ${antialias} on ${gpu}`, async ({
			page,
		}) => {
			await page.goto(`taa-capture.html?gpu=${gpu}&antialias=${antialias}&jitter=0`);
			const result = await pageResult<CapturePage>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(gpu);
			const captured = Buffer.from(result.pixels, 'base64');
			// The canvas the browser shows, while the engine keeps drawing.
			const live = decodePngRgba(Buffer.from(await page.locator('canvas').screenshot()), 'live');
			expect([live.width, live.height]).toEqual([result.width, result.height]);

			// Neither image is black: the resolve's own output has reached the capture.
			expect(mean(captured, 0), 'the capture is black').toBeGreaterThan(3);
			expect(largest(captured, 0), 'the capture is black').toBeGreaterThan(40);
			expect(mean(live.data, 0), 'the live canvas is black').toBeGreaterThan(3);
			expect(largest(live.data, 0), 'the live canvas is black').toBeGreaterThan(40);
			// The capture holds the image the live canvas shows.
			const apart = distance(captured, live.data);
			expect(
				apart,
				`the capture differs from the live canvas by ${apart.toFixed(1)} levels`,
			).toBeLessThan(16);

			// The resolve turns off and on again while the engine runs, and faults nothing.
			const failures = await page.evaluate(async () => {
				const test = (
					globalThis as unknown as {
						__taaCapture: { toggle(): void; failures: string[] };
					}
				).__taaCapture;
				for (let round = 0; round < 6; round++) {
					test.toggle();
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
				await new Promise((resolve) => setTimeout(resolve, 500));
				return test.failures;
			});
			expect(failures).toEqual([]);
		});
	}
}

// The same picture with the resolve off, so the proof's comparison is not one that fails for every
// mode alike.
test('a capture without the resolve holds the live image, msaa on webgpu', async ({ page }) => {
	await page.goto('taa-capture.html?gpu=webgpu&antialias=msaa&jitter=0&taa=0');
	const result = await pageResult<CapturePage>(page, 60_000);
	expect(result.error).toBeUndefined();
	const captured = Buffer.from(result.pixels, 'base64');
	const live = decodePngRgba(Buffer.from(await page.locator('canvas').screenshot()), 'live');
	expect(mean(captured, 0)).toBeGreaterThan(3);
	expect(largest(captured, 0)).toBeGreaterThan(40);
	expect(distance(captured, live.data)).toBeLessThan(16);
});
