// The preset check's rules, apart from the code that runs it (sketch/preset-check.ts). When the
// engine chooses the preset itself, the device hints only suggest it, so after the first frame the
// engine measures the frame rate for a moment: of play, or of the scene that the setup built
// before play starts, as the page's choice of timing says. It reads the lower of the presented and
// completed rates, so frames that queue on the GPU cannot pass for a healthy rate. A preset holds
// when that rate reaches most of the target. Otherwise the engine lowers the preset by one and
// measures again, down to Low. A preset far below the target goes straight to Low, and Low far
// below it goes on into the lowest quality tier. These functions are pure, so tests call them with
// any rates, and the docs generator reads the constants.

import type { QualityPreset } from './presets';

/**
 * The highest frame rate that the check asks a preset to hold, unless the page asks for more. A
 * display that refreshes faster still gets this target, as a preset that holds it plays smoothly
 * there too. It is also the target before the display's rate is measured.
 */
export const CHECK_MAX_FPS = 60;
/** A preset holds its target when the measured rate reaches this share of it. */
export const CHECK_HOLD_SHARE = 0.9;
/**
 * A preset is far below its target when the measured rate stays under this share of it. The
 * check then lowers it straight to Low, and the presets between could not close such a gap. Low
 * far below its target takes the lowest quality tier, where the page allows it.
 */
export const CHECK_FAR_SHARE = 0.25;
/**
 * How long the check draws before it measures, in ms: after the first frame, and after each lower
 * preset's first frame. The first frames after a warm-up can run slower than play, and a new
 * pixel ratio reaches the canvas a frame or two after the change.
 */
export const CHECK_GRACE_MS = 250;
/**
 * The longest time in ms that the grace grows while textures wait to upload: uploads slow the
 * frames that carry them, and play does not pay for them.
 */
export const CHECK_UPLOAD_WAIT_MS = 2000;
/** How long the check measures each preset, in ms. */
export const CHECK_WINDOW_MS = 500;
/**
 * The longest completion interval, in ms, that the check takes as the new preset settled. A lower
 * preset that remakes its shadow map and pipelines draws a frame far longer than play does, and
 * that frame must pass before the next window opens.
 */
export const CHECK_SETTLE_INTERVAL_MS = 100;
/** The frames at play's rate, after a lowering, that the check waits for before its grace starts. */
export const CHECK_SETTLE_FRAMES = 2;
/** The longest time in ms that the check waits after a lowering for the new preset to settle. */
export const CHECK_SETTLE_WAIT_MS = 4000;

/**
 * What the preset check measured at one preset.
 *
 * @category api/quality
 */
export interface PresetCheckRound {
	/** The preset that the check measured. */
	preset: QualityPreset;
	/** Frames per second that the thread that draws presented. */
	presentedFps: number;
	/** Frames per second that the GPU finished. */
	completedFps: number;
}

/**
 * What the preset check measured when the engine started, as `engine.mode.presetCheck` reports it.
 *
 * @category api/quality
 */
export interface PresetCheck {
	/** The preset that the engine chose from the device before the check. */
	from: QualityPreset;
	/**
	 * The frame rate that each preset had to hold: the display's refresh rate, at most 60 or at
	 * most the page's `targetFps` option.
	 */
	targetFps: number;
	/**
	 * Each preset that the check measured, from `from` down. The last is the preset that the engine
	 * runs.
	 */
	rounds: PresetCheckRound[];
	/**
	 * True when Low measured far below the target too, and the check took the lowest quality tier
	 * after it: a third of the render scale, without the sun's shadows or bloom. Absent otherwise.
	 */
	lowest?: true;
	/**
	 * True when the engine took this result from an earlier start of the sketch in this browser on
	 * this device, and did not measure again. The engine stores each check's result for a week. A
	 * check that went on from the rounds of an earlier start, whose check never ended, is false, and
	 * lists those rounds first.
	 */
	reused: boolean;
}

/**
 * When the preset check measures, as `createEngine`'s `presetCheck` option and the
 * `?preset-check=` switch name it. With `during-play`, the default, the scene plays from its first
 * frame, and the check measures the first frames of play. With `before-play`, the check measures
 * before the sketch's update runs, and the start waits for it.
 *
 * @category api/engine
 */
export type PresetCheckTiming = 'during-play' | 'before-play';

/** The values of `PresetCheckTiming`, for the option's and the switch's checks. */
export const PRESET_CHECK_TIMINGS: readonly PresetCheckTiming[] = ['during-play', 'before-play'];

/**
 * The frame rate that the engine defends, as `createEngine`'s `targetFps` option and the
 * `?target-fps=` switch name it: `display` for the display's full refresh rate, or a whole number
 * of frames per second that caps the target. Without it, the target is at most 60.
 *
 * @category api/quality
 */
export type TargetFps = 'display' | number;

/**
 * The highest target that a `targetFps` setting and a frame rate cap such as `?fps=` allow:
 * `CHECK_MAX_FPS` without a setting, and infinity for `display` without a cap.
 */
export function maxTargetFps(target: TargetFps | undefined, fpsCap: number | undefined): number {
	const highest = target === 'display' ? Number.POSITIVE_INFINITY : (target ?? CHECK_MAX_FPS);
	return Math.min(highest, fpsCap ?? Number.POSITIVE_INFINITY);
}

/**
 * The frame rate that a preset must hold: the display's refresh rate, at most `highest`. A refresh
 * rate of 0, not measured yet, counts as `CHECK_MAX_FPS`, or `highest` when that is lower.
 */
export function checkTargetFps(refreshHz: number, highest = CHECK_MAX_FPS): number {
	return Math.min(highest, refreshHz > 0 ? refreshHz : CHECK_MAX_FPS);
}

/**
 * The target after a round: the higher of the target so far and the one from the refresh rate that
 * the meter reads now. A GPU that falls behind can slow the meter, which then reads low, so the
 * target never falls during a check, and it starts at the rate that the meter read before the
 * check's first frame. Each round that the check lowered then missed the target that the check
 * reports.
 */
export function raiseTarget(targetFps: number, refreshHz: number, highest = CHECK_MAX_FPS): number {
	return Math.max(targetFps, checkTargetFps(refreshHz, highest));
}

/** A rate from a count of frames and the time they covered, in ms; 0 when they covered none. */
export function frameRate(frames: number, ms: number): number {
	return frames > 0 && ms > 0 ? (frames * 1000) / ms : 0;
}

/** True when the lower of a round's two rates reaches the share of the target that holds it. */
export function holdsTarget(round: PresetCheckRound, targetFps: number): boolean {
	return Math.min(round.presentedFps, round.completedFps) >= targetFps * CHECK_HOLD_SHARE;
}

/** True when the lower of a round's two rates stays under the share of the target that is far below it. */
export function farBelowTarget(round: PresetCheckRound, targetFps: number): boolean {
	return Math.min(round.presentedFps, round.completedFps) < targetFps * CHECK_FAR_SHARE;
}
