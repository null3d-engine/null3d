import { describe, expect, it } from 'bun:test';
import { FrameClock, HOLD_STEPS_PER_SECOND, holdSteps, MAX_STEP_SECONDS } from './clock';

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

/** The time and the step of every frame of a hold at `seconds`. */
function hold(seconds: number): { now: number[]; dt: number[] } {
	const clock = new FrameClock();
	const steps = holdSteps(seconds);
	const now: number[] = [];
	const dt: number[] = [];
	for (let k = 0; k <= steps; k++) {
		clock.holdStep(k, steps, seconds);
		now.push(clock.now);
		dt.push(clock.dt);
	}
	return { now, dt };
}

describe('hold steps', () => {
	it('take a whole number of steps of 1/60 second to a time that is one', () => {
		expect([0, 0.1, 1, 1.5, 2, 600].map(holdSteps)).toEqual([0, 6, 60, 90, 120, 36_000]);
	});

	it('add a shorter last step to a time between steps', () => {
		expect(holdSteps(0.001)).toBe(1);
		expect(holdSteps(1.51)).toBe(91);
		const { now, dt } = hold(0.025);
		expect(now).toEqual([0, 1 / HOLD_STEPS_PER_SECOND, 0.025]);
		expect(dt[2]).toBeCloseTo(0.025 - 1 / HOLD_STEPS_PER_SECOND, 12);
	});

	it('start at time 0 with no step, then add one fixed step per frame', () => {
		const { now, dt } = hold(1.5);
		expect(now).toHaveLength(91);
		expect([now[0], dt[0]]).toEqual([0, 0]);
		for (let k = 1; k < now.length; k++) expect(dt[k]).toBeCloseTo(1 / HOLD_STEPS_PER_SECOND, 12);
	});

	it('land on the held time exactly', () => {
		for (const seconds of [0, 0.1, 0.7, 1.5, 2, 2.345, 600]) {
			const { now } = hold(seconds);
			expect(now.at(-1)).toBe(seconds);
		}
	});

	it('hold a frame at time 0 with one frame and no step', () => {
		expect(hold(0)).toEqual({ now: [0], dt: [0] });
	});
});
