import { describe, expect, it } from 'bun:test';
import { BROWSER_GONE, runningState, watchBrowser } from './browser.js';

/**
 * A browser as the guard sees it: connected until `noticed`, with a client connection that records
 * the cause that it closed with, and a process that runs while `running` says so.
 */
function fakeBrowser() {
	const state = { running: true, noticed: false, closedWith: undefined as string | undefined };
	const listeners: (() => void)[] = [];
	const browser = {
		isConnected: () => !state.noticed,
		on: (_event: 'disconnected', listener: () => void) => listeners.push(listener),
		_connection: {
			close: (cause: string) => {
				state.closedWith = cause;
			},
		},
	};
	const disconnect = () => {
		state.noticed = true;
		for (const listener of listeners) listener();
	};
	return { browser, state, disconnect, alive: () => state.running };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('watchBrowser', () => {
	it("fails the browser's waiting calls when its process ends and Playwright does not notice", async () => {
		const { browser, state, alive } = fakeBrowser();
		watchBrowser(browser, 4242, { alive, watchMs: 5, noticeMs: 10 });
		await wait(30);
		expect(state.closedWith).toBeUndefined();
		state.running = false;
		await wait(60);
		expect(state.closedWith).toStartWith(`${BROWSER_GONE}: the browser's process (4242) ended`);
		expect(state.closedWith).toContain("closes Playwright's pipe");
	});

	it('leaves a browser alone that Playwright saw end', async () => {
		const { browser, state, alive, disconnect } = fakeBrowser();
		watchBrowser(browser, 4242, { alive, watchMs: 5, noticeMs: 10 });
		state.running = false;
		disconnect();
		await wait(60);
		expect(state.closedWith).toBeUndefined();
	});

	it('leaves a browser alone that Playwright notices within a moment of its end, as on a close', async () => {
		const { browser, state, alive, disconnect } = fakeBrowser();
		watchBrowser(browser, 4242, { alive, watchMs: 5, noticeMs: 40 });
		state.running = false;
		await wait(15);
		state.noticed = true;
		await wait(60);
		expect(state.closedWith).toBeUndefined();
		disconnect();
	});
});

describe('runningState', () => {
	it('counts a process that ended but was not reaped as ended', () => {
		expect(runningState('Zs\n')).toBe(false);
		expect(runningState('Z')).toBe(false);
		expect(runningState('')).toBe(false);
		expect(runningState('Sl\n')).toBe(true);
		expect(runningState('R+')).toBe(true);
	});
});
