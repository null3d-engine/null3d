// The frame-budget governor. When frames take too long, it lowers the live settings one step at a
// time, in a fixed order: the render scale first, then how often far shadow cascades draw, then the
// shadow filter, then bloom's samples. When the frames have time to spare again, it raises them in
// the reverse order. It never changes a setting that is fixed while a preset runs.
//
// The render scale is a part of the canvas's width and height, in whole thousandths, which the core
// turns into an exact size in pixels. Scene passes draw into that corner of targets the size of the
// canvas, and the final pass scales it up to the canvas, so a new scale makes no GPU object. The
// shadow steps are numbers in a uniform and a schedule, and bloom's samples numbers in a uniform,
// so they make none either.
//
// The governor judges the frames in windows of a quarter second. It takes a step down after about a
// second over the frame budget, and a step up only after several seconds in which the frames kept
// their rate on average and the GPU finished each within about one frame. After each step it waits
// for the frames of the new setting before it judges again. A step up that takes the frames over the
// budget doubles the wait before the next step up, so the settings settle below the point where the
// frames fall behind instead of swinging across it. A shadow step happens only where the scene has a light
// that casts shadows, and only where the step changes what the frame draws: the far cascades need a
// directional light with two cascades or more, and the filter any light that casts shadows. A
// bloom step happens only while the sketch has bloom on: each halves the taps of bloom's blurs.
//
// The frame loop calls it once per frame, and it allocates nothing. The governor judges only a few
// times a second, so the browser may never optimize it, and unoptimized code makes a number object
// for each fraction. So it works in whole numbers alone: clock times in whole ms, and frame times in
// whole microseconds, in typed arrays of 32-bit integers.

import { SHADOW_CASTERS_CASCADE_MASK, SHADOW_CASTERS_TILES } from '../generated/core';
import {
	RefreshRate,
	RingSums,
	SUM_BUSY_MS,
	SUM_INTERVAL_MS,
	SUM_RECORDS,
} from '../shared/metrics';
import * as Role from '../shared/role';
import { QUALITY_SETTINGS } from './presets';

/** The render scale of the whole canvas, in thousandths. */
export const FULL_SCALE = 1000;
/** How far one step moves the render scale, in thousandths. */
export const SCALE_STEP = 50;

/** The render scale in thousandths of a scale from 0 to 1, rounded, from 1 to the whole canvas. */
export function thousandths(scale: number): number {
	return Math.min(FULL_SCALE, Math.max(1, Math.round(scale * FULL_SCALE)));
}

/** The longest interval between two draws of a far shadow cascade, in frames. */
export const LONGEST_FAR_INTERVAL = QUALITY_SETTINGS.farCascadeInterval.values.max;
/** The lightest shadow filter, in texels on each side. */
export const LIGHTEST_FILTER = QUALITY_SETTINGS.shadowFilter.values[0];
/** The fewest of three.js's taps that bloom's blurs read: one in this many. */
export const LONGEST_BLOOM_DIVISOR = 1 / QUALITY_SETTINGS.bloomSamples.values[0];

/**
 * The divisor of bloom's taps for a share of them from the `bloomSamples` setting: 1 for all of
 * them, 2 for half, 4 for a quarter.
 */
export function bloomDivisor(samples: number): number {
	return Math.min(LONGEST_BLOOM_DIVISOR, Math.max(1, Math.round(1 / samples)));
}

/**
 * The governor's steps of the far cascades' interval from `interval` on: each step doubles it, up to
 * the longest interval.
 */
export function farIntervalSteps(interval: number): number {
	let steps = 0;
	for (let value = interval; value < LONGEST_FAR_INTERVAL; value *= 2) steps++;
	return steps;
}

/** How long one window of frames lasts, in ms. */
export const WINDOW_MS = 250;
/** How long the frames stay over the budget before a step down, in ms. */
export const DROP_AFTER_MS = 1000;
/** How long the frames keep room to spare before the first step up, in ms. */
export const RAISE_AFTER_MS = 5000;
/** The longest wait before a step up, however often steps up failed, in ms. */
export const LONGEST_RAISE_AFTER_MS = 80_000;
/** How long after a step the governor waits before it judges the frames again, in ms. */
export const SETTLE_MS = 1000;
/** How soon after a step up a step down counts as the step up's failure, in ms. */
export const FAILED_RAISE_MS = SETTLE_MS + 2 * DROP_AFTER_MS;
/** How long after the first frame the governor takes no step, in ms. */
export const GRACE_MS = 2000;
/** A gap between frames this long, as after a pause, starts the windows again, in ms. */
export const GAP_MS = 500;
/** The highest frame rate the governor aims for, in hertz. */
export const MAX_TARGET_HZ = 60;
/** Frames whose time is this percentage of the budget or more are over it. */
export const OVER_PERCENT = 110;
/** A GPU delay of this percentage of the budget or more means that frames queue on the GPU. */
export const QUEUED_PERCENT = 200;
/**
 * Frames have room when their mean time since the room started is within this percentage of the
 * budget, and each window's GPU delay is within `ROOM_DELAY_PERCENT`. The mean covers the whole
 * stretch, not each window: where callbacks come from a timer that does not divide the display's
 * period, as in Safari's workers, every 15th frame or so waits two callbacks, and a quarter second
 * holds one or two such gaps. Window by window, the frames at the full rate then measured 97% to
 * 105% of the budget.
 */
export const ROOM_PERCENT = 102;
/**
 * A GPU delay within this percentage of the budget means that the GPU finishes each frame within
 * about one. A WebGL2 fence's time rounds up to the next frame callback, so a lower figure would
 * never show room there.
 */
export const ROOM_DELAY_PERCENT = 125;

// The figures of one window of frames, by index in `Governor.window`.
/** The time at the window's end, in whole ms. */
export const WINDOW_END = 0;
/** The window's frame time: the longer of the mean presented and completed intervals, in µs. */
export const FRAME_US = 1;
/** The mean time from a frame's submit until the GPU finished it, in µs, or 0 when none finished. */
export const GPU_DELAY_US = 2;
/** The frame budget: the interval of the target frame rate, in µs. */
export const BUDGET_US = 3;

// The governor's times, by index in its state, in whole ms. -1 marks one that has not happened.
const OVER_SINCE = 0;
const ROOM_SINCE = 1;
const JUDGE_FROM = 2;
const RAISE_AFTER = 3;
const RAISED_AT = 4;
/** The windows since the room started. */
const ROOM_WINDOWS = 5;
/** Their frame times less the budget, summed, in µs. */
const ROOM_EXCESS_US = 6;
const STATE_SIZE = 7;

/**
 * The governor's rules, over windows of frame figures. The frame loop, or a test, fills `window`
 * and calls `judge` once per window. The settings and the scene's shadows set the steps it can take.
 */
export class Governor {
	/** The render scale in thousandths. */
	scale = FULL_SCALE;
	/** The lowest render scale in thousandths. */
	low = FULL_SCALE;
	/** The highest render scale in thousandths. */
	high = FULL_SCALE;
	/** The steps past the render scale that the governor has taken: 0 while the settings apply as set. */
	steps = 0;
	/** The far cascades' interval that frames draw with: the setting's, or longer after a step. */
	farInterval = 1;
	/** The shadow filter that frames draw with: the setting's, or the lightest after a step. */
	filter: number = LIGHTEST_FILTER;
	/** How many times fewer taps than three.js's bloom's blurs read: the setting's, or more after a step. */
	bloomDivisor = 1;
	/** Counts each change of `farInterval`, `filter` or `bloomDivisor`, so the frame loop applies them. */
	stepChanges = 0;
	/** False while the governor is off: the scale stays at the highest and the settings as set. */
	on = true;
	/** The figures of the window to judge, by the `WINDOW_END` to `BUDGET_US` indices. */
	readonly window = new Int32Array(BUDGET_US + 1);
	private readonly state = new Int32Array(STATE_SIZE);
	/** The settings that the shadow steps start from. */
	private intervalSetting = 1;
	private filterSetting: number = LIGHTEST_FILTER;
	/** The cascades of the main directional light's shadows, or 0 for none. */
	private cascades = 0;
	/** True when point or spot lights cast shadows, which the filter's step lightens too. */
	private tiles = false;
	/** The divisor of bloom's taps that the bloom steps start from, and whether bloom is on. */
	private bloomSetting = 1;
	private bloom = false;

	constructor() {
		this.restart(0);
		this.state[RAISE_AFTER] = RAISE_AFTER_MS;
		this.state[RAISED_AT] = -1;
	}

	/**
	 * Sets the range of the render scale, in thousandths, from `low` to `high`, and brings the scale
	 * into it. The scale starts at the highest.
	 */
	setRange(low: number, high: number): void {
		this.low = low;
		this.high = high;
		this.scale = this.on ? Math.min(high, Math.max(low, this.scale)) : high;
	}

	/** Sets the shadow settings that the shadow steps start from. */
	setShadows(filter: number, interval: number): void {
		this.filterSetting = filter;
		this.intervalSetting = interval;
		this.applySteps();
	}

	/**
	 * Sets what casts shadows in the scene: the main directional light's cascades, or 0 when it
	 * casts none, and with `tiles`, point or spot lights. The far cascades' steps need two cascades
	 * or more, and the filter's step any shadows.
	 */
	setCasters(cascades: number, tiles: boolean): void {
		if (cascades === this.cascades && tiles === this.tiles) return;
		this.cascades = cascades;
		this.tiles = tiles;
		this.applySteps();
	}

	/**
	 * Sets the divisor of bloom's taps that the bloom steps start from, and whether the sketch has
	 * bloom on, which the steps need.
	 */
	setBloom(on: boolean, divisor: number): void {
		if (on === this.bloom && divisor === this.bloomSetting) return;
		this.bloom = on;
		this.bloomSetting = divisor;
		this.applySteps();
	}

	/** Turns the governor on or off. Off, the scale goes to the highest and the settings apply as set. */
	setOn(on: boolean): void {
		this.on = on;
		if (on) return;
		this.scale = this.high;
		this.steps = 0;
		this.applySteps();
	}

	/** The steps past the render scale that the scene's shadows, bloom and the settings allow. */
	get maxSteps(): number {
		return this.intervalSteps() + this.filterSteps() + this.bloomSteps();
	}

	/**
	 * Forgets the frames before `from`, a time in whole ms: no step before it, and no window over or
	 * under the budget yet. The frame loop calls it at the first frame, as the grace starts, after a
	 * pause, and while the scene loads.
	 */
	restart(from: number): void {
		const { state } = this;
		state[OVER_SINCE] = -1;
		state[ROOM_SINCE] = -1;
		state[JUDGE_FROM] = from;
	}

	/** Judges the window in `window`, and takes one step when the rules say so. */
	judge(): void {
		const { window, state } = this;
		const now = window[WINDOW_END] as number;
		if (!this.on || now < (state[JUDGE_FROM] as number)) return;
		const budget = window[BUDGET_US] as number;
		const frame = window[FRAME_US] as number;
		const delay = window[GPU_DELAY_US] as number;
		const over = frame * 100 >= budget * OVER_PERCENT || delay * 100 >= budget * QUEUED_PERCENT;
		const calm = !over && delay * 100 <= budget * ROOM_DELAY_PERCENT;
		if (!over) state[OVER_SINCE] = -1;
		else if ((state[OVER_SINCE] as number) < 0) state[OVER_SINCE] = now - WINDOW_MS;
		if (!calm) state[ROOM_SINCE] = -1;
		else if ((state[ROOM_SINCE] as number) < 0) this.startRoom(now);
		const overSince = state[OVER_SINCE] as number;
		if (over && now - overSince >= DROP_AFTER_MS) {
			this.lower(now);
			return;
		}
		if (!calm) return;
		const windows = (state[ROOM_WINDOWS] as number) + 1;
		const excess = (state[ROOM_EXCESS_US] as number) + frame - budget;
		state[ROOM_WINDOWS] = windows;
		state[ROOM_EXCESS_US] = excess;
		if (now - (state[ROOM_SINCE] as number) < (state[RAISE_AFTER] as number)) return;
		if (excess * 100 <= windows * budget * (ROOM_PERCENT - 100)) this.raise(now);
		else {
			// The frames ran a little long over the wait: it starts again, so that frames which
			// have room later are judged on their own.
			this.startRoom(now);
			state[ROOM_WINDOWS] = 1;
			state[ROOM_EXCESS_US] = frame - budget;
		}
	}

	/** Starts the room's stretch at the window that ends at `now`, with no window summed yet. */
	private startRoom(now: number): void {
		const { state } = this;
		state[ROOM_SINCE] = now - WINDOW_MS;
		state[ROOM_WINDOWS] = 0;
		state[ROOM_EXCESS_US] = 0;
	}

	/**
	 * One step down: the render scale while it is above the lowest, then the shadow steps. When it
	 * undoes a recent step up, the next step up waits twice as long as that one did. Otherwise the
	 * frames got heavier, and the wait starts again from its shortest.
	 */
	private lower(now: number): void {
		const { state } = this;
		let moved = true;
		if (this.scale > this.low) this.scale = Math.max(this.low, this.scale - SCALE_STEP);
		else if (this.steps < this.maxSteps) this.moveSteps(1);
		else moved = false;
		if (moved) {
			const raisedAt = state[RAISED_AT] as number;
			const failed = raisedAt >= 0 && now - raisedAt <= FAILED_RAISE_MS;
			state[RAISE_AFTER] = failed
				? Math.min(LONGEST_RAISE_AFTER_MS, (state[RAISE_AFTER] as number) * 2)
				: RAISE_AFTER_MS;
			state[RAISED_AT] = -1;
		}
		this.settle(moved, now);
	}

	/** One step up: the bloom and shadow steps back first, then the render scale. */
	private raise(now: number): void {
		let moved = true;
		if (this.steps > 0) this.moveSteps(-1);
		else if (this.scale < this.high) this.scale = Math.min(this.high, this.scale + SCALE_STEP);
		else moved = false;
		if (moved) this.state[RAISED_AT] = now;
		this.settle(moved, now);
	}

	/**
	 * After a step, waits for the frames of the new setting. At the end of the steps the settings
	 * stay, and the windows start again, so the frames are judged afresh.
	 */
	private settle(moved: boolean, now: number): void {
		this.restart(moved ? now + SETTLE_MS : now);
	}

	private moveSteps(by: number): void {
		this.steps += by;
		this.applySteps();
	}

	/** The far cascades' steps: none without far cascades. */
	private intervalSteps(): number {
		return this.cascades > 1 ? farIntervalSteps(this.intervalSetting) : 0;
	}

	/** The filter's step: one where shadows filter with more than the lightest filter. */
	private filterSteps(): number {
		return (this.cascades > 0 || this.tiles) && this.filterSetting > LIGHTEST_FILTER ? 1 : 0;
	}

	/** Bloom's steps while it is on: each doubles the divisor of its taps, up to the longest. */
	private bloomSteps(): number {
		let steps = 0;
		if (this.bloom)
			for (let divisor = this.bloomSetting; divisor < LONGEST_BLOOM_DIVISOR; divisor *= 2) steps++;
		return steps;
	}

	/**
	 * Brings the steps within what the settings and the scene allow, and works out the settings
	 * that frames draw with: the far cascades' interval doubles with each of its steps, the filter
	 * takes the lightest after them, and then bloom's divisor doubles with each of its steps.
	 */
	private applySteps(): void {
		const intervalSteps = this.intervalSteps();
		const shadowSteps = intervalSteps + this.filterSteps();
		this.steps = Math.min(this.steps, shadowSteps + this.bloomSteps());
		const doublings = Math.min(this.steps, intervalSteps);
		const farInterval = Math.min(LONGEST_FAR_INTERVAL, this.intervalSetting * 2 ** doublings);
		const filter = this.steps > intervalSteps ? LIGHTEST_FILTER : this.filterSetting;
		const bloomDivisor = this.bloomSetting * 2 ** Math.max(0, this.steps - shadowSteps);
		if (
			farInterval === this.farInterval &&
			filter === this.filter &&
			bloomDivisor === this.bloomDivisor
		)
			return;
		this.farInterval = farInterval;
		this.filter = filter;
		this.bloomDivisor = bloomDivisor;
		this.stepChanges++;
	}
}

/** What the governor reads from the scene, once per window of frames. */
export interface GovernorScene {
	/**
	 * What casts shadows: the main directional light's cascades in the bits of
	 * `SHADOW_CASTERS_CASCADE_MASK`, and `SHADOW_CASTERS_TILES` when point or spot lights do.
	 */
	shadowCasters(): number;
	/** True while the scene loads, as when textures wait to upload: the governor takes no step. */
	loading(): boolean;
}

/**
 * The governor in the frame loop: it sums the presented and completed frames that the metrics
 * rings receive, and hands each window's figures to the governor.
 */
export class GovernorLoop {
	/** The frame loop's clock reading at the start of the frame, in ms, which it writes first. */
	readonly now = new Float64Array(1);
	private readonly presented: RingSums;
	private readonly completed: RingSums;
	private readonly refresh: RefreshRate;
	/** The highest frame rate the governor aims for, in hertz: `MAX_TARGET_HZ`, or less under ?fps=. */
	private readonly targetHz: number;
	/** The window's start and the last frame's time, in ms, or -1 before the first frame. */
	private readonly times = new Float64Array([-1, -1]);

	/** `fps` is the frame rate that ?fps= holds, or undefined where the display's rate sets it. */
	constructor(
		readonly governor: Governor,
		metrics: ArrayBufferLike,
		private readonly scene: GovernorScene,
		fps?: number,
	) {
		this.presented = new RingSums(metrics, Role.Render);
		this.completed = new RingSums(metrics, Role.Completion);
		this.refresh = new RefreshRate(metrics);
		this.targetHz = Math.min(fps ?? MAX_TARGET_HZ, MAX_TARGET_HZ);
	}

	/**
	 * Takes in the frames since the last call, and judges them at the end of each window. The
	 * frame loop writes the frame's clock reading into `now` first. While the governor is off, it
	 * does nothing.
	 */
	frame(): void {
		const { times, presented, completed, governor } = this;
		// Off, the governor judges nothing. Turned on again, it starts as at the first frame.
		if (!governor.on) {
			times[1] = -1;
			return;
		}
		const now = this.now[0] as number;
		presented.add();
		completed.add();
		const last = times[1] as number;
		times[1] = now;
		if (last < 0 || now - last >= GAP_MS) {
			// The first frame, or the first after a pause: the windows start again from here.
			governor.restart(Math.round(now) + (last < 0 ? GRACE_MS : 0));
		} else {
			if (now - (times[0] as number) < WINDOW_MS) return;
			const casters = this.scene.shadowCasters();
			governor.setCasters(
				casters & SHADOW_CASTERS_CASCADE_MASK,
				(casters & SHADOW_CASTERS_TILES) !== 0,
			);
			// The window's figures turn into whole numbers here, in code that runs every frame and
			// so gets optimized, before the governor judges them.
			const shown = presented.sums;
			const done = completed.sums;
			const shownFrames = shown[SUM_RECORDS] as number;
			const doneFrames = done[SUM_RECORDS] as number;
			if (this.scene.loading()) governor.restart(Math.round(now));
			else if (shownFrames > 0) {
				const window = governor.window;
				const shownMs = (shown[SUM_INTERVAL_MS] as number) / shownFrames;
				const doneMs = doneFrames > 0 ? (done[SUM_INTERVAL_MS] as number) / doneFrames : 0;
				const delayMs = doneFrames > 0 ? (done[SUM_BUSY_MS] as number) / doneFrames : 0;
				const hz = this.refresh.hz;
				const target = this.targetHz;
				window[WINDOW_END] = Math.round(now);
				window[FRAME_US] = Math.round(Math.max(shownMs, doneMs) * 1000);
				window[GPU_DELAY_US] = Math.round(delayMs * 1000);
				window[BUDGET_US] = Math.round(1_000_000 / (hz > 0 ? Math.min(hz, target) : target));
				governor.judge();
			}
		}
		// A new window starts at this frame.
		times[0] = now;
		presented.clear();
		completed.clear();
	}
}
