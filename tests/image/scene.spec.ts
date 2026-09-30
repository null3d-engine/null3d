// A live engine drawing the small static scene of the image test manifest's scene test: its frames,
// and the scene drawn again after a loss of the GPU, which must match that test's references.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { borrowedRun, environmentNamed, imageProblems } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import type { ItemResult } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

interface SceneResult {
	error?: string;
	mode: { hold: number | null };
	capabilities: { tier: string; hdr: boolean };
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

/** Checks what a live engine's frames drew. */
function expectFrames(result: SceneResult, tier: 'webgpu' | 'webgl2'): void {
	const { stats } = result;
	if (!stats) throw new Error('the live page measured no frames');
	// Four buckets draw: the red box, the red sphere, the unlit blue box, and the green floor batch.
	// WebGPU draws them from one bundle; WebGL2 in multi-draw calls, or one draw each. Where the
	// scene draws HDR color, the final pass adds one triangle over the canvas.
	expect(stats.drawCalls.median).toBe(result.capabilities.hdr ? 5 : 4);
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
		test(`a scene draws through the engine on ${tier}, ${mode.name}`, async ({ page }) => {
			expectFrames(await openScene(page, switches), tier);
		});
		// The image shows that the engine drew the whole scene again on the new device.
		test(`a scene draws again on a new device after the GPU is lost on ${tier}, ${mode.name}`, async ({
			page,
		}, testInfo) => {
			const result = await openScene(page, `${switches}&lose-gpu`);
			expectFrames(result, tier);
			expect(result.capabilities.tier).toBe(tier);
			const run = borrowedRun(manifestRun('scene', tier, mode.name), 'scene-after-gpu-loss');
			const place = { environment: environmentNamed(testInfo.project.name) };
			expect(imageProblems(run, result as unknown as ItemResult, place)).toEqual([]);
		});
	}
