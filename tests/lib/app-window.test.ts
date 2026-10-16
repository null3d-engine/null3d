import { describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { REFRESH_MEASURE, refreshRate } from '../pages/lib/refresh-rate.ts';
import { parseArgs, timesOnThisMachine } from '../real-browsers.ts';
import {
	appWindow,
	BACKGROUND_PRIORITY,
	displayRateCheck,
	displayRateProblem,
	frontApp,
	keepingFocus,
	mainDisplayHz,
	mainScreen,
	PARKED_STRIP,
	parkChromeWindow,
	parkedPlace,
	parkScript,
	priorityProblem,
	processPriority,
	RUNNER_TITLE,
	SMALL_SIZE,
} from './app-window.ts';
import { COST_VARIABLES, timesFrames } from './priority-setup.ts';

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

describe('the display rate guard', () => {
	it('flags a reading below the expected rate by more than a twelfth', () => {
		expect(displayRateProblem(60, 120)).toBe('the display ran at 60 Hz (expected 120)');
		expect(displayRateProblem(109, 120)).toBe('the display ran at 109 Hz (expected 120)');
		expect(displayRateProblem(54, 60)).toBe('the display ran at 54 Hz (expected 60)');
		expect(displayRateProblem(null, 120)).toBe(
			'the page got no animation frames to measure the display rate',
		);
	});

	it('accepts a reading that holds the expected rate', () => {
		expect(displayRateProblem(110, 120)).toBeUndefined();
		expect(displayRateProblem(120, 120)).toBeUndefined();
		expect(displayRateProblem(55, 60)).toBeUndefined();
		expect(displayRateProblem(144, 120)).toBeUndefined();
	});

	it.skipIf(!personsMac)("reads the main display's highest rate", () => {
		expect(mainDisplayHz()).toBeGreaterThan(0);
	});

	it('knows no display rate in CI, and then measures nothing', async () => {
		expect(await asInCI(() => mainDisplayHz())).toBeUndefined();
		const page = {
			evaluate: () => Promise.reject(new Error('measured in CI')),
		} as unknown as Page;
		expect(await asInCI(() => displayRateCheck(page))).toBeUndefined();
	});
});

describe('the background priority guard', () => {
	const mac = process.platform === 'darwin';

	it('refuses background priority and accepts any higher one', () => {
		expect(priorityProblem(BACKGROUND_PRIORITY)).toContain('macOS background priority (4)');
		expect(priorityProblem(BACKGROUND_PRIORITY)).toContain('taskpolicy -b');
		expect(priorityProblem(5)).toBeUndefined();
		expect(priorityProblem(31)).toBeUndefined();
		expect(priorityProblem(undefined)).toBeUndefined();
	});

	it.skipIf(!mac)(
		'reads background priority from a process that taskpolicy -b started',
		async () => {
			const child = spawn('taskpolicy', ['-b', 'sleep', '10']);
			try {
				await new Promise((resolve) => setTimeout(resolve, 300));
				expect(processPriority(child.pid)).toBe(BACKGROUND_PRIORITY);
			} finally {
				child.kill();
			}
		},
	);

	/** What a script prints when it runs `call` at background priority: the refusal, or that it went on. */
	const atBackgroundPriority = (module: string, call: string) => {
		const script = `import * as tool from ${JSON.stringify(new URL(module, import.meta.url).pathname)};
try { await ${call}; console.log('WENT ON'); } catch (e) { console.log(e.message); }`;
		return spawnSync('taskpolicy', ['-b', process.execPath, '-e', script], {
			encoding: 'utf8',
			timeout: 30_000,
		}).stdout;
	};

	// The spawned bun pays its own start-up and imports, which under load outlast bun's 5 s default
	// and leave stdout empty; the spawn's own limit is 30 s, so let each test reach it.
	it.skipIf(!mac)(
		'stops a script at background priority before it starts a browser',
		() => {
			const stdout = atBackgroundPriority('./app-window.ts', 'tool.launchInWindow()');
			expect(stdout).toContain('macOS background priority');
			expect(stdout).not.toContain('WENT ON');
		},
		30_000,
	);

	it.skipIf(!mac)(
		"stops Playwright's runs that time frames at background priority, and lets the others start",
		() => {
			const stdout = atBackgroundPriority('./priority-setup.ts', 'tool.default()');
			if (process.env.CI) expect(stdout).toContain('WENT ON');
			else expect(stdout).toContain('macOS background priority');
		},
		30_000,
	);

	it('judges which Playwright runs time frames', () => {
		expect(timesFrames({})).toBe(true);
		expect(timesFrames({ CI: '1' })).toBe(false);
		for (const name of COST_VARIABLES) expect(timesFrames({ CI: '1', [name]: '1' })).toBe(true);
	});

	it('knows the variable of every spec that times an effect', () => {
		const folder = new URL('../image/', import.meta.url);
		const used = readdirSync(folder)
			.filter((file) => file.endsWith('.spec.ts'))
			.flatMap((file) => [
				...readFileSync(new URL(file, folder), 'utf8').matchAll(/NULL3D_\w+_COST\b/g),
			])
			.map(([name]) => name);
		expect(used.length).toBeGreaterThan(0);
		expect([...new Set(used)].sort()).toEqual([...COST_VARIABLES].sort());
	});

	it("refuses background priority only for the runner's timed plans in this machine's browser apps", () => {
		expect(timesOnThisMachine(parseArgs(['--plan', 'bench', 'Safari']))).toBe(true);
		expect(timesOnThisMachine(parseArgs(['--plan', 'scale', 'Safari']))).toBe(true);
		expect(timesOnThisMachine(parseArgs(['--plan', 'smoke', 'Safari']))).toBe(false);
		expect(timesOnThisMachine(parseArgs(['--plan', 'bench', '--lan', 'ipad-safari']))).toBe(false);
	});

	it("reads this process's priority on macOS only", () => {
		if (mac) expect(processPriority()).toBeGreaterThan(0);
		else expect(processPriority()).toBeUndefined();
	});
});

describe('refreshRate', () => {
	/**
	 * Runs the measurement as a browser gets it, rebuilt from its source text, in a scope whose
	 * animation frames come every `intervalMs` or never; it returns the rate and the shades it set.
	 */
	async function measure(intervalMs: number | null, limitMs = 20_000) {
		const shades: string[] = [];
		const style = {
			set backgroundColor(shade: string) {
				shades.push(shade);
			},
		};
		let time = 0;
		const scope = globalThis as unknown as Record<string, unknown>;
		const saved = { document: scope.document, requestAnimationFrame: scope.requestAnimationFrame };
		scope.document = { documentElement: { style }, getElementById: () => null };
		scope.requestAnimationFrame = (tick: (time: number) => void) => {
			if (intervalMs !== null)
				queueMicrotask(() => {
					time += intervalMs;
					tick(time);
				});
			return 0;
		};
		try {
			const rebuilt = new Function(`return (${refreshRate.toString()})`)() as typeof refreshRate;
			return { hz: await rebuilt({ ...REFRESH_MEASURE, limitMs }), shades };
		} finally {
			Object.assign(scope, saved);
		}
	}

	it('gives the rate of the frames from their median interval, and uses nothing from outside', async () => {
		expect((await measure(1000 / 120)).hz).toBe(120);
		expect((await measure(1000 / 60)).hz).toBe(60);
	});

	it('changes the background on every other frame, and clears it at the end', async () => {
		const { shades } = await measure(1000 / 60);
		expect(shades.slice(0, 2)).toEqual([REFRESH_MEASURE.shade, '']);
		expect(shades.at(-1)).toBe('');
	});

	it('gives null when no frames come within the time limit', async () => {
		expect((await measure(null, 10)).hz).toBeNull();
	});
});
