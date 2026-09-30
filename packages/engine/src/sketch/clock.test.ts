import { describe, expect, it } from 'bun:test';
import { EngineError } from '../errors/engine-error';
import {
	DEFAULT_FIXED_RATE,
	DEFAULT_MAX_FIXED_STEPS,
	FixedClock,
	FrameClock,
	HOLD_STEPS_PER_SECOND,
	holdSteps,
	MAX_STEP_SECONDS,
} from './clock';

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

/** The fixed steps of each frame at `timestamps` in milliseconds, with the page's resume count. */
function fixedSteps(
	fixed: FixedClock,
	timestamps: readonly number[],
	resumes: readonly number[] = [],
): number[] {
	const clock = new FrameClock();
	return timestamps.map((t, k) => {
		clock.advance(t, resumes[k] ?? 0);
		return fixed.stepsAt(clock.now);
	});
}

/** Timestamps of `count` frames at `hz` frames per second, from 0. */
function frames(count: number, hz: number): number[] {
	return Array.from({ length: count }, (_, k) => (k * 1000) / hz);
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('FixedClock', () => {
	it('runs 60 steps per second, one per frame at 60 frames per second and none in the first', () => {
		const fixed = new FixedClock();
		expect(fixed.step).toBe(1 / DEFAULT_FIXED_RATE);
		const steps = fixedSteps(fixed, frames(61, 60));
		expect(steps[0]).toBe(0);
		expect(steps.slice(1)).toEqual(Array(60).fill(1));
	});

	it('runs whole steps only, as many as fall due in each frame', () => {
		// At 90 frames per second, two of every three frames run a step.
		const at90 = fixedSteps(new FixedClock(), frames(91, 90));
		expect(at90.slice(0, 7)).toEqual([0, 0, 1, 1, 0, 1, 1]);
		expect(sum(at90)).toBe(60);
		// At 30 frames per second, each frame after the first runs two.
		const at30 = fixedSteps(new FixedClock(), frames(31, 30));
		expect(at30.slice(1)).toEqual(Array(30).fill(2));
		// Another rate from the options: 50 steps in a second of 60 frames.
		expect(sum(fixedSteps(new FixedClock(50), frames(61, 60)))).toBe(50);
	});

	it('caps the steps after a slow frame, and drops the rest', () => {
		// A frame a quarter second late has 15 steps due, runs the cap and drops the others.
		const steps = fixedSteps(new FixedClock(), [0, 16.7, 266.7, 283.4]);
		expect(steps).toEqual([0, 1, DEFAULT_MAX_FIXED_STEPS, 1]);
		expect(fixedSteps(new FixedClock(60, 20), [0, 16.7, 266.7])).toEqual([0, 1, 15]);
	});

	it('runs no steps in the first frame after a pause', () => {
		const steps = fixedSteps(new FixedClock(), [0, 16.7, 33.4, 60_000, 60_016.7], [0, 0, 0, 1, 1]);
		expect(steps).toEqual([0, 1, 1, 0, 1]);
	});

	it('runs the same steps on every hold, however many steps fit in each frame', () => {
		for (const [rate, total] of [
			[60, 90],
			[30, 45],
			[144, 216],
			[50, 75],
		] as const) {
			const run = () => {
				const clock = new FrameClock();
				const fixed = new FixedClock(rate);
				const steps = holdSteps(1.5);
				return Array.from({ length: steps + 1 }, (_, k) => {
					clock.holdStep(k, steps, 1.5);
					return fixed.stepsAt(clock.now);
				});
			};
			const first = run();
			expect([rate, sum(first)]).toEqual([rate, total]);
			expect(run()).toEqual(first);
			if (rate === 60) expect(first).toEqual([0, ...Array(90).fill(1)]);
		}
	});

	it('refuses a rate or a cap out of range with E1207', () => {
		for (const [rate, cap, name] of [
			[0, 8, 'fixedRate'],
			[-60, 8, 'fixedRate'],
			[Number.NaN, 8, 'fixedRate'],
			[Number.POSITIVE_INFINITY, 8, 'fixedRate'],
			[60, 0, 'maxFixedSteps'],
			[60, 2.5, 'maxFixedSteps'],
			[60, Number.POSITIVE_INFINITY, 'maxFixedSteps'],
		] as const) {
			let caught: unknown;
			try {
				new FixedClock(rate, cap);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(EngineError);
			expect((caught as EngineError).code).toBe('E1207');
			expect((caught as EngineError).message).toContain(`for ${name}.`);
		}
	});
});
