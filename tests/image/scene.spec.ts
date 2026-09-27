import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { compareToReference } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface SceneResult {
	error?: string;
	capabilities: { tier: string };
	stats: { drawCalls: { median: number }; uploadBytes: { count: number }; frames: number };
	width: number;
	height: number;
	pixels: string;
}

/** Runs in the page: the result the test page published, once it exists. */
for (const mode of ENGINE_MODES) {
	test(`a scene draws through the engine on webgpu, ${mode.name}`, async ({ page }) => {
		await page.goto(`scene.html?gpu=webgpu&${mode.query}`);
		const result = await pageResult<SceneResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.capabilities.tier.startsWith('webgpu')).toBe(true);
		// One bundle draws four buckets: the red box, the red sphere, the unlit blue box, and the
		// green floor batch.
		expect(result.stats.drawCalls.median).toBe(4);
		compareToReference(
			'scene',
			'webgpu',
			Buffer.from(result.pixels, 'base64'),
			result.width,
			result.height,
		);
	});
}
