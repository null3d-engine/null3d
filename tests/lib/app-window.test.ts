import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../real-browsers.ts';
import {
	appWindow,
	CORNER_SIZE,
	cornerBounds,
	frontApp,
	keepingFocus,
	placeScript,
	RUNNER_TITLE,
} from './app-window.ts';

/** A laptop display of 1512 by 982 points, with a 33-point menu bar and a 43-point Dock. */
const laptop = { height: 982, x: 0, y: 43, width: 1512, freeHeight: 906 };

describe('appWindow', () => {
	it('opens apps in the background, in the corner, by default', () => {
		expect(appWindow(false, false, false)).toEqual({ background: true, corner: true });
	});

	it('keeps the window size in timed plans', () => {
		expect(appWindow(false, false, true)).toEqual({ background: true, corner: false });
	});

	it('opens apps in front with --front, and always in CI', () => {
		const front = { background: false, corner: false };
		expect(appWindow(true, false, false)).toEqual(front);
		expect(appWindow(false, true, false)).toEqual(front);
	});

	it('reads --front from the command line', () => {
		expect(parseArgs(['--front', 'Safari']).front).toBe(true);
		expect(parseArgs(['Safari']).front).toBeUndefined();
	});
});

describe('cornerBounds', () => {
	it('puts the window in the bottom right corner, above the Dock', () => {
		expect(cornerBounds(laptop)).toEqual([
			1512 - CORNER_SIZE.width,
			939 - CORNER_SIZE.height,
			1512,
			939,
		]);
	});

	it('shrinks a window that the free part cannot hold', () => {
		expect(cornerBounds(laptop, { width: 2000, height: 1000 })).toEqual([0, 33, 1512, 939]);
	});
});

describe('placeScript', () => {
	const bounds = [712, 339, 1512, 939] as const;

	it("finds Safari's runner window by its page's address", () => {
		const script = placeScript('Safari', 'run=r1&runner=mac-safari', bounds);
		expect(script).toContain('tell application "Safari"');
		expect(script).toContain('URL of current tab of w contains "run=r1&runner=mac-safari"');
		expect(script).toContain('set bounds of w to {712, 339, 1512, 939}');
	});

	it("finds Firefox's runner window by its title", () => {
		const script = placeScript('Firefox', 'run=r1&runner=mac-firefox', bounds);
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
