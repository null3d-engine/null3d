import { describe, expect, it } from 'bun:test';
import { FrameClock, MAX_STEP_SECONDS } from './clock';

describe('FrameClock', () => {
	it('counts no time on the first frame, then the time between frames', () => {
		const clock = new FrameClock();
		expect(clock.step(1000, 0)).toBe(0);
		expect(clock.step(1016, 0)).toBeCloseTo(0.016);
		expect(clock.now).toBeCloseTo(0.016);
	});

	it('counts no time on the first frame after a resume, however long the pause', () => {
		const clock = new FrameClock();
		clock.step(0, 0);
		clock.step(16, 0);
		expect(clock.step(60_016, 1)).toBe(0);
		expect(clock.step(60_032, 1)).toBeCloseTo(0.016);
		expect(clock.now).toBeCloseTo(0.032);
	});

	it('caps one slow frame, so it slows the game instead of jumping it', () => {
		const clock = new FrameClock();
		clock.step(0, 0);
		expect(clock.step(2000, 0)).toBe(MAX_STEP_SECONDS);
	});

	it('never steps backwards', () => {
		const clock = new FrameClock();
		clock.step(100, 0);
		expect(clock.step(50, 0)).toBe(0);
	});
});
