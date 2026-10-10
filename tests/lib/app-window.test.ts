import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../real-browsers.ts';
import {
	appWindow,
	frontApp,
	keepingFocus,
	mainScreen,
	NEW_WINDOW_APPS,
	newWindowScript,
	PARKED_STRIP,
	parkChromeWindow,
	parkedPlace,
	parkScript,
	RUNNER_TITLE,
	SMALL_SIZE,
} from './app-window.ts';

/** A laptop display of 1512 by 982 points, with a 33-point menu bar and a 43-point Dock. */
const laptop = { height: 982, x: 0, y: 43 };

/** Whether this machine is a Mac with a person at it, where tools move windows. */
const personsMac = process.platform === 'darwin' && !process.env.CI;

/** Runs `step` as in CI, then restores the environment. */
async function asInCI<T>(step: () => T | Promise<T>): Promise<T> {
	const ci = process.env.CI;
	process.env.CI = '1';
	try {
		return await step();
	} finally {
		if (ci === undefined) delete process.env.CI;
		else process.env.CI = ci;
	}
}

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

describe('newWindowScript', () => {
	const place = { right: 10, top: 939 };
	const url = 'http://localhost:5550/tests/pages/runner.html?run=r1&runner=mac-google-chrome';

	it("opens Chrome's runner page in a new window, and parks that window", () => {
		expect(NEW_WINDOW_APPS.has('Google Chrome')).toBe(true);
		const script = newWindowScript('Google Chrome', url, place, SMALL_SIZE);
		expect(script).toContain('tell application "Google Chrome"');
		expect(script).toContain('set w to make new window');
		expect(script).toContain(`set URL of active tab of w to "${url}"`);
		expect(script).toContain('set bounds of w to {10 - (800), 939, 10, 939 + (600)}');
	});

	it("keeps the window's own size without one, and says when the page opened unparked", () => {
		const script = newWindowScript('Google Chrome', url, place);
		expect(script).toContain('set bounds of w to {10 - (c - a), 939, 10, 939 + (d - b)}');
		expect(script).toContain('return "opened"');
	});
});

describe('keepingFocus', () => {
	it('returns what the step returns, and leaves the app in front where it was', async () => {
		const before = frontApp();
		expect(await keepingFocus(async () => 42)).toBe(42);
		expect(frontApp()?.pid).toBe(before?.pid);
	});

	it('reads no app in front in CI', async () => {
		expect(await asInCI(frontApp)).toBeUndefined();
	});
});

describe('parkChromeWindow', () => {
	/** A DevTools connection to a Chrome page whose window is 1400 points wide; it records each call. */
	const chrome = () => {
		const calls: [string, object][] = [];
		const call = async (method: string, params: object) => {
			calls.push([method, params]);
			return method === 'Browser.getWindowForTarget'
				? { windowId: 7, bounds: { left: 100, top: 100, width: 1400, height: 880 } }
				: {};
		};
		return { calls, call };
	};

	it.skipIf(!personsMac)("moves the page's window past the main display's left edge", async () => {
		const { calls, call } = chrome();
		await parkChromeWindow(call, 't1');
		const { right, top } = parkedPlace(mainScreen());
		expect(calls).toEqual([
			['Browser.getWindowForTarget', { targetId: 't1' }],
			['Browser.setWindowBounds', { windowId: 7, bounds: { left: right - 1400, top } }],
		]);
	});

	it('leaves the window where Chrome put it in CI', async () => {
		const { calls, call } = chrome();
		await asInCI(() => parkChromeWindow(call));
		expect(calls).toEqual([]);
	});

	it.skipIf(!personsMac)('goes on when the window cannot move', async () => {
		await parkChromeWindow(() => Promise.reject(new Error('no window')));
	});
});
