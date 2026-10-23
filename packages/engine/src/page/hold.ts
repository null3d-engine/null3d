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
 * The global that a test tool sets before the page loads, with the timed script that hold mode
 * performs. Hold mode reads it once, as it starts, and a live engine ignores it.
 */
export const HOLD_SCRIPT_GLOBAL = '__null3dHoldScript';

/**
 * One step of a timed script that hold mode performs while it steps the sketch. A tool gives each
 * step the sketch time, in seconds, at which the hold performs it, and the steps come in time order.
 *
 * @category api/engine
 */
export type HoldScriptStep =
	| {
			/** The sketch time of the step, in seconds. */
			at: number;
			verb: 'key';
			/** The key's `KeyboardEvent.code` name, such as `KeyW` or `Space`. */
			code: string;
			/** True for a press, false for a release. */
			down: boolean;
	  }
	| {
			/** The sketch time of the step, in seconds. */
			at: number;
			verb: 'pointer';
			/** What the pointer does: move, press, release, or scroll the wheel. */
			action: 'move' | 'down' | 'up' | 'wheel';
			/** The pointer's distance from the canvas's left edge, in CSS pixels, or where it is. */
			x?: number;
			/** The pointer's distance from the canvas's top edge, in CSS pixels, or where it is. */
			y?: number;
	  }
	| {
			/** The sketch time of the step, in seconds. */
			at: number;
			verb: 'set';
			/** The object's name, or `#camera` for the scene's active camera. */
			target: string;
			/** The property path that `animateProperty` takes, such as `position` or `fov`. */
			path: string;
			/** The value's numbers: three for a position, four for a rotation, one for a flag. */
			value: readonly number[];
	  }
	| {
			/** The sketch time of the step, in seconds. */
			at: number;
			verb: 'dump';
			/** The object's name, or `#camera` for the scene's active camera. */
			target: string;
			/** One property path to record, or every property of the object when it is absent. */
			path?: string;
	  };

/**
 * A timed script that hold mode performs: its steps, in time order.
 *
 * @category api/engine
 */
export interface HoldScript {
	/** The steps of the script, in time order, with the sketch time at which each one happens. */
	steps: readonly HoldScriptStep[];
}

/**
 * What a dump step read from its target.
 *
 * @category api/engine
 */
export interface HoldDump {
	/** The sketch time of the step, in seconds. */
	at: number;
	/** The target as the step named it. */
	target: string;
	/** The property path, when the step named one. */
	path?: string;
	/** The property's numbers, or the object's properties by name. */
	value: readonly number[] | Readonly<Record<string, unknown>>;
}

/**
 * A script step that failed, with the reason in plain words.
 *
 * @category api/engine
 */
export interface HoldScriptProblem {
	/** The sketch time of the step, in seconds. */
	at: number;
	/** The step as it was written, such as `set "cr".position`. */
	step: string;
	/** Why the step failed, such as why a target is not in the scene. */
	error: string;
}

/**
 * What the steps of a timed script gave while hold mode performed it.
 *
 * @category api/engine
 */
export interface HoldScriptResult {
	/** What each dump step read. */
	dumps: HoldDump[];
	/** The steps that failed, in time order. */
	problems: HoldScriptProblem[];
}

/** Reads the timed script that a test tool set before the page loaded, if it set one. */
export function holdScript(): HoldScript | undefined {
	const value = (globalThis as Record<string, unknown>)[HOLD_SCRIPT_GLOBAL];
	if (value === undefined || value === null) return undefined;
	return value as HoldScript;
}

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
	/**
	 * True when the engine drew the frame with the direct-draw path, which culls buckets on the CPU
	 * and draws each one directly. False otherwise, as on WebGL2, which always draws directly.
	 */
	directDraws: boolean;
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
	/**
	 * What a timed script's dump steps read, and the steps that failed, when the page gave a script.
	 * A step that failed stops no hold: the tool that gave the script decides what a failure means.
	 */
	script?: HoldScriptResult;
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
