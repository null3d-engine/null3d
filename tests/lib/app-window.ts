// How the runner tool shows a browser app's runner page on a Mac without disturbing the person who
// works there. The app opens in the background, so it takes no focus. Safari's and Firefox's runner
// windows then move to the bottom right corner of the main display, at a small size. A window that
// other windows cover in full gets no animation frames, but a corner window stays partly in view
// unless a window covers that corner too. Plans that time frames keep the window's own size, since a
// page that fills the window draws fewer pixels in a small one.

import { execFileSync } from 'node:child_process';
import { type Browser, chromium, type LaunchOptions } from '@playwright/test';

/** How the runner tool opens a browser app's window on a Mac. */
export interface AppWindow {
	/** The app opens without coming to the front, so it takes no focus from the person at the Mac. */
	background: boolean;
	/** The runner page's window moves to a corner of the main display, at a small size. */
	corner: boolean;
}

/**
 * How browser apps open for a run. The background and the corner are the default for a person's Mac.
 * CI's Mac has nobody to disturb, and macOS asks there whether the tool may control the app, which
 * nobody can answer, so apps open there as a person opens them. `front` asks for that on any Mac.
 * Timed plans keep the window's size.
 */
export function appWindow(front: boolean, ci: boolean, timed: boolean): AppWindow {
	const background = !front && !ci;
	return { background, corner: background && !timed };
}

/** The size of the corner window in points: small, but larger than every image test's canvas. */
export const CORNER_SIZE = { width: 800, height: 600 } as const;

/** The title of the runner page, which Firefox's windows show and its scripting can read. */
export const RUNNER_TITLE = 'null3d runner';

/** The main display's height, and the part of it that the menu bar and the Dock leave, in points. */
export interface MainScreen {
	height: number;
	/** The free part's corner nearest the screen's bottom left, in points from there. */
	x: number;
	y: number;
	width: number;
	freeHeight: number;
}

/**
 * The window bounds in the bottom right corner of the main display's free part, as AppleScript
 * takes them: left, top, right and bottom, in points from the screen's top left. A window larger
 * than the free part shrinks to fit it.
 */
export function cornerBounds(
	screen: MainScreen,
	size: { width: number; height: number } = CORNER_SIZE,
): [number, number, number, number] {
	const right = screen.x + screen.width;
	const bottom = screen.height - screen.y;
	const top = bottom - screen.freeHeight;
	return [
		Math.max(screen.x, right - size.width),
		Math.max(top, bottom - size.height),
		right,
		bottom,
	];
}

/**
 * The AppleScript that finds the window that shows a runner page and moves it to `bounds`. It looks
 * again every tenth of a second for up to 10 seconds, since the page loads after the app opens it.
 * Safari's scripting reads each window's address, so a window of an older runner page never moves.
 * Firefox's reads only the window's title.
 */
export function placeScript(
	app: string,
	query: string,
	bounds: readonly [number, number, number, number],
): string {
	const shows =
		app === 'Safari'
			? `URL of current tab of w contains "${query}"`
			: `name of w contains "${RUNNER_TITLE}"`;
	return [
		`tell application "${app}"`,
		'\trepeat 100 times',
		'\t\trepeat with w in windows',
		'\t\t\ttry',
		`\t\t\t\tif ${shows} then`,
		`\t\t\t\t\tset bounds of w to {${bounds.join(', ')}}`,
		'\t\t\t\t\treturn "placed"',
		'\t\t\t\tend if',
		'\t\t\tend try',
		'\t\tend repeat',
		'\t\tdelay 0.1',
		'\tend repeat',
		'end tell',
		'return "not found"',
	].join('\n');
}

/** The apps whose runner window the tool can move: their scripting sets a window's bounds. */
export const PLACED_APPS: ReadonlySet<string> = new Set(['Safari', 'Firefox']);

/** Reads the main display's size and free part through AppKit, which needs no permission. */
function mainScreen(): MainScreen {
	const script =
		'ObjC.import("AppKit"); const s = $.NSScreen.screens.objectAtIndex(0); const f = s.visibleFrame;' +
		' JSON.stringify({ height: s.frame.size.height, x: f.origin.x, y: f.origin.y, width: f.size.width, freeHeight: f.size.height })';
	return JSON.parse(
		execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
			encoding: 'utf8',
			timeout: 10_000,
		}),
	) as MainScreen;
}

/**
 * Moves the window that shows the runner page at `url` to the main display's corner, and returns
 * undefined when it did, or why it did not. macOS asks once whether the terminal may control each
 * app, under Privacy & Security, Automation; without that permission, the window stays where the
 * app put it.
 */
export function placeInCorner(app: string, url: string): string | undefined {
	try {
		const query = url.slice(url.indexOf('?') + 1);
		const script = placeScript(app, query, cornerBounds(mainScreen()));
		const answer = execFileSync('osascript', ['-e', script], {
			encoding: 'utf8',
			timeout: 15_000,
		}).trim();
		return answer === 'placed' ? undefined : 'no window showed the runner page';
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

/**
 * The app in front on this Mac, or undefined on other machines, in CI, or when macOS does not say.
 * Reading it needs no permission.
 */
export function frontApp(): MacApp | undefined {
	if (process.platform !== 'darwin' || process.env.CI) return undefined;
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
 * Starts Chrome, or another Chromium browser, in a window through Playwright, with the switches that
 * keep it drawing at full speed behind other windows. Focus then goes back to the app in front
 * before. The window keeps its full size, since the tools that use it time frames or capture them.
 */
export function launchInWindow(options: LaunchOptions = {}): Promise<Browser> {
	return keepingFocus(() =>
		chromium.launch({
			...options,
			headless: false,
			args: [...(options.args ?? []), ...KEEP_DRAWING_ARGS],
		}),
	);
}
