import { expect, test } from '@playwright/test';
import { compareToReference } from '../lib/images';

interface ReplayResult {
	error?: string;
	visible: [number, number];
	width: number;
	height: number;
	pixels: string;
}

/** Runs in the page: the result the test page published, once it exists. */
const readResult = () => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult;

test('a replayed draw list culls on the GPU and draws the visible instances', async ({ page }) => {
	await page.goto('/replay.html');
	const handle = await page.waitForFunction(readResult, undefined, { timeout: 30_000 });
	const result = (await handle.jsonValue()) as ReplayResult;
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
