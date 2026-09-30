// Hold mode's settings and its result on the page. The hold time comes from the ?hold switch or the
// page's hold option, and the engine publishes the held frame, or the error that stopped the hold,
// where test tools read it.

import { EngineError } from '../errors/engine-error';
import type { ErrorCode } from '../errors/fixes';
import { messageOf } from '../errors/message';
import type { Tier } from '../render/renderer';
import type { FrameSummary } from './frame-stats';

/** The most sketch time hold mode steps through, in seconds: 36,000 steps. */
export const MAX_HOLD_SECONDS = 600;

/** The global that hold mode publishes its result in. */
export const HOLD_RESULT_GLOBAL = '__null3dHold';

/**
 * The frame that hold mode drew and read back, as `window.__null3dHold` holds it.
 *
 * @category api/engine
 */
export interface HeldFrame {
	/** True: the engine drew the held frame and read it back. */
	ok: true;
	/** The sketch time of the frame, in seconds. */
	time: number;
	/** The frame's number, counting from 1: the steps to the held time, plus one. */
	frame: number;
	/** The GPU path that drew the frame. */
	tier: Tier;
	/** The frame's width in pixels. */
	width: number;
	/** The frame's height in pixels. */
	height: number;
	/** The frame's pixels as RGBA8 rows, top row first. */
	pixels: Uint8Array;
	/**
	 * The held frame's figures, in the form that `engine.measure` returns: CPU time by thread and
	 * phase, draw calls, uploads and pipelines, for the held frame alone. The engine draws no frame
	 * before the held one, so the held frame creates every GPU object and uploads the whole scene.
	 * `rebuilds` and `visibleEntries` cover every step of the hold. GPU time is null, because the
	 * engine times the GPU only while `engine.measure` runs.
	 */
	stats: FrameSummary;
}

/**
 * The error that stopped hold mode, as `window.__null3dHold` holds it.
 *
 * @category api/engine
 */
export interface HoldFailure {
	/** False: the engine stopped before it read the held frame back. */
	ok: false;
	/** The error's code, or null for an error that has none, such as one the sketch threw. */
	code: ErrorCode | null;
	/** The error's message. */
	error: string;
}

/**
 * What hold mode publishes on the page as `window.__null3dHold`: the held frame, or the error that
 * stopped the hold. The engine publishes it the moment it knows either, so a test tool never waits
 * out a timeout on a page that failed.
 *
 * @category api/engine
 */
export type HoldResult = HeldFrame | HoldFailure;

/**
 * The sketch time to hold at, in seconds, from the `?hold` switch's text and the page's hold
 * option; undefined for a live engine. The switch wins over the option. A bare `?hold` holds at the
 * option's time, or at 0 without one. A time that is not a number of seconds from 0 to the most
 * fails with E1407.
 */
export function holdSeconds(
	option: number | undefined,
	fromSwitch: string | undefined,
): number | undefined {
	if (fromSwitch === undefined && option === undefined) return undefined;
	const text = fromSwitch?.trim();
	const seconds = text ? Number(text) : (option ?? 0);
	if (seconds >= 0 && seconds <= MAX_HOLD_SECONDS) return seconds;
	const given = text ? `?hold=${fromSwitch}` : `the hold option ${String(option)}`;
	throw new EngineError(
		'E1407',
		`${given} is not a number of seconds from 0 to ${MAX_HOLD_SECONDS}.`,
	);
}

/** Publishes hold mode's result on the page, or clears it when a new hold starts. */
export function publishHold(result: HoldResult | undefined): void {
	(globalThis as Record<string, unknown>)[HOLD_RESULT_GLOBAL] = result;
}

/** The failure that `error` gives hold mode's result. */
export function holdFailure(error: unknown): HoldFailure {
	return {
		ok: false,
		code: error instanceof EngineError ? error.code : null,
		error: messageOf(error),
	};
}
