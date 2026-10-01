// Dynamic resolution. The scene draws at a render scale: a part of the canvas's width and height, in
// whole thousandths, which the core turns into an exact size in pixels. Scene passes draw into that
// corner of targets the size of the canvas, and the final pass scales it up to the canvas, so a new
// scale makes no GPU object.
//
// A controller moves the scale within the range that the quality settings give, from the frame
// times in the metrics rings. It judges the frames in windows of a quarter second. It takes a step
// down after about a second over the frame budget, and a step up only after several seconds in
// which the frames kept their rate and the GPU finished each within about one frame. After each
// step it waits for the frames of the new scale before it judges again. A step up that takes the
// frames over the budget doubles the wait before the next step up, so the scale settles below the
// point where the frames fall behind instead of swinging across it.
//
// The frame loop calls it once per frame, and it allocates nothing. The controller judges only a
// few times a second, so the browser may never optimize it, and unoptimized code makes a number
// object for each fraction. So it works in whole numbers alone: clock times in whole ms, and frame
// times in whole microseconds, in typed arrays of 32-bit integers.

import {
	RefreshRate,
	RingSums,
	SUM_BUSY_MS,
	SUM_INTERVAL_MS,
	SUM_RECORDS,
} from '../shared/metrics';
import * as Role from '../shared/role';

/** The render scale of the whole canvas, in thousandths. */
export const FULL_SCALE = 1000;
/** How far one step moves the render scale, in thousandths. */
export const SCALE_STEP = 50;

/** The render scale in thousandths of a scale from 0 to 1, rounded, from 1 to the whole canvas. */
export function thousandths(scale: number): number {
	return Math.min(FULL_SCALE, Math.max(1, Math.round(scale * FULL_SCALE)));
}

/** How long one window of frames lasts, in ms. */
export const WINDOW_MS = 250;
/** How long the frames stay over the budget before a step down, in ms. */
export const DROP_AFTER_MS = 1000;
/** How long the frames keep room to spare before the first step up, in ms. */
export const RAISE_AFTER_MS = 5000;
/** The longest wait before a step up, however often steps up failed, in ms. */
export const LONGEST_RAISE_AFTER_MS = 80_000;
/** How long after a step the controller waits before it judges the frames again, in ms. */
export const SETTLE_MS = 1000;
/** How soon after a step up a step down counts as the step up's failure, in ms. */
export const FAILED_RAISE_MS = SETTLE_MS + 2 * DROP_AFTER_MS;
/** How long after the first frame the controller takes no step, in ms. */
export const GRACE_MS = 2000;
/** A gap between frames this long, as after a pause, starts the windows again, in ms. */
export const GAP_MS = 500;
/** The highest frame rate the controller aims for, in hertz. */
export const MAX_TARGET_HZ = 60;
/** Frames whose time is this percentage of the budget or more are over it. */
const OVER_PERCENT = 110;
/** A GPU delay of this percentage of the budget or more means that frames queue on the GPU. */
const QUEUED_PERCENT = 200;
/** Frames within this percentage of the budget, with a GPU delay within `ROOM_DELAY_PERCENT`, have room. */
const ROOM_PERCENT = 102;
/** A GPU delay within this percentage of the budget means that the GPU finishes each frame within about one. */
const ROOM_DELAY_PERCENT = 125;

// The figures of one window of frames, by index in `ScaleController.window`.
/** The time at the window's end, in whole ms. */
export const WINDOW_END = 0;
/** The window's frame time: the longer of the mean presented and completed intervals, in µs. */
export const FRAME_US = 1;
/** The mean time from a frame's submit until the GPU finished it, in µs, or 0 when none finished. */
export const GPU_DELAY_US = 2;
/** The frame budget: the interval of the target frame rate, in µs. */
export const BUDGET_US = 3;

// The controller's times, by index in its state, in whole ms. -1 marks one that has not happened.
const OVER_SINCE = 0;
const ROOM_SINCE = 1;
const JUDGE_FROM = 2;
const RAISE_AFTER = 3;
const RAISED_AT = 4;
const STATE_SIZE = 5;

/**
 * The rules of dynamic resolution, over windows of frame figures. The frame loop, or a test, fills
 * `window` and calls `judge` once per window.
 */
export class ScaleController {
	/** The render scale in thousandths. */
	scale = FULL_SCALE;
	/** The lowest render scale in thousandths. */
	low = FULL_SCALE;
	/** The highest render scale in thousandths. */
	high = FULL_SCALE;
	/** The figures of the window to judge, by the `WINDOW_END` to `BUDGET_US` indices. */
	readonly window = new Int32Array(BUDGET_US + 1);
	private readonly state = new Int32Array(STATE_SIZE);

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
		this.scale = Math.min(high, Math.max(low, this.scale));
	}

	/**
	 * Forgets the frames before `now`: no step before `from`, a time in whole ms, and no window over
	 * or under the budget yet. The frame loop calls it at the first frame, as the grace starts, and
	 * after a pause.
	 */
	restart(from: number): void {
		const { state } = this;
		state[OVER_SINCE] = -1;
		state[ROOM_SINCE] = -1;
		state[JUDGE_FROM] = from;
	}

	/** Judges the window in `window`, and moves the scale one step when the rules say so. */
	judge(): void {
		const { window, state } = this;
		const now = window[WINDOW_END] as number;
		if (now < (state[JUDGE_FROM] as number)) return;
		const budget = window[BUDGET_US] as number;
		const frame = window[FRAME_US] as number;
		const delay = window[GPU_DELAY_US] as number;
		const over = frame * 100 >= budget * OVER_PERCENT || delay * 100 >= budget * QUEUED_PERCENT;
		const room =
			!over && frame * 100 <= budget * ROOM_PERCENT && delay * 100 <= budget * ROOM_DELAY_PERCENT;
		if (!over) state[OVER_SINCE] = -1;
		else if ((state[OVER_SINCE] as number) < 0) state[OVER_SINCE] = now - WINDOW_MS;
		if (!room) state[ROOM_SINCE] = -1;
		else if ((state[ROOM_SINCE] as number) < 0) state[ROOM_SINCE] = now - WINDOW_MS;
		const overSince = state[OVER_SINCE] as number;
		const roomSince = state[ROOM_SINCE] as number;
		if (over && now - overSince >= DROP_AFTER_MS) this.lower(now);
		else if (room && now - roomSince >= (state[RAISE_AFTER] as number)) this.raise(now);
	}

	/**
	 * One step down. When it undoes a recent step up, the next step up waits twice as long as that
	 * one did. Otherwise the frames got heavier, and the wait starts again from its shortest.
	 */
	private lower(now: number): void {
		const { state } = this;
		const scale = Math.max(this.low, this.scale - SCALE_STEP);
		if (scale !== this.scale) {
			const raisedAt = state[RAISED_AT] as number;
			const failed = raisedAt >= 0 && now - raisedAt <= FAILED_RAISE_MS;
			state[RAISE_AFTER] = failed
				? Math.min(LONGEST_RAISE_AFTER_MS, (state[RAISE_AFTER] as number) * 2)
				: RAISE_AFTER_MS;
			state[RAISED_AT] = -1;
		}
		this.step(scale, now);
	}

	/** One step up. */
	private raise(now: number): void {
		const scale = Math.min(this.high, this.scale + SCALE_STEP);
		if (scale !== this.scale) this.state[RAISED_AT] = now;
		this.step(scale, now);
	}

	/**
	 * Moves to `scale` and waits for the frames of the new scale. At the end of the range the scale
	 * stays, and the windows start again, so the frames are judged afresh.
	 */
	private step(scale: number, now: number): void {
		const moved = scale !== this.scale;
		this.scale = scale;
		this.restart(moved ? now + SETTLE_MS : now);
	}
}

/**
 * Dynamic resolution in the frame loop: it sums the presented and completed frames that the
 * metrics rings receive, and hands each window's figures to its controller.
 */
export class DynamicResolution {
	readonly controller = new ScaleController();
	/** The frame loop's clock reading at the start of the frame, in ms, which it writes first. */
	readonly now = new Float64Array(1);
	private readonly presented: RingSums;
	private readonly completed: RingSums;
	private readonly refresh: RefreshRate;
	/** The highest frame rate the controller aims for, in hertz: `MAX_TARGET_HZ`, or less under ?fps=. */
	private readonly targetHz: number;
	/** The window's start and the last frame's time, in ms, or -1 before the first frame. */
	private readonly times = new Float64Array([-1, -1]);

	/** `fps` is the frame rate that ?fps= holds, or undefined where the display's rate sets it. */
	constructor(metrics: ArrayBufferLike, fps?: number) {
		this.presented = new RingSums(metrics, Role.Render);
		this.completed = new RingSums(metrics, Role.Completion);
		this.refresh = new RefreshRate(metrics);
		this.targetHz = Math.min(fps ?? MAX_TARGET_HZ, MAX_TARGET_HZ);
	}

	/**
	 * Takes in the frames since the last call, and judges them at the end of each window. The
	 * frame loop writes the frame's clock reading into `now` first.
	 */
	frame(): void {
		const { times, presented, completed, controller } = this;
		const now = this.now[0] as number;
		presented.add();
		completed.add();
		const last = times[1] as number;
		times[1] = now;
		if (last < 0 || now - last >= GAP_MS) {
			// The first frame, or the first after a pause: the windows start again from here.
			controller.restart(Math.round(now) + (last < 0 ? GRACE_MS : 0));
		} else {
			if (now - (times[0] as number) < WINDOW_MS) return;
			// The window's figures turn into whole numbers here, in code that runs every frame and
			// so gets optimized, before the controller judges them.
			const shown = presented.sums;
			const done = completed.sums;
			const shownFrames = shown[SUM_RECORDS] as number;
			const doneFrames = done[SUM_RECORDS] as number;
			if (shownFrames > 0) {
				const window = controller.window;
				const shownMs = (shown[SUM_INTERVAL_MS] as number) / shownFrames;
				const doneMs = doneFrames > 0 ? (done[SUM_INTERVAL_MS] as number) / doneFrames : 0;
				const delayMs = doneFrames > 0 ? (done[SUM_BUSY_MS] as number) / doneFrames : 0;
				const hz = this.refresh.hz;
				const target = this.targetHz;
				window[WINDOW_END] = Math.round(now);
				window[FRAME_US] = Math.round(Math.max(shownMs, doneMs) * 1000);
				window[GPU_DELAY_US] = Math.round(delayMs * 1000);
				window[BUDGET_US] = Math.round(1_000_000 / (hz > 0 ? Math.min(hz, target) : target));
				controller.judge();
			}
		}
		// A new window starts at this frame.
		times[0] = now;
		presented.clear();
		completed.clear();
	}
}
