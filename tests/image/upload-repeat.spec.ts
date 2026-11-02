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
	// The software GPU draws the model's first frame far slower than a GPU, and this run judges only
	// the object count, so it leaves the model out. It also needs more frames after a longer settle,
	// because a plan's first build would otherwise fill the whole window it measures.
	const software = softwareGpu();
	const model = software ? 'model=0' : 'model=1';
	const timing = software ? 'settle=5&seconds=8' : 'settle=2&seconds=3';
	// The governor changes the render scale while frames are slow, which compiles the plan again,
	// so the page keeps it off on every GPU: this test measures the plan's turns, not the governor's.
	await page.goto(`reupload.html?gpu=webgl2&governor=off&preset=low&${timing}&${model}&${query}`);
	const result = await pageResult<UploadResult>(page, 300_000);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(result.failures).toEqual([]);
	return result;
}

test('a reflection that rests makes no GPU object beside a fragment-form pass', async ({
	page,
}) => {
	// The scene loads a model and draws two views, which CI's software GPU takes its time over.
	test.setTimeout(300_000);
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

/**
 * The objects a measure may make for reasons other than a plan change: the targets and pipelines
 * that a first measured frame still builds, and one a frame of slack for a cache that a new view
 * grows. A view that rests makes neither, and the fault made about twenty-three a frame.
 */
const objectAllowance = (frames: number): number => frames + 16;
