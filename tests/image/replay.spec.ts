import { expect, test } from '@playwright/test';
import { compareToReference } from '../lib/images';
import { pageResult } from '../lib/page-result.ts';

interface ReplayResult {
	error?: string;
	visible: [number, number];
	width: number;
	height: number;
	pixels: string;
}

/** Runs in the page: the result the test page published, once it exists. */
test('a replayed draw list culls on the GPU and draws the visible instances', async ({ page }) => {
	await page.goto('replay.html');
	const result = await pageResult<ReplayResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	// 13 red and 12 blue boxes are in view; the 26th box sits behind the camera.
	expect(result.visible).toEqual([13, 12]);
	compareToReference(
		'replay-instanced',
		'webgpu',
		Buffer.from(result.pixels, 'base64'),
		result.width,
		result.height,
	);
});
