// A reflection that draws in one frame of two leaves the render plan and rejoins it in turns, and a
// pass that a WebGL2 page runs as a fragment form made that switch happen every frame: each switch
// compiled the plan, made its targets again and bound everything again. The frame that follows such
// a switch waits on a new framebuffer's completeness check, and the page reads hundreds of
// milliseconds a frame. The scene here has all three parts: a model with compressed textures, a
// reflection at a cadence of two, and a compute pass with a fragment form. The page counts the GPU
// objects that each frame made, which is zero while a resting view changes no plan, and the bytes
// that each frame uploaded, which is the pass's own small texture rather than the scene's maps.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** True on CI's software renderer, which draws these pages several times slower than a GPU. */
const softwareGpu = () => test.info().project.name.startsWith('chromium-swiftshader');

/** The bytes that a frame may upload: the pass's state texture and its values, not the scene's maps. */
const LIMIT_BYTES = 256 * 1024;

interface UploadResult {
	ok: boolean;
	tier: string;
	frames: number;
	pass: boolean;
	reflect: boolean;
	model: boolean;
	uploadBytes: { median: number; p95: number };
	drawCalls: { median: number };
	/** GPU objects that the measure made: a target made again counts one for each. */
	gpuObjects: number;
	failures: string[];
	error?: string;
}

/** Runs the page with one set of switches, and fails with the page's own error when it gives one. */
async function uploads(page: Page, query: string): Promise<UploadResult> {
	await page.goto(`reupload.html?gpu=webgl2&preset=low&seconds=3&${query}`);
	const result = await pageResult<UploadResult>(page, 180_000);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(result.failures).toEqual([]);
	return result;
}

test('a reflection that rests makes no GPU object beside a fragment-form pass', async ({
	page,
}) => {
	const plain = await uploads(page, 'pass=0&reflect=1&every=2');
	const withPass = await uploads(page, 'pass=1&reflect=1&every=2');
	expect(withPass.tier).toBe('webgl2');
	expect(plain.tier).toBe('webgl2');
	// The scene drew the model on both sides, so its maps reached the GPU before the measure.
	expect(withPass.drawCalls.median).toBeGreaterThan(plain.drawCalls.median);
	// A view that rests changes no plan: a plan compiled or a target made again shows here.
	expect(withPass.gpuObjects).toBeLessThanOrEqual(objectAllowance(withPass.frames));
	expect(plain.gpuObjects).toBeLessThanOrEqual(objectAllowance(plain.frames));
	// The pass adds its own state texture and its values, never a copy of the scene's maps. The
	// software GPU draws the model's first fill far slower, so it may still be filling when the
	// measure starts, and only the object count answers there.
	if (!softwareGpu()) {
		expect(withPass.uploadBytes.median).toBeLessThan(LIMIT_BYTES);
		expect(withPass.uploadBytes.p95).toBeLessThan(LIMIT_BYTES * 2);
	}
	console.log(
		`${plain.frames} frames made ${plain.gpuObjects} GPU objects without the pass and ${withPass.gpuObjects} with it`,
	);
});

/** Two objects a frame for the pipelines that a first frame still builds, and none for a switch. */
const objectAllowance = (frames: number): number => frames * 2 + 16;
