// The preset check's rules, apart from the code that runs it (sketch/preset-check.ts). When the
// engine chooses the preset itself, the device hints only suggest it, so after the first frame the
// engine draws the loading scene for a moment and measures the frame rate. It reads the lower of
// the presented and completed rates, so frames that queue on the GPU cannot pass for a healthy
// rate. A preset holds when that rate reaches most of the target. Otherwise the engine lowers the
// preset by one and measures again, down to Low. These functions are pure, so tests call them with
// any rates, and the docs generator reads the constants.

import type { QualityPreset } from './presets';

/**
 * The highest frame rate that the check asks a preset to hold. A display that refreshes faster
 * still gets this target, as a preset that holds it plays smoothly there too.
 */
export const CHECK_MAX_FPS = 60;
/** A preset holds its target when the measured rate reaches this share of it. */
export const CHECK_HOLD_SHARE = 0.9;
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
	/** The frame rate that each preset had to hold: the display's refresh rate, at most 60. */
	targetFps: number;
	/**
	 * Each preset that the check measured, from `from` down. The last is the preset that the engine
	 * runs.
	 */
	rounds: PresetCheckRound[];
	/**
	 * True when the engine took this result from an earlier start of the sketch in this browser on
	 * this device, and did not measure again. The engine stores each check's result for a week.
	 */
	reused: boolean;
}

/**
 * The frame rate that a preset must hold: the display's refresh rate, at most `CHECK_MAX_FPS` and
 * at most `maxFps` when a frame rate cap is set. A refresh rate of 0, not measured yet, counts as
 * the highest target.
 */
export function checkTargetFps(refreshHz: number, maxFps = CHECK_MAX_FPS): number {
	const target = Math.min(CHECK_MAX_FPS, maxFps);
	return refreshHz > 0 ? Math.min(target, refreshHz) : target;
}

/**
 * The target after a round: the higher of the target so far and the one from the refresh rate that
 * the meter reads now. A GPU that falls behind can slow the meter, which then reads low, so the
 * target never falls during a check. Each round that the check lowered then missed the target that
 * the check reports.
 */
export function raiseTarget(targetFps: number, refreshHz: number, maxFps = CHECK_MAX_FPS): number {
	return Math.max(targetFps, checkTargetFps(refreshHz, maxFps));
}

/** A rate from a count of frames and the time they covered, in ms; 0 when they covered none. */
export function frameRate(frames: number, ms: number): number {
	return frames > 0 && ms > 0 ? (frames * 1000) / ms : 0;
}

/** True when the lower of a round's two rates reaches the share of the target that holds it. */
export function holdsTarget(round: PresetCheckRound, targetFps: number): boolean {
	return Math.min(round.presentedFps, round.completedFps) >= targetFps * CHECK_HOLD_SHARE;
}
