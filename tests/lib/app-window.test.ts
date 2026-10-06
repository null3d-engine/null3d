import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../real-browsers.ts';
import {
	appWindow,
	frontApp,
	keepingFocus,
	PARKED_STRIP,
	parkedPlace,
	parkScript,
	RUNNER_TITLE,
	SMALL_SIZE,
} from './app-window.ts';

/** A laptop display of 1512 by 982 points, with a 33-point menu bar and a 43-point Dock. */
const laptop = { height: 982, x: 0, y: 43 };

describe('appWindow', () => {
	it('opens apps in the background, parked at the small size, by default', () => {
		expect(appWindow(false, false, false)).toEqual({ background: true, park: true, small: true });
	});

	it('parks the window at its own size in timed plans', () => {
		expect(appWindow(false, false, true)).toEqual({ background: true, park: true, small: false });
	});

	it('opens apps in front with --front, and always in CI', () => {
		for (const [front, ci] of [
			[true, false],
			[false, true],
		] as const)
			expect(appWindow(front, ci, false)).toMatchObject({ background: false, park: false });
	});

	it('reads --front from the command line', () => {
		expect(parseArgs(['--front', 'Safari']).front).toBe(true);
		expect(parseArgs(['Safari']).front).toBeUndefined();
	});
});

describe('parkedPlace', () => {
	it("leaves a strip on the display's left edge, from the bottom of its free part", () => {
		expect(parkedPlace(laptop)).toEqual({ right: PARKED_STRIP, top: 939 });
	});
});

describe('parkScript', () => {
	const place = { right: 10, top: 939 };

	it("finds Safari's runner window by its page's address, and gives it the small size", () => {
		const script = parkScript('Safari', 'run=r1&runner=mac-safari', place, SMALL_SIZE);
		expect(script).toContain('tell application "Safari"');
		expect(script).toContain('URL of current tab of w contains "run=r1&runner=mac-safari"');
		expect(script).toContain('set bounds of w to {10 - (800), 939, 10, 939 + (600)}');
	});

	it("keeps the window's own size without one", () => {
		const script = parkScript('Safari', 'run=r1&runner=mac-safari', place);
		expect(script).toContain('set bounds of w to {10 - (c - a), 939, 10, 939 + (d - b)}');
	});

	it("finds Firefox's runner window by its title", () => {
		const script = parkScript('Firefox', 'run=r1&runner=mac-firefox', place, SMALL_SIZE);
		expect(script).toContain(`name of w contains "${RUNNER_TITLE}"`);
		expect(script).not.toContain('URL');
	});
});

describe('keepingFocus', () => {
	it('returns what the step returns, and leaves the app in front where it was', async () => {
		const before = frontApp();
		expect(await keepingFocus(async () => 42)).toBe(42);
		expect(frontApp()?.pid).toBe(before?.pid);
	});

	it('reads no app in front in CI', () => {
		const ci = process.env.CI;
		process.env.CI = '1';
		try {
			expect(frontApp()).toBeUndefined();
		} finally {
			if (ci === undefined) delete process.env.CI;
			else process.env.CI = ci;
		}
	});
});
