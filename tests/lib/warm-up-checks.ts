// Checks of the warm-up page's result, shared by the Playwright test and the real-browser runner:
// the first frame builds every pipeline of the pipelines sketch, play builds none, and an object
// added during play shows once its warm-up has built its pipeline.

/** What the warm-up page publishes. */
export interface WarmUpResult {
	tier: string;
	/** True when the device culls on the CPU and draws each bucket directly. */
	directDraws: boolean;
	/** Pipelines that the first frame built. */
	firstFramePipelines: number | null;
	/** The preset in force when the first frame was drawn, which the check may have lowered since. */
	firstFramePreset?: string | null;
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

/**
 * The pipelines that the first frame builds, by the path and the preset it drew at. The page draws
 * that frame at the preset the engine starts with, and the engine's own preset check may step down
 * afterwards, so the count follows the preset in the result's `firstFramePreset` rather than the one
 * the page ends on.
 *
 * The six that the preset adds are the bounce light's screen texture: its depth copy, the horizon
 * search, the denoise, the camera's colour copy, and the light's trace and denoise. The preset table
 * turns the light on at High and above, and at WebGL2's Medium, so WebGL2 pays the six from Medium
 * up and WebGPU only from High. Compatibility mode draws the 8-bit path, which the light leaves out
 * at every preset.
 *
 * WebGL2 also builds each scene pipeline with a prepass pair, so ten materials give twenty; WebGPU
 * builds them once each, with a prepass pipeline for the four lit ones where the screen texture reads
 * depth, and the GPU-driven path's nine compute steps; and every path builds the final pass's two
 * builds, its full-precision one and the 8-bit variant that a dropped render scale adds.
 */
const FIRST_FRAME_PIPELINES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	webgl2: { low: 22, medium: 28, high: 28, ultra: 28 },
	webgpu: { low: 21, medium: 21, high: 31, ultra: 31 },
	'webgpu-compat': { low: 21, medium: 21, high: 21, ultra: 21 },
};
/** The preset a page's result names, or the path's first entry when it names none. */
const presetOf = (tier: string, preset: string | null | undefined): string =>
	preset !== null && preset !== undefined && preset in (FIRST_FRAME_PIPELINES[tier] ?? {})
		? preset
		: 'low';
/**
 * True where the screen texture's work draws at this path and preset: the bounce light's own rule,
 * which the pipeline count and the added object's pair both follow.
 */
const screenWork = (tier: string, preset: string): boolean =>
	tier === 'webgl2'
		? preset !== 'low'
		: tier === 'webgpu' && (preset === 'high' || preset === 'ultra');
/** Pixels the added quad covers at the least, in the page's 320 x 180 capture. */
const ADDED_PIXELS = 100;

/**
 * What is wrong with a warm-up page's result on a GPU path; empty when nothing is. The first frame
 * builds the pipelines that its path's groups name, above, less the culling pipeline that a device
 * drawing directly does not build. Play builds none, and the object that the sketch adds builds its
 * material's pair, which is two wherever the screen texture reads depth and one on the 8-bit path.
 */
export function warmUpProblems(result: WarmUpResult, gpu: 'webgpu' | 'webgl2'): string[] {
	const problems = result.failures.map((code) => `the engine failed with ${code}`);
	// A page that names no tier of its own is the one that the run asked for.
	const tier = result.tier in FIRST_FRAME_PIPELINES ? result.tier : gpu;
	const preset = presetOf(tier, result.firstFramePreset);
	// WebGL2 draws the depth prepass at every preset, so a material's pair is two there. On the
	// other paths it is two only where the screen texture reads depth.
	const perObject = tier === 'webgl2' || screenWork(tier, preset) ? 2 : 1;
	// A device that culls on the CPU and draws each bucket directly builds no culling pipeline.
	const driven = FIRST_FRAME_PIPELINES[tier]?.[preset] ?? Number.NaN;
	const expected = driven - (result.directDraws ? 1 : 0);
	// A slow device can drop the render scale before the first frame ends, which builds the final
	// pass's 8-bit variant beside its full-precision one: the count may hold one more.
	if (result.firstFramePipelines !== expected && result.firstFramePipelines !== expected + 1)
		problems.push(
			`the first frame built ${result.firstFramePipelines} pipelines, not ${expected} or ${expected + 1}`,
		);
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
