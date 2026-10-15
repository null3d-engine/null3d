// The ramp of a comparison: it raises the count step by step until the scene's update rate falls
// below a floor, or the count reaches the ramp's maximum, and reports the largest count that held
// the floor. A fixed count in both engines hides the gap between them, so this count is each
// comparison's headline figure.
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

/**
 * The scene's update rate, in frames a second, below which a step misses (owner, 13 October 2026).
 * The ramp runs heavy scenes to find where each engine gives way, not where it leaves the display.
 */
export const FLOOR_FPS = 20;
/** Steps in a row below the floor before the ramp stops, so one slow step does not end it. */
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

/**
 * Why a ramp stopped: the scene's update rate fell below the floor, the engine drew no frame at two
 * counts in a row, the scene's update failed, or the count reached the plan's maximum.
 */
export type StopReason = 'below-floor' | 'no-frame' | 'scene-error' | 'maximum';

/** One measured step of the ramp. */
export interface RampStep {
	step: number;
	count: number;
	/**
	 * Frames per second in the measured part of the step whose scene update ran to its end: the
	 * scene's real update rate, which frames that show a scene that no longer moves never raise.
	 */
	fps: number;
	/** CPU time per frame of the engine's busiest thread, in milliseconds, where known. */
	cpuMs: number | null;
	/** True when no frame drew anything in the step. */
	noFrame?: boolean;
	/** Why the scene's update failed in the step, where it did. */
	error?: string;
}

/** What one engine's ramp found. */
export interface RampResult {
	/** The update rate below which a step misses: FLOOR_FPS. */
	floorFps: number;
	/** The largest count measured at the floor or above, or 0 when none held. */
	held: number;
	/** The largest count at which the engine drew a frame, at any rate. */
	drew: number;
	/**
	 * Counts at which the engine drew no frame, though it drew at the next count: a fault of the
	 * browser at that one count, which the ramp stepped past.
	 */
	skipped: number[];
	stopReason: StopReason;
	/** Why the engine last drew no frame, or why its scene's update failed, where it said why. */
	failure?: string;
	steps: RampStep[];
	/** Seconds that the ramp took, its warm-up included. */
	seconds?: number;
}

/** Follows the measured steps of one engine's ramp: when to stop, and the largest count held. */
export class RampTracker {
	readonly steps: RampStep[] = [];
	held = 0;
	drew = 0;
	readonly skipped: number[] = [];
	stopReason: StopReason | null = null;
	failure: string | undefined;
	/** A count that drew no frame, until the next step shows whether the engine draws past it. */
	private blank: number | null = null;
	private missed = 0;

	constructor(private readonly plan: RampPlan) {}

	/** Adds a measured step. Returns the reason to stop, or null to go on. */
	add(result: RampStep): StopReason | null {
		if (this.stopReason) return this.stopReason;
		this.steps.push(result);
		// A scene whose update fails stops the ramp at once: its frames show a scene that no longer
		// moves, at whatever rate the engine presents them.
		if (result.error !== undefined) {
			this.failure = result.error;
			this.stopReason = 'scene-error';
			return this.stopReason;
		}
		// A count that draws nothing is skipped when the next count draws: a browser can fail at one
		// count alone. Two such counts in a row, or one at the maximum, stop the ramp.
		if (result.noFrame) {
			if (this.blank !== null || result.count >= this.plan.max) this.stopReason = 'no-frame';
			else this.blank = result.count;
			return this.stopReason;
		}
		if (this.blank !== null) this.skipped.push(this.blank);
		this.blank = null;
		this.drew = Math.max(this.drew, result.count);
		const holds = result.fps >= FLOOR_FPS;
		if (holds) this.held = Math.max(this.held, result.count);
		this.missed = holds ? 0 : this.missed + 1;
		if (this.missed >= STOP_STEPS) this.stopReason = 'below-floor';
		else if (result.count >= this.plan.max) this.stopReason = 'maximum';
		return this.stopReason;
	}

	result(): RampResult {
		return {
			floorFps: FLOOR_FPS,
			held: this.held,
			drew: this.drew,
			skipped: this.skipped,
			stopReason: this.stopReason ?? 'maximum',
			...(this.failure !== undefined && { failure: this.failure }),
			steps: this.steps,
		};
	}
}

/**
 * The sentence that says where and why the ramp stopped: at the plan's maximum while the engine
 * still held the floor, which is the top of the ramp and no limit of the engine, below the floor,
 * or at a failed update. `noFrameText` gives the counts at which the engine drew no frame.
 */
export function stopText(title: string, result: RampResult, unit: string): string {
	const count = (n: number) => n.toLocaleString('en-US');
	const last = result.steps.at(-1);
	const at = count(last?.count ?? 0);
	const fps = last ? last.fps.toFixed(0) : '0';
	switch (result.stopReason) {
		case 'maximum':
			return `${title} reached the maximum of ${at} ${unit} at ${fps} fps: the top of this ramp, not a limit of ${title}.`;
		case 'below-floor':
			return `${title} fell below ${result.floorFps} fps at ${at} ${unit} (${fps} fps).`;
		case 'scene-error':
			return `${title}'s scene stopped updating at ${at} ${unit}: ${result.failure ?? 'its update failed'}.`;
		case 'no-frame':
			return '';
	}
}

/**
 * The sentences that say where an engine drew no frame: a count that it could not draw, with the
 * most it drew, and the counts that the ramp stepped past as a fault of the browser. Each gives
 * the engine's reason where it gave one. Empty when it drew at every count.
 */
export function noFrameText(title: string, result: RampResult, unit: string): string {
	const count = (n: number) => n.toLocaleString('en-US');
	const why = result.failure ? ` (${result.failure})` : '';
	const sentences: string[] = [];
	if (result.skipped.length > 0)
		sentences.push(
			`${title} drew no frame at ${result.skipped.map(count).join(', ')} ${unit}, but did at the next count, so the ramp stepped past: a fault of this browser${why}.`,
		);
	if (result.stopReason === 'no-frame') {
		const failed = count(result.steps.at(-1)?.count ?? 0);
		const drew = result.drew > 0 ? `; it drew ${count(result.drew)} at most` : '';
		sentences.push(`${title} could not draw ${failed} ${unit}${drew}${why}.`);
	}
	return sentences.join(' ');
}

/** What a step's measurement gives the ramp. */
export interface RampMeasurement {
	/** Frames per second whose scene update ran to its end. */
	fps: number;
	cpuMs: number | null;
	noFrame?: boolean;
	/** Why the scene's update failed during the measurement, where it did. */
	error?: string;
}

/** What the ramp drives: a running comparison of either engine. */
export interface RampTarget {
	setCount(count: number): void;
	/** Measures the next `seconds` of frames. */
	measure(seconds: number): Promise<RampMeasurement>;
}

/** How a ramp runs. */
export interface RampOptions {
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
 * scene's update rate, until the rate stays below FLOOR_FPS for STOP_STEPS steps in a row, the
 * scene's update fails, or the count reaches the plan's maximum.
 */
export async function runRamp(
	target: RampTarget,
	plan: RampPlan,
	{
		stepSeconds = STEP_SECONDS,
		settleSeconds = SETTLE_SECONDS,
		onStep,
		signal,
		wait = realWait,
	}: RampOptions = {},
): Promise<RampResult> {
	const tracker = new RampTracker(plan);
	for (let step = 0; !signal?.aborted; step++) {
		const count = rampCount(plan, step);
		target.setCount(count);
		await wait(settleSeconds);
		const { fps, cpuMs, noFrame, error } = await target.measure(stepSeconds - settleSeconds);
		const result: RampStep = {
			step,
			count,
			fps,
			cpuMs,
			...(noFrame && { noFrame }),
			...(error !== undefined && { error }),
		};
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
