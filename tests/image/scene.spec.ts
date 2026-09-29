import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { compareToReference } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface SceneResult {
	error?: string;
	mode: { hold: number | null };
	capabilities: { tier: string };
	/** The live engine's frames; absent in hold mode, which draws one frame. */
	stats?: {
		drawCalls: { median: number };
		visibleEntries: { median: number } | null;
		uploadBytes: { count: number };
		frames: number;
		rebuilds: number;
	};
	failures: string[];
	width: number;
	height: number;
	pixels: string;
}

/** Opens the scene page with `switches` and returns its result, which must have no error. */
async function openScene(page: Page, switches: string): Promise<SceneResult> {
	await page.goto(`scene.html?${switches}`);
	const result = await pageResult<SceneResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	return result;
}

/** Checks that the page drew the scene on the tier, and matches the scene's reference image. */
function expectImage(result: SceneResult, tier: 'webgpu' | 'webgl2'): void {
	expect(result.capabilities.tier.startsWith(tier)).toBe(true);
	compareToReference(
		'scene',
		tier,
		Buffer.from(result.pixels, 'base64'),
		result.width,
		result.height,
	);
}

/** Checks what a live engine's frames drew. */
function expectFrames(result: SceneResult, tier: 'webgpu' | 'webgl2'): void {
	const { stats } = result;
	if (!stats) throw new Error('the live page measured no frames');
	// Four buckets draw: the red box, the red sphere, the unlit blue box, and the green floor batch.
	// WebGPU draws them from one bundle; WebGL2 in multi-draw calls, or one draw each.
	expect(stats.drawCalls.median).toBe(4);
	// On WebGL2 the list of visible objects has the three meshes and one entry for the floor batch,
	// whose 25 rows form one group once they stop changing. The GPU culls on WebGPU.
	if (tier === 'webgl2') expect(stats.visibleEntries?.median).toBe(4);
	else expect(stats.visibleEntries).toBeNull();
	// The measurement can start before the first frame, which builds the draw tables. The scene is
	// still, so no later frame rebuilds them.
	expect(stats.rebuilds).toBeLessThanOrEqual(1);
}

for (const tier of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES) {
		const switches = `gpu=${tier}&${mode.query}`;
		test(`a held scene matches its reference on ${tier}, ${mode.name}`, async ({ page }) => {
			const result = await openScene(page, `${switches}&hold`);
			expect(result.mode.hold).toBe(0);
			expectImage(result, tier);
		});
		test(`a scene draws through the engine on ${tier}, ${mode.name}`, async ({ page }) => {
			expectFrames(await openScene(page, switches), tier);
		});
		// The image shows that the engine drew the whole scene again on the new device.
		test(`a scene draws again on a new device after the GPU is lost on ${tier}, ${mode.name}`, async ({
			page,
		}) => {
			const result = await openScene(page, `${switches}&lose-gpu`);
			expectFrames(result, tier);
			expectImage(result, tier);
		});
	}

test('the WebGL2 path draws the same scene when its uploads copy out of shared memory', async ({
	page,
}) => {
	expectImage(await openScene(page, 'gpu=webgl2&uploads=copy&hold'), 'webgl2');
});
