// The sketch's clock: turns frame timestamps into the step that each onUpdate call receives.

/** The longest step one frame counts, in seconds. A slower frame slows the sketch instead of jumping it. */
export const MAX_STEP_SECONDS = 0.25;

/**
 * Turns frame timestamps into steps. The first frame, and the first after the page resumes the sketch
 * or shows a hidden page again, counts no time, so the sketch never jumps over a pause.
 */
export class FrameClock {
	/** Sketch time in seconds: the sum of every step, so paused and hidden time do not count. */
	now = 0;
	private last = -1;
	private resumes = 0;

	/**
	 * The step in seconds for a frame at `timestamp` milliseconds. `resumes` is the page's count of
	 * resumes, which changes each time the sketch resumes or a hidden page shows again.
	 */
	step(timestamp: number, resumes: number): number {
		const resumed = resumes !== this.resumes;
		this.resumes = resumes;
		const raw = this.last < 0 || resumed ? 0 : (timestamp - this.last) / 1000;
		this.last = timestamp;
		const dt = Math.min(Math.max(raw, 0), MAX_STEP_SECONDS);
		this.now += dt;
		return dt;
	}
}
