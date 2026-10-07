// A live engine drawing the small static scene of the image test manifest's scene test: its frames,
// and the scene drawn again after a loss of the GPU, which must match that test's references.
import { expect, type Page, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { borrowedRun, environmentNamed, imageProblems } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import type { ItemResult } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

interface SceneResult {
	error?: string;
	mode: { hold: number | null };
	capabilities: { tier: string; features: string[]; hdr: boolean };
	/** The live engine's frames; absent in hold mode, which draws one frame. */
	stats?: {
		drawCalls: { median: number };
		visibleEntries: { median: number } | null;
		uploadBytes: { count: number };
		frames: number;
		rebuilds: number;
		gpuPassMs: { name: string; ms: { count: number } }[] | null;
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
	// WebGPU draws them from one bundle; WebGL2 in multi-draw calls, or one draw each, and again in
	// the depth prepass that its presets draw. Where the scene draws HDR color, the final pass adds
	// one triangle over the canvas.
	const opaqueDraws = tier === 'webgl2' ? 8 : 4;
	expect(stats.drawCalls.median).toBe(opaqueDraws + (result.capabilities.hdr ? 1 : 0));
	// On WebGL2 the list of visible objects has the three meshes and one entry for the floor batch,
	// whose 25 rows form one group once they stop changing. The GPU culls on WebGPU.
	if (tier === 'webgl2') expect(stats.visibleEntries?.median).toBe(4);
	else expect(stats.visibleEntries).toBeNull();
	// The measurement can start before the first frame, which builds the draw tables. The scene is
	// still, so no later frame rebuilds them.
	expect(stats.rebuilds).toBeLessThanOrEqual(1);
	// Where the device has timestamp queries, the GPU timer covers the whole WebGPU frame: the copies
	// before the first pass, the culling pass, the main pass, the final pass where the scene draws
	// HDR color, and the time between them.
	if (tier === 'webgpu' && result.capabilities.features.includes('timestamp-query')) {
		const parts = stats.gpuPassMs ?? [];
		const renders = result.capabilities.hdr ? ['render 1', 'render 2'] : ['render 1'];
		expect(parts.map((part) => part.name).sort()).toEqual(
			['between passes', 'compute 1', 'copies', ...renders].sort(),
		);
		for (const part of parts) expect(part.ms.count).toBeGreaterThan(0);
	} else expect(stats.gpuPassMs).toBeNull();
}

/** The layers test's sketch, which moves objects, a batch and the camera between layers each frame. */
const FLIPPING_LAYERS = encodeURIComponent('./sketches/layers-sketch.ts?flip');
/**
 * The fewest frames that the layers test measures, so that the layers change many times. The page
 * measures again until it has them: a software GPU that shares a busy runner with other tests can
 * draw fewer of them in one second.
 */
const LAYER_FRAMES = 11;

for (const tier of ['webgpu', 'webgl2'] as const)
	test(
		`objects, batches and cameras change layers every frame with no rebuild on ${tier}`,
		ALONE,
		async ({ page }) => {
			const switches = `gpu=${tier}&sketch=${FLIPPING_LAYERS}&frames=${LAYER_FRAMES}`;
			const { stats } = await openScene(page, switches);
			if (!stats) throw new Error('the live page measured no frames');
			expect(stats.frames).toBeGreaterThanOrEqual(LAYER_FRAMES);
			// The measurement can start before the first frame, which builds the draw tables.
			expect(stats.rebuilds).toBeLessThanOrEqual(1);
		},
	);

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
