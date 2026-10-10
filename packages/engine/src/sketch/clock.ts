// The sketch's clocks. The frame clock turns frame timestamps into the step that each onUpdate call
// receives, or, in hold mode, counts fixed steps up to the held time. The fixed clock counts the
// fixed steps that each frame runs from the sketch time.

import { EngineError } from '../errors/engine-error';

/** The longest step one frame counts, in seconds. A slower frame slows the sketch instead of jumping it. */
export const MAX_STEP_SECONDS = 0.25;

/** Hold mode's steps per second of sketch time. */
export const HOLD_STEPS_PER_SECOND = 60;

/** Fixed steps per second, unless the sketch's options set another rate. */
export const DEFAULT_FIXED_RATE = 60;

/** The most fixed steps one frame runs, unless the sketch's options set another number. */
export const DEFAULT_MAX_FIXED_STEPS = 8;

/**
 * A margin, in steps, for a time that is a whole number of steps. Its product with a rate can round
 * to just past or just short of the whole number, and a count of steps must not change with that.
 */
const STEP_MARGIN = 1e-6;

/**
 * How many fixed steps take hold mode's clock from 0 to `seconds`. The last step is shorter than
 * the rest when the time is not a whole number of steps.
 */
export function holdSteps(seconds: number): number {
	return Math.max(0, Math.ceil(seconds * HOLD_STEPS_PER_SECOND - STEP_MARGIN));
}

/**
 * Turns frame timestamps into steps. The first frame, and the first after the page resumes the sketch
 * or shows a hidden page again, counts no time, so the sketch never jumps over a pause.
 */
export class FrameClock {
	/** Sketch time in seconds: the sum of every step, so paused and hidden time do not count. */
	now = 0;
	/** The last frame's step in seconds. */
	dt = 0;
	private last = -1;
	private resumes = 0;

	/**
	 * Takes the step for a frame at `timestamp` milliseconds into `dt` and adds it to `now`.
	 * `resumes` is the page's count of resumes, which changes each time the sketch resumes or a
	 * hidden page shows again. The step stays in a field, because a fraction returned from a call
	 * becomes a new number object each frame.
	 */
	advance(timestamp: number, resumes: number): void {
		const resumed = resumes !== this.resumes;
		this.resumes = resumes;
		// A prototype switch for measuring (M2-EX18): a sketch that sets a fixed step on the global
		// object gets that step in every frame after the first, whatever the frames' timestamps.
		const fixed = (globalThis as { __null3dFixedStep?: number }).__null3dFixedStep;
		const measured = fixed ?? (timestamp - this.last) / 1000;
		const raw = this.last < 0 || resumed ? 0 : measured;
		this.last = timestamp;
		this.dt = Math.min(Math.max(raw, 0), MAX_STEP_SECONDS);
		this.now += this.dt;
	}

	/**
	 * Sets the clock for step `step` of hold mode's `steps` to `seconds`. Step 0 is the first
	 * frame, at time 0. Each later step adds one fixed step, and the last lands on `seconds`
	 * exactly. The time comes from the step's number, not from a sum of steps, so it never drifts.
	 */
	holdStep(step: number, steps: number, seconds: number): void {
		const now = step >= steps ? seconds : step / HOLD_STEPS_PER_SECOND;
		this.dt = now - this.now;
		this.now = now;
	}
}

/**
 * Counts the fixed steps that each frame runs. Step `n` falls due when the sketch time reaches `n`
 * steps. The count comes from the sketch time, not from a sum of steps, so it never drifts, and
 * hold mode, whose times are exact, runs the same steps on every run. A frame runs at most
 * `maxSteps` steps and drops the rest, so after a slow frame the simulation falls behind the sketch
 * time instead of slowing the frames that follow. Throws E1214 when an option is out of range.
 */
export class FixedClock {
	/** One step's length in seconds. */
	readonly step: number;
	/** Steps run or dropped since time 0. */
	private counted = 0;

	constructor(
		private readonly rate = DEFAULT_FIXED_RATE,
		private readonly maxSteps = DEFAULT_MAX_FIXED_STEPS,
	) {
		if (!(Number.isFinite(rate) && rate > 0))
			throw new EngineError('E1214', `defineSketch() got ${rate} for fixedRate.`);
		if (!(Number.isInteger(maxSteps) && maxSteps >= 1))
			throw new EngineError('E1214', `defineSketch() got ${maxSteps} for maxFixedSteps.`);
		this.step = 1 / rate;
	}

	/** The number of steps that a frame at sketch time `now` seconds runs. */
	stepsAt(now: number): number {
		const due = Math.floor(now * this.rate + STEP_MARGIN) - this.counted;
		this.counted += due;
		return Math.min(due, this.maxSteps);
	}
}
