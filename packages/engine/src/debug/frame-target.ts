// The frame rate that the stats overlay judges frames against, and its rules for the colors of the
// frame rate and the work bars. The target is the engine's own: the one that the preset check and
// the quality governor aim at. It is the display's refresh rate, at most 60 frames a second, or a
// lower cap such as `?fps=`.

import { CHECK_HOLD_SHARE, checkTargetFps } from '../quality/check';

/** How a figure stands against the target: within it, near it, or past it. */
export type Level = 'ok' | 'warn' | 'bad';

/** The share of the target's interval below which a thread's or the GPU's work counts as within it. */
const WORK_OK_SHARE = 0.8;
/**
 * The share of the target frame rate from which the frame rate counts as within it: the share that
 * a preset must hold in the preset check.
 */
const RATE_OK_SHARE = CHECK_HOLD_SHARE;
/** The share of the target frame rate below which the frame rate counts as past it. */
const RATE_BAD_SHARE = 0.75;

/** The target frame rate for a display's refresh rate (0 before it is measured) and a frame rate cap. */
export function targetFps(refreshHz: number, fpsCap: number | undefined): number {
	return checkTargetFps(refreshHz, fpsCap);
}

/** How a time of work per frame stands against the target's interval. */
export function workLevel(ms: number, targetMs: number): Level {
	return ms <= targetMs * WORK_OK_SHARE ? 'ok' : ms <= targetMs ? 'warn' : 'bad';
}

/** How a frame rate stands against the target frame rate. */
export function rateLevel(fps: number, target: number): Level {
	return fps >= target * RATE_OK_SHARE ? 'ok' : fps >= target * RATE_BAD_SHARE ? 'warn' : 'bad';
}
