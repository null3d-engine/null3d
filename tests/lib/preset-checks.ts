// Checks of the preset check and of a change of preset, shared by the Playwright tests and the
// real-browser runner. The quality page with a heavy scene must see the check lower the preset. The
// preset change page must see every setting take the new preset's value, and no frame draw
// without the pipelines of the new preset.
import {
	CHECK_HOLD_SHARE,
	type PresetCheck,
	type PresetCheckRound,
} from '../../packages/engine/src/quality/check.ts';
import {
	presetIndex,
	presetSettings,
	type QualityPreset,
} from '../../packages/engine/src/quality/presets.ts';

/**
 * Spheres of the GPU-bound page's scene that no GPU of the tests draws at 60 frames per second:
 * the Mac's GPU drew 32,768 at 17 to 28.
 */
export const HEAVY_SPHERES = 32_768;
/** The same for CI's software GPU, which drew 8 at 1 to 6 frames per second. */
export const HEAVY_SPHERES_SOFTWARE = 4;

/** What the quality page reports of the preset. */
export interface PresetMode {
	preset: QualityPreset;
	presetCheck: PresetCheck | null;
}

/** A round in words: "high at 30.2 frames per second". */
export const roundText = ({ preset, presentedFps, completedFps }: PresetCheckRound) =>
	`${preset} at ${Math.min(presentedFps, completedFps)} frames per second`;

/**
 * What is wrong with the preset check of a scene too heavy for the GPU, which started from the
 * `chosen` preset; empty when nothing is. Low has no lighter preset, so the engine checks no preset
 * there.
 */
export function heavyCheckProblems(mode: PresetMode, chosen: QualityPreset): string[] {
	const check = mode.presetCheck;
	if (chosen === 'low') return check ? ['the engine checked Low, which has no lighter preset'] : [];
	if (!check) return ['the engine did not check the preset it chose'];
	const problems: string[] = [];
	if (check.from !== chosen) problems.push(`the check started from ${check.from}, not ${chosen}`);
	const last = check.rounds.at(-1);
	if (!last) return [...problems, 'the check measured no preset'];
	if (mode.preset !== last.preset)
		problems.push(
			`the engine runs ${mode.preset}, not ${last.preset}, which the check measured last`,
		);
	const target = check.targetFps * CHECK_HOLD_SHARE;
	for (const round of check.rounds.slice(0, -1))
		if (Math.min(round.presentedFps, round.completedFps) >= target)
			problems.push(
				`the check lowered ${roundText(round)}, which held the target of ${check.targetFps}`,
			);
	if (presetIndex(mode.preset) >= presetIndex(chosen))
		problems.push(`the check kept ${mode.preset} for a scene too heavy for the GPU`);
	return problems;
}

/** What the preset change page reports. */
export interface PresetChangeResult {
	tier: string;
	mode: { preset: QualityPreset };
	/** The preset and settings that the sketch reports once its change resolved. */
	sketch?: { preset: QualityPreset; settings: Record<string, number | string | null> };
	skippedDraws: number;
	pipelines: number;
	frames: number;
	/** The share of each capture's pixels that differ from the background. */
	coveredBefore: number;
	coveredAfter: number;
	/** True when the capture after the change differs from the one before. */
	changed: boolean;
}

/** The share of the frame that the row of boxes covers at the least. */
const BOXES_COVER = 0.05;

/**
 * What is wrong with the preset change page's change from the preset `from` to `to`, which needs a
 * new pipeline; empty when nothing is. Every setting takes the new preset's value, apart from the
 * page's pixel ratio cap and the settings fixed when the engine starts.
 */
export function presetChangeProblems(
	result: PresetChangeResult,
	from: QualityPreset,
	to: QualityPreset,
): string[] {
	const problems: string[] = [];
	if (result.sketch?.preset !== to || result.mode.preset !== to)
		problems.push(`the engine runs ${result.mode.preset}, not ${to}`);
	const settings = presetSettings(to, {
		maxPixelRatio: 1,
		antialias: presetSettings(from).antialias,
	});
	for (const [name, value] of Object.entries(settings)) {
		// JSON gives Infinity as null.
		const reported = result.sketch?.settings[name] ?? Number.POSITIVE_INFINITY;
		if (reported !== value) problems.push(`${name} is ${reported}, not ${value}`);
	}
	if (result.pipelines === 0) problems.push('the new preset built no pipeline');
	if (result.skippedDraws > 0)
		problems.push(`${result.skippedDraws} draws were skipped while the new pipeline built`);
	if (result.coveredBefore < BOXES_COVER) problems.push('the capture before shows no boxes');
	if (result.coveredAfter < BOXES_COVER) problems.push('the capture after shows no boxes');
	if (!result.changed) problems.push('the capture after the change shows the old material');
	return problems;
}
