// Checks of the warm-up page's result, shared by the Playwright test and the real-browser runner:
// the first frame builds every pipeline of the pipelines sketch, play builds none, and an object
// added during play shows once its warm-up has built its pipeline.

/** What the warm-up page publishes. */
export interface WarmUpResult {
	tier: string;
	/** True when the scene drew HDR color, whose final pass has a pipeline of its own. */
	hdr: boolean;
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
/** Pixels the added quad covers at the least, in the page's 320 x 180 capture. */
const ADDED_PIXELS = 100;

/**
 * What is wrong with a warm-up page's result on a GPU path; empty when nothing is. WebGPU also
 * builds the culling pass's compute pipeline in the first frame, and HDR color the final pass's.
 */
export function warmUpProblems(result: WarmUpResult, gpu: 'webgpu' | 'webgl2'): string[] {
	const problems = result.failures.map((code) => `the engine failed with ${code}`);
	const expected = SCENE_PIPELINES + (gpu === 'webgpu' ? 1 : 0) + (result.hdr ? 1 : 0);
	if (result.firstFramePipelines !== expected)
		problems.push(`the first frame built ${result.firstFramePipelines} pipelines, not ${expected}`);
	if (result.warmUpMs === null || result.warmUpMs < 0)
		problems.push('the engine recorded no warm-up time');
	if (result.playPipelines !== 0) problems.push(`play built ${result.playPipelines} pipelines`);
	if (result.addedPipelines !== 1)
		problems.push(`the added object built ${result.addedPipelines} pipelines, not 1`);
	if (result.afterPipelines !== 0)
		problems.push(`play after the warm-up built ${result.afterPipelines} pipelines`);
	if (result.magenta < ADDED_PIXELS)
		problems.push('the added object does not show after its warm-up');
	return problems;
}
