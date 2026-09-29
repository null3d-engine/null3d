import { describe, expect, it } from 'bun:test';
import { FrameClock, MAX_STEP_SECONDS } from './clock';

/** The step the clock takes for a frame at `timestamp`. */
function step(clock: FrameClock, timestamp: number, resumes: number): number {
	clock.advance(timestamp, resumes);
	return clock.dt;
}

describe('FrameClock', () => {
	it('counts no time on the first frame, then the time between frames', () => {
		const clock = new FrameClock();
		expect(step(clock, 1000, 0)).toBe(0);
		expect(step(clock, 1016, 0)).toBeCloseTo(0.016);
		expect(clock.now).toBeCloseTo(0.016);
	});

	it('counts no time on the first frame after a resume, however long the pause', () => {
		const clock = new FrameClock();
		step(clock, 0, 0);
		step(clock, 16, 0);
		expect(step(clock, 60_016, 1)).toBe(0);
		expect(step(clock, 60_032, 1)).toBeCloseTo(0.016);
		expect(clock.now).toBeCloseTo(0.032);
	});

	it('caps one slow frame, so it slows the sketch instead of jumping it', () => {
		const clock = new FrameClock();
		step(clock, 0, 0);
		expect(step(clock, 2000, 0)).toBe(MAX_STEP_SECONDS);
	});

	it('never steps backwards', () => {
		const clock = new FrameClock();
		step(clock, 100, 0);
		expect(step(clock, 50, 0)).toBe(0);
	});
});
