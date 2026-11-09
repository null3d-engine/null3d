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
	firstFramePreset: string | null;
	/** The preset in force while the sketch added the object and warmed it up. */
	playPreset: string | null;
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
 * builds them once each, with a depth pipeline for each of the scene's four vertex formats where the
 * screen texture reads depth, and the GPU-driven path's nine compute steps; and every path builds the
 * final pass's two builds, its full-precision one and the 8-bit variant that a dropped render scale
 * adds. GPU occlusion culling, which WebGPU draws from High up, adds seven more there, and one to
 * each object that warms up later.
 */
const FIRST_FRAME_PIPELINES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
	webgl2: { low: 22, medium: 28, high: 28, ultra: 28 },
	webgpu: { low: 21, medium: 21, high: 38, ultra: 38 },
	'webgpu-compat': { low: 21, medium: 21, high: 21, ultra: 21 },
};
/** Pixels the added quad covers at the least, in the page's 320 x 180 capture. */
const ADDED_PIXELS = 100;
/**
 * True where the depth prepass draws at this path and preset. WebGL2's presets draw it at every
 * preset. The other paths draw it only where the screen texture reads depth, which the preset table
 * turns on at High and above. Compatibility mode's 8-bit path leaves the light out at every preset.
 */
const prepass = (tier: string, preset: string): boolean =>
	tier === 'webgl2' || (tier === 'webgpu' && (preset === 'high' || preset === 'ultra'));

/**
 * What is wrong with a warm-up page's result on a GPU path; empty when nothing is. The first frame
 * builds the pipelines that its path's groups name, above, less the culling pipeline that a device
 * drawing directly does not build. Play builds none, and the object that the sketch adds builds its
 * own pipelines during its warm-up.
 *
 * Each count follows the preset in force when its work drew. The first frame draws before the
 * engine's own preset check can step down, so its count follows the first frame's preset. The added
 * object warms up during play, after the check, so its count follows the play preset. A result that
 * names no preset, or one that the table has no count for, fails by name rather than being judged at
 * another preset's count.
 */
export function warmUpProblems(result: WarmUpResult, gpu: 'webgpu' | 'webgl2'): string[] {
	const problems = result.failures.map((code) => `the engine failed with ${code}`);
	// A page that names no tier of its own is the one that the run asked for.
	const tier = result.tier in FIRST_FRAME_PIPELINES ? result.tier : gpu;
	const counts = FIRST_FRAME_PIPELINES[tier] ?? {};
	const known = (preset: string | null): string | null =>
		preset !== null && preset in counts ? preset : null;
	const firstFramePreset = known(result.firstFramePreset);
	const playPreset = known(result.playPreset);
	const unknown = (work: string, reported: string | null) => {
		const named = reported === null ? 'no preset' : `the preset '${reported}'`;
		problems.push(
			`${work} reported ${named}, which this check has no pipeline count for on ${tier}; it needs one of ${Object.keys(counts).join(', ')}`,
		);
	};
	if (firstFramePreset === null) unknown('the first frame', result.firstFramePreset);
	else {
		// A device that culls on the CPU and draws each bucket directly builds no culling pipeline.
		const expected = (counts[firstFramePreset] as number) - (result.directDraws ? 1 : 0);
		// A slow device can drop the render scale before the first frame ends, which builds the final
		// pass's 8-bit variant beside its full-precision one: the count may hold one more.
		if (result.firstFramePipelines !== expected && result.firstFramePipelines !== expected + 1)
			problems.push(
				`the first frame built ${result.firstFramePipelines} pipelines at '${firstFramePreset}', not ${expected} or ${expected + 1}`,
			);
	}
	if (playPreset === null) unknown("the object's warm-up", result.playPreset);
	else {
		// The added quad is unlit. WebGL2 pairs an opaque pipeline with the prepass's depth pipeline;
		// the other paths do that only where the depth prepass draws.
		const perObject =
			(prepass(tier, playPreset) ? 2 : 1) +
			(tier === 'webgpu' && prepass(tier, playPreset) ? 1 : 0);
		// A preset that steps down during play can change the render scale, which builds the final
		// pass's 8-bit variant beside its full-precision one: only that case may hold one more.
		const stepping = result.firstFramePreset !== result.playPreset;
		if (
			result.addedPipelines !== perObject &&
			!(stepping && result.addedPipelines === perObject + 1)
		)
			problems.push(
				`the added object built ${result.addedPipelines} pipelines at '${playPreset}', not ${perObject}${stepping ? ` or ${perObject + 1}` : ''}`,
			);
	}
	if (result.warmUpMs === null || result.warmUpMs < 0)
		problems.push('the engine recorded no warm-up time');
	if (result.playPipelines !== 0) problems.push(`play built ${result.playPipelines} pipelines`);
	if (result.afterPipelines !== 0)
		problems.push(`play after the warm-up built ${result.afterPipelines} pipelines`);
	if (result.magenta < ADDED_PIXELS)
		problems.push('the added object does not show after its warm-up');
	return problems;
}
