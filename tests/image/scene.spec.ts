import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { compareToReference } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface SceneResult {
	error?: string;
	capabilities: { tier: string };
	stats: {
		drawCalls: { median: number };
		uploadBytes: { count: number };
		frames: number;
		rebuilds: number;
	};
	failures: string[];
	width: number;
	height: number;
	pixels: string;
}

/** Checks a scene page's result against the scene's reference image of the tier. */
function expectScene(result: SceneResult, tier: 'webgpu' | 'webgl2'): void {
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.capabilities.tier.startsWith(tier)).toBe(true);
	// Four buckets draw: the red box, the red sphere, the unlit blue box, and the green floor batch.
	// WebGPU draws them from one bundle; WebGL2 in multi-draw calls, or one draw each.
	expect(result.stats.drawCalls.median).toBe(4);
	// The measurement can start before the first frame, which builds the draw tables. The scene is
	// still, so no later frame rebuilds them.
	expect(result.stats.rebuilds).toBeLessThanOrEqual(1);
	compareToReference(
		'scene',
		tier,
		Buffer.from(result.pixels, 'base64'),
		result.width,
		result.height,
	);
}

for (const tier of ['webgpu', 'webgl2'] as const)
	for (const [label, query] of [
		['a scene draws through the engine', ''],
		['a scene draws again on a new device after the GPU is lost', '&lose-gpu'],
	] as const)
		for (const mode of ENGINE_MODES) {
			test(`${label} on ${tier}, ${mode.name}`, async ({ page }) => {
				await page.goto(`scene.html?gpu=${tier}&${mode.query}${query}`);
				expectScene(await pageResult<SceneResult>(page, 30_000), tier);
			});
		}

test('the WebGL2 path draws the same scene when its uploads copy out of shared memory', async ({
	page,
}) => {
	await page.goto('scene.html?gpu=webgl2&uploads=copy');
	expectScene(await pageResult<SceneResult>(page, 30_000), 'webgl2');
});
