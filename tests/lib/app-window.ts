// How the runner tool and the tools that run Chrome show a browser's page on a Mac without disturbing
// the person who works there. The browser opens in the background, or gives focus back, so it takes
// no focus. Its window then moves almost wholly past the left edge of the main display, where it
// covers nothing: macOS keeps a strip of the title bar on the screen. A new window of an app in the
// background opens above every app's windows but the front app's, and macOS lets no other process
// push it lower, so the tools move it out of the way instead. Safari, Firefox and Chrome draw at full
// speed there, and under other windows. None draws once the app hides, and Safari drew at half speed
// on a second display, so the tools do neither. Plans that time frames keep the window's own size,
// since a page that fills the window draws fewer pixels in a small one.

import { execFileSync } from 'node:child_process';
import {
	type Browser,
	type BrowserContextOptions,
	chromium,
	type LaunchOptions,
	type Page,
} from '@playwright/test';

/** How the runner tool opens a browser app's window on a Mac. */
export interface AppWindow {
	/** The app opens without coming to the front, so it takes no focus from the person at the Mac. */
	background: boolean;
	/** The runner page's window moves almost wholly past the main display's left edge. */
	park: boolean;
	/** The parked window takes the small size, rather than keeping its own. */
	small: boolean;
}

/**
 * How browser apps open for a run. The background and the parked window are the default for a
 * person's Mac. CI's Mac has nobody to disturb, and macOS asks there whether the tool may control the
 * app, which nobody can answer, so apps open there as a person opens them. `front` asks for that on
 * any Mac. Timed plans keep the window's own size.
 */
export function appWindow(front: boolean, ci: boolean, timed: boolean): AppWindow {
	const background = !front && !ci;
	return { background, park: background, small: !timed };
}

/** The size of the small window in points: larger than every image test's canvas. */
export const SMALL_SIZE = { width: 800, height: 600 } as const;

/** How much of the parked window's width stays on the main display, in points. */
export const PARKED_STRIP = 10;

/** The title of the runner page, which Firefox's windows show and its scripting can read. */
export const RUNNER_TITLE = 'null3d runner';

/** The main display's height, and where the part that the menu bar and the Dock leave ends. */
export interface MainScreen {
	height: number;
	/** The free part's corner nearest the screen's bottom left, in points from there. */
	x: number;
	y: number;
}

/**
 * Where a parked window goes, as AppleScript counts: its right edge and top, in points from the main
 * display's top left. Only a strip of the window stays on the display, and its top starts at the
 * bottom of the display's free part. macOS then moves it up until its title bar shows.
 */
export function parkedPlace(screen: MainScreen): { right: number; top: number } {
	return { right: screen.x + PARKED_STRIP, top: screen.height - screen.y };
}

/**
 * The AppleScript that finds the window that shows a runner page and parks it, at `size` or at its
 * own size. It looks again every tenth of a second for up to 10 seconds, since the page loads after
 * the app opens it. Safari's scripting reads each window's address, so a window of an older runner
 * page never moves. Firefox's reads only the window's title.
 */
export function parkScript(
	app: string,
	query: string,
	place: { right: number; top: number },
	size?: { width: number; height: number },
): string {
	const shows =
		app === 'Safari'
			? `URL of current tab of w contains "${query}"`
			: `name of w contains "${RUNNER_TITLE}"`;
	const [width, height] = size ? [size.width, size.height] : ['c - a', 'd - b'];
	return [
		`tell application "${app}"`,
		'	repeat 100 times',
		'		repeat with w in windows',
		'			try',
		`				if ${shows} then`,
		'					set {a, b, c, d} to bounds of w',
		`					set bounds of w to {${place.right} - (${width}), ${place.top}, ${place.right}, ${place.top} + (${height})}`,
		'					return "parked"',
		'				end if',
		'			end try',
		'		end repeat',
		'		delay 0.1',
		'	end repeat',
		'end tell',
		'return "not found"',
	].join('\n');
}

/** The apps whose runner window the tool can move: their scripting sets a window's bounds. */
export const PARKED_APPS: ReadonlySet<string> = new Set(['Safari', 'Firefox']);

/** Reads the main display's size and free part through AppKit, which needs no permission. */
export function mainScreen(): MainScreen {
	const script =
		'ObjC.import("AppKit"); const s = $.NSScreen.screens.objectAtIndex(0); const f = s.visibleFrame;' +
		' JSON.stringify({ height: s.frame.size.height, x: f.origin.x, y: f.origin.y })';
	return JSON.parse(
		execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
			encoding: 'utf8',
			timeout: 10_000,
		}),
	) as MainScreen;
}

/**
 * Parks the window that shows the runner page at `url`, small or at its own size, and returns
 * undefined when it did, or why it did not. macOS asks once whether the terminal may control each
 * app, under Privacy & Security, Automation; without that permission, the window stays where the
 * app put it.
 */
export function parkWindow(app: string, url: string, small: boolean): string | undefined {
	try {
		const query = url.slice(url.indexOf('?') + 1);
		const script = parkScript(
			app,
			query,
			parkedPlace(mainScreen()),
			small ? SMALL_SIZE : undefined,
		);
		const answer = execFileSync('osascript', ['-e', script], {
			encoding: 'utf8',
			timeout: 15_000,
		}).trim();
		return answer === 'parked' ? undefined : 'no window showed the runner page';
	} catch (e) {
		const { stderr, message } = e as Error & { stderr?: string };
		return (stderr?.trim() || message.split('\n')[0]) ?? 'failed';
	}
}

/** An app on this Mac: its process and its bundle's path. */
export interface MacApp {
	pid: number;
	path: string;
}

/** Runs a JavaScript for Automation script through osascript and returns its output. */
const jxa = (script: string) =>
	execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
		encoding: 'utf8',
		timeout: 10_000,
	}).trim();

/** Whether this machine is a Mac with a person at it: CI's Mac has nobody to disturb. */
const personsMac = () => process.platform === 'darwin' && !process.env.CI;

/**
 * The app in front on this Mac, or undefined on other machines, in CI, or when macOS does not say.
 * Reading it needs no permission.
 */
export function frontApp(): MacApp | undefined {
	if (!personsMac()) return undefined;
	try {
		return JSON.parse(
			jxa(
				'ObjC.import("AppKit"); const a = $.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({ pid: a.processIdentifier, path: a.bundleURL.path.js })',
			),
		) as MacApp;
	} catch {
		return undefined;
	}
}

/**
 * Brings `app` back to the front when another app took it, as a browser that opens a window does.
 * It asks the app's process first. macOS may refuse that to a process in the background, so then it
 * opens the app's bundle, which always brings an app that is running to the front.
 */
export function giveFocusBack(app: MacApp | undefined): void {
	if (!app) return;
	const front = () => frontApp()?.pid;
	try {
		if (front() === app.pid) return;
		jxa(
			`ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${app.pid}).activateWithOptions(0)`,
		);
		if (front() !== app.pid && frontApp()?.path !== app.path)
			execFileSync('open', ['-a', app.path], { timeout: 10_000 });
	} catch {
		// Focus that cannot come back stays with the browser; the run goes on.
	}
}

/** Runs `step`, such as a browser's launch or a new window, then gives focus back to the app in front before it. */
export async function keepingFocus<T>(step: () => Promise<T>): Promise<T> {
	const before = frontApp();
	try {
		return await step();
	} finally {
		giveFocusBack(before);
	}
}

/**
 * Switches that keep a window in the background, or covered by other windows, drawing at full speed,
 * so timings hold while the person at the Mac works in front of it. Playwright passes them too.
 */
export const KEEP_DRAWING_ARGS = [
	'--disable-backgrounding-occluded-windows',
	'--disable-renderer-backgrounding',
	'--disable-background-timer-throttling',
];

/**
 * Chrome's switch that opens each new window on the main display, toward the parked place, or none on
 * other machines, in CI, or when macOS does not say where the display is. Chrome moves such a window
 * wholly onto the display, so the switch cannot park it. Without the switch, Chrome opened windows on
 * the second display, which cut their size to fit that smaller screen.
 */
function mainDisplaySwitch(): string[] {
	if (!personsMac()) return [];
	try {
		const { right, top } = parkedPlace(mainScreen());
		return [`--window-position=${right},${top}`];
	} catch {
		return [];
	}
}

/**
 * Starts Chrome, or another Chromium browser, in a window through Playwright, with the switches that
 * keep it drawing at full speed behind other windows. On a person's Mac, each window opens on the
 * main display. Focus then goes back to the app in front before. Each page then opens through
 * `newParkedPage`, or `parkChromeWindow` parks its window.
 */
export function launchInWindow(options: LaunchOptions = {}): Promise<Browser> {
	return keepingFocus(() =>
		chromium.launch({
			...options,
			headless: false,
			args: [...(options.args ?? []), ...KEEP_DRAWING_ARGS, ...mainDisplaySwitch()],
		}),
	);
}

/** Sends one DevTools call to Chrome and returns its result. */
export type DevToolsCall = (method: string, params: object) => Promise<unknown>;

let chromeUnparked = false;

/**
 * Parks the Chrome window that holds a page almost wholly past the main display's left edge, at its
 * own size, since the tools that use Chrome time frames or capture them. DevTools moves the window,
 * so macOS asks for no permission. `targetId` names the page on a connection to the whole browser.
 * In CI, and when the move fails, the window stays where Chrome put it.
 */
export async function parkChromeWindow(call: DevToolsCall, targetId?: string): Promise<void> {
	if (!personsMac()) return;
	try {
		const { windowId, bounds } = (await call(
			'Browser.getWindowForTarget',
			targetId ? { targetId } : {},
		)) as { windowId: number; bounds: { width: number } };
		const { right, top } = parkedPlace(mainScreen());
		await call('Browser.setWindowBounds', {
			windowId,
			bounds: { left: right - bounds.width, top },
		});
	} catch (e) {
		if (!chromeUnparked)
			console.warn(`Chrome's window stays where Chrome put it: ${(e as Error).message}`);
		chromeUnparked = true;
	}
}

/**
 * Opens a page in a new window of a browser from `launchInWindow`, parks the window, and gives focus
 * back to the app in front before. Playwright sizes the window to the page's viewport as the page
 * opens, so the window parks at that size.
 */
export function newParkedPage(browser: Browser, options?: BrowserContextOptions): Promise<Page> {
	return keepingFocus(async () => {
		const page = await browser.newPage(options);
		const session = await page.context().newCDPSession(page);
		await parkChromeWindow((method, params) =>
			session.send(method as 'Browser.setWindowBounds', params as never),
		);
		await session.detach();
		return page;
	});
}
