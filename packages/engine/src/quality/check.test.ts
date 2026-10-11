import { describe, expect, it } from 'bun:test';
import {
	CHECK_HOLD_SHARE,
	CHECK_MAX_FPS,
	checkTargetFps,
	frameRate,
	holdsTarget,
	maxTargetFps,
	raiseTarget,
} from './check';

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
		expect(checkTargetFps(0, Number.POSITIVE_INFINITY)).toBe(60);
		expect(checkTargetFps(0, 120)).toBe(60);
	});

	it('caps the target at 60 by default, at a number, or not at all for the display', () => {
		expect(maxTargetFps(undefined, undefined)).toBe(CHECK_MAX_FPS);
		expect(maxTargetFps('display', undefined)).toBe(Number.POSITIVE_INFINITY);
		expect(maxTargetFps(120, undefined)).toBe(120);
		expect(maxTargetFps(30, undefined)).toBe(30);
		// The ?fps= cap holds every setting down.
		expect(maxTargetFps(undefined, 30)).toBe(30);
		expect(maxTargetFps('display', 90)).toBe(90);
		expect(maxTargetFps(120, 144)).toBe(120);
		expect(maxTargetFps(undefined, 120)).toBe(60);
	});

	it("defends the display's full rate when the page asks for it", () => {
		const display = maxTargetFps('display', undefined);
		expect(checkTargetFps(144, display)).toBe(144);
		expect(checkTargetFps(120, display)).toBe(120);
		expect(checkTargetFps(60, display)).toBe(60);
		expect(checkTargetFps(120, maxTargetFps(90, undefined))).toBe(90);
		expect(checkTargetFps(60, maxTargetFps(90, undefined))).toBe(60);
		// A check that starts before the meter reads raises its target once it does.
		expect(raiseTarget(raiseTarget(0, 0, display), 120, display)).toBe(120);
	});

	it('never lowers the target when a busy GPU slows the refresh meter', () => {
		expect(raiseTarget(0, 60)).toBe(60);
		expect(raiseTarget(60, 30)).toBe(60);
		expect(raiseTarget(50, 60)).toBe(60);
		expect(raiseTarget(0, 0)).toBe(60);
		expect(raiseTarget(30, 120, 30)).toBe(30);
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
