// Checks of the warm-up page's result, shared by the Playwright test and the real-browser runner:
// the first frame builds every pipeline of the pipelines sketch, play builds none, and an object
// added during play shows once its warm-up has built its pipeline.

/** What the warm-up page publishes. */
export interface WarmUpResult {
	tier: string;
	/** Pipelines that the first frame built. */
	firstFramePipelines: number | null;
	/** Time from the first build's start until none was building. */
	warmUpMs: number | null;
	/** Pipelines built while the scene played. */
	playPipelines: number;
	/** Pipelines built while the sketch added an object and warmed it up. */
	addedPipelines: number;
	/** Pipelines built after that. */
	afterPipelines: number;
	/** Pixels of the added object's color in the capture. */
	magenta: number;
	failures: string[];
}

/** The render pipelines of the pipelines sketch: lit and unlit on four vertex formats, and two. */
export const SCENE_PIPELINES = 10;
/**
 * The compute pipelines that WebGPU builds in the first frame, with or without lights in the
 * scene: the culling pass's, and the light clustering pass's three steps.
 */
const WEBGPU_COMPUTE_PIPELINES = 4;
/** Pixels the added quad covers at the least, in the page's 320 x 180 capture. */
const ADDED_PIXELS = 100;

/**
 * What is wrong with a warm-up page's result on a GPU path; empty when nothing is. WebGPU also
 * builds its compute pipelines in the first frame, and every path the final pass's, which the
 * 8-bit path runs while the render scale can drop. WebGL2's presets draw the depth prepass, so
 * each of its opaque pipelines comes with a prepass pipeline. The first frame and an object's
 * warm-up build that one too, so play still builds none and no frame waits for it.
 */
export function warmUpProblems(result: WarmUpResult, gpu: 'webgpu' | 'webgl2'): string[] {
	const problems = result.failures.map((code) => `the engine failed with ${code}`);
	const perObject = gpu === 'webgl2' ? 2 : 1;
	const expected =
		SCENE_PIPELINES * perObject + (gpu === 'webgpu' ? WEBGPU_COMPUTE_PIPELINES : 0) + 1;
	if (result.firstFramePipelines !== expected)
		problems.push(`the first frame built ${result.firstFramePipelines} pipelines, not ${expected}`);
	if (result.warmUpMs === null || result.warmUpMs < 0)
		problems.push('the engine recorded no warm-up time');
	if (result.playPipelines !== 0) problems.push(`play built ${result.playPipelines} pipelines`);
	if (result.addedPipelines !== perObject)
		problems.push(`the added object built ${result.addedPipelines} pipelines, not ${perObject}`);
	if (result.afterPipelines !== 0)
		problems.push(`play after the warm-up built ${result.afterPipelines} pipelines`);
	if (result.magenta < ADDED_PIXELS)
		problems.push('the added object does not show after its warm-up');
	return problems;
}
