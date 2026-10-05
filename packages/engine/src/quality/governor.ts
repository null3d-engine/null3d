// The frame-budget governor. When frames take too long, it lowers the live settings one step at a
// time, in a fixed order: the render scale first, then how often far shadow cascades draw, then the
// shadow filter, then bloom's base, then ambient occlusion's scale. When the frames have time to
// spare again, it raises them in the reverse order. It never changes a setting that is fixed while
// a preset runs.
//
// The render scale is a part of the canvas's width and height, in whole thousandths, which the core
// turns into an exact size in pixels. Scene passes draw into that corner of targets the size of the
// canvas, and the final pass scales it up to the canvas, so a new scale makes no GPU object. The
// shadow steps are numbers in a uniform and a schedule, and bloom's base and ambient occlusion's
// scale corners of the same targets, so they make none either.
//
// The governor judges the frames in windows of a quarter second. It takes a step down when the
// frames of the last second, on average, missed the line at which the benchmark reports count a
// second as holding the target rate. It takes a step up only after several seconds in which the
// frames kept their rate on average and the GPU finished each within about one frame. After each
// step it waits for the frames of the new setting before it judges again. A step up is on trial for
// a while, and a step down from its setting in that time doubles the wait before the next step up
// into that setting. Each setting keeps its own wait, so the settings settle below the point where
// the frames fall behind instead of swinging across it, while steps up into other settings stay
// quick. A shadow step happens only where the scene has a light that casts shadows, and only where
// the step changes what the frame draws: the far cascades need a directional light with two
// cascades or more, and the filter any light that casts shadows. A bloom step happens only while
// the sketch has bloom on, above the smallest base: it halves the base, and the chain drops its
// narrowest level, so the glow keeps its size. The ambient occlusion step happens only while it
// draws at half the render size: it draws at a quarter.
//
// The frame loop calls it once per frame, and it allocates nothing. The governor judges only a few
// times a second, so the browser may never optimize it. Unoptimized code makes a number object for
// each fraction, for each number it reads from a typed array of floats, and for each whole number
// past 31 bits. So the governor works in small whole numbers alone, in typed arrays of 32-bit
// integers: frame times in whole microseconds, and clock times in whole ms from an origin that the
// frame loop moves forward while the page runs.

import { SHADOW_CASTERS_CASCADE_MASK, SHADOW_CASTERS_TILES } from '../generated/core';
import {
	RefreshRate,
	RingSums,
	SUM_BUSY_MS,
	SUM_INTERVAL_MS,
	SUM_RECORDS,
} from '../shared/metrics';
import * as Role from '../shared/role';
import { HELD_PERCENT, TARGET_CAP_HZ } from '../shared/stats';
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
/** The smallest base of bloom's chain, in texels on the short side, which its step stops above. */
export const SMALLEST_BLOOM_SIZE = QUALITY_SETTINGS.bloomSize.values[0];

/** The smallest scale of ambient occlusion's targets above none, in thousandths of the render size. */
export const LOWEST_AO_SCALE = thousandths(QUALITY_SETTINGS.aoScale.values[1]);

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
/** The stretch of frames that a step down judges, in ms: the last second, as the reports count. */
export const DROP_AFTER_MS = 1000;
/** The windows of that stretch. */
const DROP_WINDOWS = DROP_AFTER_MS / WINDOW_MS;
/** How long the frames keep room to spare before the first step up, in ms. */
export const RAISE_AFTER_MS = 5000;
/** The longest wait before a step up, however often steps up into its setting failed, in ms. */
export const LONGEST_RAISE_AFTER_MS = 80_000;
/** How long after a step the governor waits before it judges the frames again, in ms. */
export const SETTLE_MS = 1000;
/**
 * How long a step up is on trial, in ms: a step down from its setting within this time counts as
 * its failure. On the iPad, heat made a step up that held the target at first fail 9 to 15 seconds
 * later.
 */
export const FAILED_RAISE_MS = 30_000;
/** How long after the first frame the governor takes no step, in ms. */
export const GRACE_MS = 2000;
/** A gap between frames this long, as after a pause, starts the windows again, in ms. */
export const GAP_MS = 500;
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
/**
 * The governor's clock moves its origin forward when it reaches this time, in ms: about 6 days, well
 * within the 31 bits of a whole number that the browser keeps without a number object.
 */
export const CLOCK_LIMIT_MS = 2 ** 29;
/**
 * The clock's time after its origin moves, in ms. It is longer than any span that the rules compare,
 * so a time older than the new origin can take the origin's place and every verdict stays the same.
 */
const CLOCK_KEPT_MS = 2 * LONGEST_RAISE_AFTER_MS;

// The figures of one window of frames, by index in `Governor.window`.
/** The time at the window's end, in whole ms of the governor's clock. */
export const WINDOW_END = 0;
/** The window's frame time: the longer of the mean presented and completed intervals, in µs. */
export const FRAME_US = 1;
/** The mean time from a frame's submit until the GPU finished it, in µs, or 0 when none finished. */
export const GPU_DELAY_US = 2;
/** The frame budget: the interval of the target frame rate, in µs. */
export const BUDGET_US = 3;

// The governor's times, by index in its state, in whole ms of its clock. -1 marks one that has not
// happened.
const ROOM_SINCE = 0;
const JUDGE_FROM = 1;
/** The windows since the room started. */
const ROOM_WINDOWS = 2;
/** Their frame times less the budget, summed, in µs. */
const ROOM_EXCESS_US = 3;
/** The windows judged since the windows started again, up to `DROP_WINDOWS`. */
const RECENT_WINDOWS = 4;
/** The slot in `recent` that the next window takes. */
const RECENT_SLOT = 5;
const STATE_SIZE = 6;

/**
 * The governor's levels: 0 at the highest scale with the settings as set, and one more for each
 * step down. They cover every scale of the widest range and every step past the scale.
 */
const LEVELS = FULL_SCALE / SCALE_STEP + 1 + farIntervalSteps(1) + 1 + 1 + 1;

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
	/** The halvings of bloom's base during play: 0 with the setting as set, or 1 after its step. */
	bloomHalvings = 0;
	/**
	 * The scale of ambient occlusion's targets in thousandths of the render size: the setting's, or
	 * the lowest above none after a step.
	 */
	aoScale = 0;
	/**
	 * Counts each change of `farInterval`, `filter`, `bloomHalvings` or `aoScale`, so the frame loop
	 * applies them.
	 */
	stepChanges = 0;
	/** False while the governor is off: the scale stays at the highest and the settings as set. */
	on = true;
	/** The figures of the window to judge, by the `WINDOW_END` to `BUDGET_US` indices. */
	readonly window = new Int32Array(BUDGET_US + 1);
	private readonly state = new Int32Array(STATE_SIZE);
	/** The frame times of the last `DROP_WINDOWS` windows, then their GPU delays, in µs. */
	private readonly recent = new Int32Array(2 * DROP_WINDOWS);
	/** By level: the time of the step up into it that is still on trial, in whole ms, or -1. */
	private readonly raisedAt = new Int32Array(LEVELS);
	/** By level: how long the frames keep room before a step up into it, in ms. */
	private readonly raiseAfter = new Int32Array(LEVELS);
	/** The settings that the shadow steps start from. */
	private intervalSetting = 1;
	private filterSetting: number = LIGHTEST_FILTER;
	/** The cascades of the main directional light's shadows, or 0 for none. */
	private cascades = 0;
	/** True when point or spot lights cast shadows, which the filter's step lightens too. */
	private tiles = false;
	/** The base of bloom's chain that its step halves, and whether bloom is on. */
	private bloomSetting: number = SMALLEST_BLOOM_SIZE;
	private bloom = false;
	/** The scale of ambient occlusion that its step starts from, and whether it is on. */
	private aoSetting = 0;
	private ao = false;

	constructor() {
		this.restart(0);
		this.forgetTrials();
	}

	/**
	 * Sets the range of the render scale, in thousandths, from `low` to `high`, and brings the scale
	 * into it. The scale starts at the highest. A new range gives the levels new settings, so the
	 * governor forgets their trials.
	 */
	setRange(low: number, high: number): void {
		if (low !== this.low || high !== this.high) this.forgetTrials();
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
	 * Sets the base of bloom's chain that its step halves, in texels on the short side, and whether
	 * the sketch has bloom on, which the step needs.
	 */
	setBloom(on: boolean, size: number): void {
		if (on === this.bloom && size === this.bloomSetting) return;
		this.bloom = on;
		this.bloomSetting = size;
		this.applySteps();
	}

	/**
	 * Sets the scale of ambient occlusion's targets that its step starts from, in thousandths, and
	 * whether the sketch has it on, which the step needs.
	 */
	setAo(on: boolean, scale: number): void {
		if (on === this.ao && scale === this.aoSetting) return;
		this.ao = on;
		this.aoSetting = scale;
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

	/**
	 * The steps past the render scale that the scene's shadows, bloom, ambient occlusion and the
	 * settings allow.
	 */
	get maxSteps(): number {
		return this.intervalSteps() + this.filterSteps() + this.bloomSteps() + this.aoSteps();
	}

	/**
	 * Forgets the frames before `from`, a time in whole ms: no step before it, and no window over or
	 * under the budget yet. The frame loop calls it at the first frame, as the grace starts, after a
	 * pause, and while the scene loads. It never moves the first judgement earlier: a stall within
	 * the grace or the wait after a step leaves the rest of it.
	 */
	restart(from: number): void {
		const { state } = this;
		state[ROOM_SINCE] = -1;
		state[JUDGE_FROM] = Math.max(from, state[JUDGE_FROM] as number);
		state[RECENT_WINDOWS] = 0;
	}

	/**
	 * Moves the clock's origin `by` ms forward: each time that the governor holds moves back by as
	 * much. A time from before the new origin takes the origin's place, which the frame loop keeps
	 * longer ago than any span that the rules compare.
	 */
	moveOrigin(by: number): void {
		const { state, raisedAt } = this;
		state[ROOM_SINCE] = earlier(state[ROOM_SINCE] as number, by);
		state[JUDGE_FROM] = earlier(state[JUDGE_FROM] as number, by);
		for (let level = 0; level < LEVELS; level++)
			raisedAt[level] = earlier(raisedAt[level] as number, by);
	}

	/** Judges the window in `window`, and takes one step when the rules say so. */
	judge(): void {
		const { window, state } = this;
		const now = window[WINDOW_END] as number;
		if (!this.on || now < (state[JUDGE_FROM] as number)) return;
		const budget = window[BUDGET_US] as number;
		const frame = window[FRAME_US] as number;
		const delay = window[GPU_DELAY_US] as number;
		if (this.missed(frame, delay, budget)) {
			this.lower(now);
			return;
		}
		const calm = delay * 100 <= budget * ROOM_DELAY_PERCENT;
		if (!calm) {
			state[ROOM_SINCE] = -1;
			return;
		}
		if ((state[ROOM_SINCE] as number) < 0) this.startRoom(now);
		const windows = (state[ROOM_WINDOWS] as number) + 1;
		const excess = (state[ROOM_EXCESS_US] as number) + frame - budget;
		state[ROOM_WINDOWS] = windows;
		state[ROOM_EXCESS_US] = excess;
		const wait = this.raiseAfter[Math.max(0, this.level() - 1)] as number;
		if (now - (state[ROOM_SINCE] as number) < wait) return;
		if (excess * 100 <= windows * budget * (ROOM_PERCENT - 100)) this.raise(now);
		else {
			// The frames ran a little long over the wait: it starts again, so that frames which
			// have room later are judged on their own.
			this.startRoom(now);
			state[ROOM_WINDOWS] = 1;
			state[ROOM_EXCESS_US] = frame - budget;
		}
	}

	/**
	 * Adds a window to the last second's, and tells whether that second missed the target. It
	 * missed when its frames, on average, came slower than the benchmark reports' line for a second
	 * that holds the target rate, and no window of it had room. A lower setting does not help a
	 * short stall amid frames at the target rate, so such a stall alone takes no step. The second
	 * missed too when every window of it queued on the GPU. Only a whole second of windows since the
	 * windows started again can miss.
	 */
	private missed(frame: number, delay: number, budget: number): boolean {
		const { state, recent } = this;
		const slot = state[RECENT_SLOT] as number;
		recent[slot] = frame;
		recent[DROP_WINDOWS + slot] = delay;
		state[RECENT_SLOT] = (slot + 1) % DROP_WINDOWS;
		const windows = Math.min(DROP_WINDOWS, (state[RECENT_WINDOWS] as number) + 1);
		state[RECENT_WINDOWS] = windows;
		if (windows < DROP_WINDOWS) return false;
		let frames = 0;
		let fastest = recent[0] as number;
		let leastDelay = recent[DROP_WINDOWS] as number;
		for (let k = 0; k < DROP_WINDOWS; k++) {
			const time = recent[k] as number;
			frames += time;
			fastest = Math.min(fastest, time);
			leastDelay = Math.min(leastDelay, recent[DROP_WINDOWS + k] as number);
		}
		// The rate holds the target while it is at least the held share of it, so the mean frame
		// time misses it once it is longer than the budget over that share.
		const slow =
			frames * HELD_PERCENT > DROP_WINDOWS * budget * 100 && fastest * 100 > budget * ROOM_PERCENT;
		return slow || leastDelay * 100 >= budget * QUEUED_PERCENT;
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
	 * leaves a level whose step up is still on trial, the next step up into that level waits twice
	 * as long as that one did. Otherwise the level held, and the frames got heavier, so its wait
	 * starts again from its shortest.
	 */
	private lower(now: number): void {
		const left = this.level();
		let moved = true;
		if (this.scale > this.low) this.scale = Math.max(this.low, this.scale - SCALE_STEP);
		else if (this.steps < this.maxSteps) this.moveSteps(1);
		else moved = false;
		if (moved) {
			const { raisedAt, raiseAfter } = this;
			const raised = raisedAt[left] as number;
			raiseAfter[left] =
				raised >= 0 && now - raised <= FAILED_RAISE_MS
					? Math.min(LONGEST_RAISE_AFTER_MS, (raiseAfter[left] as number) * 2)
					: RAISE_AFTER_MS;
			raisedAt[left] = -1;
		}
		this.settle(moved, now);
	}

	/** One step up: the ambient occlusion, bloom and shadow steps back first, then the render scale. */
	private raise(now: number): void {
		let moved = true;
		if (this.steps > 0) this.moveSteps(-1);
		else if (this.scale < this.high) this.scale = Math.min(this.high, this.scale + SCALE_STEP);
		else moved = false;
		if (moved) this.raisedAt[this.level()] = now;
		this.settle(moved, now);
	}

	/**
	 * The level that the frames draw at: the scale's steps below the highest, rounded up, then the
	 * steps past the scale.
	 */
	private level(): number {
		const below = this.high - this.scale;
		const rest = below % SCALE_STEP;
		const scaleSteps = (below - rest) / SCALE_STEP + (rest > 0 ? 1 : 0);
		return Math.min(LEVELS - 1, scaleSteps + this.steps);
	}

	/** Forgets every level's trial: no step up on trial, and the shortest wait before each. */
	private forgetTrials(): void {
		this.raisedAt.fill(-1);
		this.raiseAfter.fill(RAISE_AFTER_MS);
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

	/** Bloom's step while it is on above the smallest base: it halves the base. */
	private bloomSteps(): number {
		return this.bloom && this.bloomSetting > SMALLEST_BLOOM_SIZE ? 1 : 0;
	}

	/** Ambient occlusion's step while it draws above the lowest scale: to the lowest. */
	private aoSteps(): number {
		return this.ao && this.aoSetting > LOWEST_AO_SCALE ? 1 : 0;
	}

	/**
	 * Brings the steps within what the settings and the scene allow, and works out the settings
	 * that frames draw with: the far cascades' interval doubles with each of its steps, the filter
	 * takes the lightest after them, then bloom's base halves, and last ambient occlusion takes its
	 * lowest scale.
	 */
	private applySteps(): void {
		const intervalSteps = this.intervalSteps();
		const shadowSteps = intervalSteps + this.filterSteps();
		const bloomSteps = this.bloomSteps();
		this.steps = Math.min(this.steps, shadowSteps + bloomSteps + this.aoSteps());
		const doublings = Math.min(this.steps, intervalSteps);
		const farInterval = Math.min(LONGEST_FAR_INTERVAL, this.intervalSetting << doublings);
		const filter = this.steps > intervalSteps ? LIGHTEST_FILTER : this.filterSetting;
		const bloomHalvings = Math.min(bloomSteps, Math.max(0, this.steps - shadowSteps));
		const aoScale = this.steps > shadowSteps + bloomSteps ? LOWEST_AO_SCALE : this.aoSetting;
		if (
			farInterval === this.farInterval &&
			filter === this.filter &&
			bloomHalvings === this.bloomHalvings &&
			aoScale === this.aoScale
		)
			return;
		this.farInterval = farInterval;
		this.filter = filter;
		this.bloomHalvings = bloomHalvings;
		this.aoScale = aoScale;
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
	/** The highest frame rate the governor aims for, in hertz: `TARGET_CAP_HZ`, or less under ?fps=. */
	private readonly targetHz: number;
	/**
	 * The window's start and the last frame's time, in ms, or -1 before the first frame, then the
	 * origin of the governor's clock on the frame loop's clock.
	 */
	private readonly times = new Float64Array([-1, -1, 0]);

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
		this.targetHz = Math.min(fps ?? TARGET_CAP_HZ, TARGET_CAP_HZ);
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
			governor.restart(this.clock(now) + (last < 0 ? GRACE_MS : 0));
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
			if (this.scene.loading()) governor.restart(this.clock(now));
			else if (shownFrames > 0) {
				const window = governor.window;
				const shownMs = (shown[SUM_INTERVAL_MS] as number) / shownFrames;
				const doneMs = doneFrames > 0 ? (done[SUM_INTERVAL_MS] as number) / doneFrames : 0;
				const delayMs = doneFrames > 0 ? (done[SUM_BUSY_MS] as number) / doneFrames : 0;
				const hz = this.refresh.hz;
				const target = this.targetHz;
				window[WINDOW_END] = this.clock(now);
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

	/**
	 * The governor's clock at `now`, a reading of the frame loop's clock, in whole ms. When it
	 * reaches its limit, its origin moves forward, and the clock reads just past the longest span
	 * that the rules compare.
	 */
	private clock(now: number): number {
		const { times } = this;
		const clock = Math.round(now - (times[2] as number));
		if (clock < CLOCK_LIMIT_MS) return clock;
		const by = clock - CLOCK_KEPT_MS;
		this.governor.moveOrigin(by);
		times[2] = (times[2] as number) + by;
		return CLOCK_KEPT_MS;
	}
}

/**
 * The time `by` ms before `time`, and at least 0. -1, which marks a time that has not happened,
 * stays.
 */
function earlier(time: number, by: number): number {
	return time < 0 ? time : Math.max(0, time - by);
}
