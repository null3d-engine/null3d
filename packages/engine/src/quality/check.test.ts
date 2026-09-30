import { describe, expect, it } from 'bun:test';
import { CHECK_HOLD_SHARE, CHECK_MAX_FPS, checkTargetFps, frameRate, holdsTarget } from './check';

describe('the preset check', () => {
	it("targets the display's refresh rate, at most 60 and at most the ?fps= rate", () => {
		expect(checkTargetFps(144)).toBe(CHECK_MAX_FPS);
		expect(checkTargetFps(120)).toBe(60);
		expect(checkTargetFps(60)).toBe(60);
		expect(checkTargetFps(50)).toBe(50);
		expect(checkTargetFps(120, 30)).toBe(30);
		expect(checkTargetFps(24, 30)).toBe(24);
	});

	it('targets 60 before the refresh rate is measured', () => {
		expect(checkTargetFps(0)).toBe(60);
		expect(checkTargetFps(0, 30)).toBe(30);
	});

	it('counts frames per second, and 0 when no frame or no time passed', () => {
		expect(frameRate(30, 500)).toBe(60);
		expect(frameRate(0, 500)).toBe(0);
		expect(frameRate(5, 0)).toBe(0);
	});

	it('holds a target that the lower of the two rates reaches most of', () => {
		const round = (presentedFps: number, completedFps: number) => ({
			preset: 'high' as const,
			presentedFps,
			completedFps,
		});
		const edge = 60 * CHECK_HOLD_SHARE;
		expect(holdsTarget(round(60, 60), 60)).toBe(true);
		expect(holdsTarget(round(60, edge), 60)).toBe(true);
		expect(holdsTarget(round(60, edge - 0.1), 60)).toBe(false);
		// Frames that queue on the GPU cannot pass for a healthy rate.
		expect(holdsTarget(round(60, 30), 60)).toBe(false);
		expect(holdsTarget(round(30, 60), 60)).toBe(false);
		expect(holdsTarget(round(29, 29), 30)).toBe(true);
	});
});
