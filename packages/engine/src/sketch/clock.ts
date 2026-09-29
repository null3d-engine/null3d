// The sketch's clock: turns frame timestamps into the step that each onUpdate call receives, or, in
// hold mode, counts fixed steps up to the held time.

/** The longest step one frame counts, in seconds. A slower frame slows the sketch instead of jumping it. */
export const MAX_STEP_SECONDS = 0.25;

/** Hold mode's steps per second of sketch time. */
export const HOLD_STEPS_PER_SECOND = 60;

/**
 * How many fixed steps take hold mode's clock from 0 to `seconds`. The last step is shorter than
 * the rest when the time is not a whole number of steps.
 */
export function holdSteps(seconds: number): number {
	// The margin keeps a time such as 0.1, whose product with the rate rounds up past a whole
	// number, from counting one step too many.
	return Math.max(0, Math.ceil(seconds * HOLD_STEPS_PER_SECOND - 1e-6));
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
		const raw = this.last < 0 || resumed ? 0 : (timestamp - this.last) / 1000;
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
