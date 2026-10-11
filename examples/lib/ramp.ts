// The ramp of a comparison: it raises the count step by step until the engine no longer holds the
// display rate, and reports the largest count that it held. A fixed count at the display rate in
// both engines hides the gap between them, so this count is each comparison's headline figure.
// Also here: the device classes, which fix the pixel ratio and the ramp, and the count slider's
// log scale. Nothing here imports an engine, so the unit tests drive the ramp with a fake one.

/** The kinds of device that a comparison tells apart, by feature tests alone. */
export type DeviceClass = 'desktop' | 'tablet' | 'phone';

/** A ramp plan: the count starts at `start` and grows by `factor` each step, up to `max`. */
export interface RampPlan {
	readonly start: number;
	readonly factor: number;
	readonly max: number;
}

/** What the page measures about the device. */
export interface DeviceFacts {
	/** The shorter side of the screen, in CSS pixels. */
	shortSideCss: number;
	/** True when the main pointer is coarse (`(pointer: coarse)`), as on touch screens. */
	coarsePointer: boolean;
}

/** Tablets have a short side of at least this many CSS pixels. */
export const TABLET_SHORT_SIDE = 600;

/** The device class: a fine pointer makes a desktop, and a coarse one a tablet or a phone by size. */
export function deviceClass(facts: DeviceFacts): DeviceClass {
	if (!facts.coarsePointer) return 'desktop';
	return facts.shortSideCss >= TABLET_SHORT_SIDE ? 'tablet' : 'phone';
}

/**
 * The most device pixels per CSS pixel that each class draws. Both engines draw at
 * `min(devicePixelRatio, cap)`, so they fill the same number of pixels on the same device.
 */
export const PIXEL_RATIO_CAP: Readonly<Record<DeviceClass, number>> = {
	desktop: 1,
	tablet: 1.5,
	phone: 1.5,
};

/** The pixel ratio that both engines draw at on a device. */
export function renderPixelRatio(cls: DeviceClass, devicePixelRatio: number): number {
	return Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, PIXEL_RATIO_CAP[cls]);
}

/** A frame rate at or above this share of the display rate counts as holding it. */
export const HOLD_SHARE = 0.95;
/** Steps in a row that miss the display rate before the ramp stops. */
export const STOP_STEPS = 2;
/** Seconds per step: the count changes once per step. */
export const STEP_SECONDS = 1.5;
/** Seconds at the start of each step that the measurement skips, while the new count settles. */
export const SETTLE_SECONDS = 0.5;

/** The count at a step of the ramp. */
export function rampCount(plan: RampPlan, step: number): number {
	return Math.min(plan.max, Math.round(plan.start * plan.factor ** Math.max(0, step)));
}

/** The steps a ramp takes to reach its maximum, and so its longest run. */
export function rampSteps(plan: RampPlan): number {
	return Math.ceil(Math.log(plan.max / plan.start) / Math.log(plan.factor) - 1e-9) + 1;
}

/** Why a ramp stopped: the engine missed the display rate, or the count reached the plan's maximum. */
export type StopReason = 'below-display-rate' | 'maximum';

/** One measured step of the ramp. */
export interface RampStep {
	step: number;
	count: number;
	/** Frames presented per second in the measured part of the step. */
	fps: number;
	/** CPU time per frame of the engine's busiest thread, in milliseconds, where known. */
	cpuMs: number | null;
}

/** What one engine's ramp found. */
export interface RampResult {
	/** The display rate that the ramp judged against. */
	displayHz: number;
	/** The largest count measured at or above HOLD_SHARE of the display rate, or 0 when none held. */
	held: number;
	/** The largest count measured at or above HOLD_SHARE of half the display rate. */
	heldAtHalfRate: number;
	stopReason: StopReason;
	steps: RampStep[];
}

/** Follows the measured steps of one engine's ramp: when to stop, and the largest counts held. */
export class RampTracker {
	readonly steps: RampStep[] = [];
	held = 0;
	heldAtHalfRate = 0;
	stopReason: StopReason | null = null;
	private missed = 0;

	constructor(
		private readonly plan: RampPlan,
		readonly displayHz: number,
	) {}

	/** Adds a measured step. Returns the reason to stop, or null to go on. */
	add(result: RampStep): StopReason | null {
		if (this.stopReason) return this.stopReason;
		this.steps.push(result);
		const holds = result.fps >= HOLD_SHARE * this.displayHz;
		if (holds) this.held = Math.max(this.held, result.count);
		if (result.fps >= HOLD_SHARE * (this.displayHz / 2))
			this.heldAtHalfRate = Math.max(this.heldAtHalfRate, result.count);
		this.missed = holds ? 0 : this.missed + 1;
		if (this.missed >= STOP_STEPS) this.stopReason = 'below-display-rate';
		else if (result.count >= this.plan.max) this.stopReason = 'maximum';
		return this.stopReason;
	}

	result(): RampResult {
		return {
			displayHz: this.displayHz,
			held: this.held,
			heldAtHalfRate: this.heldAtHalfRate,
			stopReason: this.stopReason ?? 'maximum',
			steps: this.steps,
		};
	}
}

/** What the ramp drives: a running comparison of either engine. */
export interface RampTarget {
	setCount(count: number): void;
	/** Measures the next `seconds` of frames. */
	measure(seconds: number): Promise<{ fps: number; cpuMs: number | null }>;
}

/** How a ramp runs. */
export interface RampOptions {
	/** The display's refresh rate, which the ramp judges against. */
	displayHz: number;
	/** Seconds per step. */
	stepSeconds?: number;
	/** Seconds at the start of each step before the measurement. */
	settleSeconds?: number;
	/** Called after each measured step, as for a progress line. */
	onStep?: (step: RampStep) => void;
	/** Stops the ramp early; it then resolves with what it measured. */
	signal?: AbortSignal;
	/** Waits; tests pass a fake clock. */
	wait?: (seconds: number) => Promise<void>;
}

const realWait = (seconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Runs the ramp on a running comparison: each step sets the count, lets it settle, and measures the
 * frame rate, until the engine misses the display rate for STOP_STEPS steps in a row, or the count
 * reaches the plan's maximum.
 */
export async function runRamp(
	target: RampTarget,
	plan: RampPlan,
	{
		displayHz,
		stepSeconds = STEP_SECONDS,
		settleSeconds = SETTLE_SECONDS,
		onStep,
		signal,
		wait = realWait,
	}: RampOptions,
): Promise<RampResult> {
	const tracker = new RampTracker(plan, displayHz);
	for (let step = 0; !signal?.aborted; step++) {
		const count = rampCount(plan, step);
		target.setCount(count);
		await wait(settleSeconds);
		const { fps, cpuMs } = await target.measure(stepSeconds - settleSeconds);
		const result = { step, count, fps, cpuMs };
		const stop = tracker.add(result);
		onStep?.(result);
		if (stop) break;
	}
	return tracker.result();
}

// The count slider moves on a log scale, so every tenfold step of the count takes the same length.

/** The slider's number of positions. */
export const SLIDER_STEPS = 1000;

/** The slider's range: a tenth of the ramp's start count up to its maximum. */
export function countRange(plan: RampPlan): { min: number; max: number } {
	return { min: Math.max(1, Math.round(plan.start / 10)), max: plan.max };
}

/** The count at a slider position. */
export function sliderToCount(position: number, plan: RampPlan): number {
	const { min, max } = countRange(plan);
	const t = Math.min(1, Math.max(0, position / SLIDER_STEPS));
	return Math.round(Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))));
}

/** The slider position that shows a count. */
export function countToSlider(count: number, plan: RampPlan): number {
	const { min, max } = countRange(plan);
	const clamped = Math.min(max, Math.max(min, count));
	return Math.round(
		((Math.log(clamped) - Math.log(min)) / (Math.log(max) - Math.log(min))) * SLIDER_STEPS,
	);
}

/** A count from the page's address, kept inside the slider's range, or the ramp's start count. */
export function startCount(option: string | null, plan: RampPlan): number {
	const asked = option === null || option.trim() === '' ? Number.NaN : Number(option);
	if (!Number.isInteger(asked)) return plan.start;
	const { min, max } = countRange(plan);
	return Math.min(max, Math.max(min, asked));
}
