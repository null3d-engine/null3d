// The headless browsers that draw frames: Google Chrome on the computer's own GPU, or Playwright's
// Chromium on SwiftShader, the software GPU that machines without a GPU use, such as CI machines.
// The two draw object edges a little differently, so each keeps its own reference images.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

/** @import { Browser, LaunchOptions } from 'playwright-core' */

/**
 * The places that draw frames: Chromium on SwiftShader, and Chrome on the real GPU.
 *
 * @type {readonly ['chromium-swiftshader', 'chrome-real-gpu']}
 */
export const ENVIRONMENTS = ['chromium-swiftshader', 'chrome-real-gpu'];

/** @typedef {(typeof ENVIRONMENTS)[number]} Environment */

/** Chromium flags for WebGPU and WebGL2 on SwiftShader, the software GPU. */
export const SWIFTSHADER_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--ignore-gpu-blocklist',
	'--no-sandbox',
	'--hide-scrollbars',
];

/** The flag that turns on WebGPU's developer features, without which Chrome rounds GPU timestamps. */
export const WEBGPU_DEVELOPER_FEATURES = '--enable-webgpu-developer-features';

/**
 * How Playwright starts an environment's browser. On a Mac, Playwright's own headless Chromium
 * falls back to SwiftShader, so the real GPU needs the installed Google Chrome.
 *
 * @param {Environment} environment
 * @returns {LaunchOptions}
 */
export function browserOptions(environment) {
	return environment === 'chrome-real-gpu' ? { channel: 'chrome' } : { args: SWIFTSHADER_ARGS };
}

/**
 * The environment that draws when none is asked for: SwiftShader when the CI variable is set, as
 * CI machines have no GPU, and the real GPU elsewhere.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Environment}
 */
export function defaultEnvironment(env = process.env) {
	return env.CI ? 'chromium-swiftshader' : 'chrome-real-gpu';
}

/** The version of Playwright's browser driver, whose own Chromium build the SwiftShader runs need. */
function driverVersion() {
	const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	return /** @type {string} */ (manifest.dependencies['playwright-core']);
}

/**
 * What to do when an environment's browser is not installed.
 *
 * @param {Environment} environment
 */
export function missingBrowserFix(environment) {
	const chromium = `bunx playwright-core@${driverVersion()} install chromium`;
	return environment === 'chrome-real-gpu'
		? `Google Chrome is not installed. Install it from https://www.google.com/chrome/, or set CI=1 to draw on the software GPU of Playwright's Chromium, which ${chromium} installs.`
		: `Playwright's Chromium is not installed. Install it with ${chromium}.`;
}

/** The code that starts the message of a call that failed because its browser's process ended. */
export const BROWSER_GONE = 'BROWSER_GONE';

/** How often the guard checks that a browser's process still runs. */
const WATCH_MS = 500;

/** How long Playwright gets to notice an ended browser itself before the guard fails its calls. */
const NOTICE_MS = 2000;

/**
 * What a guarded browser needs: Playwright's own state, and the client connection that it sends on.
 *
 * @typedef {{ isConnected(): boolean, on(event: 'disconnected', listener: () => void): unknown, _connection?: { close(cause: string): void } }} Watched
 */

/**
 * Fails every call of `browser` that waits, at once, when its process `pid` ends and Playwright
 * has not noticed within a moment. A script in Bun needs it: some Bun releases close Playwright's
 * pipe to the browser at random, and the browser then ends, while Playwright waits forever on it,
 * past its own time limits. Playwright's client connection fails each waiting call with a message
 * that starts with BROWSER_GONE. A browser that Playwright saw end, as on its close, needs nothing.
 *
 * @param {Watched} browser
 * @param {number} pid
 * @param {{ alive?: (pid: number) => boolean, watchMs?: number, noticeMs?: number }} [options]
 */
export function watchBrowser(browser, pid, options = {}) {
	const { alive = processAlive, watchMs = WATCH_MS, noticeMs = NOTICE_MS } = options;
	const timer = setInterval(() => {
		if (alive(pid)) return;
		clearInterval(timer);
		setTimeout(() => {
			if (!browser.isConnected()) return;
			const cause = `${BROWSER_GONE}: the browser's process (${pid}) ended while Playwright still waited on it. Bun before 1.4.3 closes Playwright's pipe to the browser at random, and Playwright never notices; see the fresh-project test in .dev/releases.md`;
			if (browser._connection) browser._connection.close(cause);
			else {
				console.error(cause);
				process.exit(1);
			}
		}, noticeMs).unref?.();
	}, watchMs);
	timer.unref?.();
	browser.on('disconnected', () => clearInterval(timer));
}

/**
 * Whether a process runs, from its state as `ps` gives it: a process that ended but that its parent
 * has not reaped yet still exists, in state Z. Bun can leave the browser so, when it misses its end.
 *
 * @param {string} state
 */
export function runningState(state) {
	const code = state.trim();
	return code !== '' && !code.startsWith('Z');
}

/** @param {number} pid */
function processAlive(pid) {
	try {
		return runningState(
			execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }),
		);
	} catch {
		// ps fails when no process has the ID.
		return false;
	}
}

/** The browsers that Playwright started from this process, which it drives over a pipe. */
function pipedBrowsers() {
	try {
		return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' })
			.split('\n')
			.map((line) => line.trim().split(/\s+/))
			.filter(
				([, ppid, ...args]) =>
					Number(ppid) === process.pid && args.includes('--remote-debugging-pipe'),
			)
			.map(([pid]) => Number(pid));
	} catch {
		return [];
	}
}

/** The launch that runs, so that each launch finds its own new browser process. */
let launching = Promise.resolve();

/**
 * Starts Chromium or Chrome through Playwright with `options`. In Bun, `watchBrowser` guards the
 * browser, so its calls fail at once if its process ends under Playwright. Launches run one at a
 * time in Bun, so each finds the one browser process that it started.
 *
 * @param {LaunchOptions} options
 * @returns {Promise<Browser>}
 */
export function launchChromium(options) {
	if (!process.versions.bun) return chromium.launch(options);
	const launch = launching.then(async () => {
		const before = new Set(pipedBrowsers());
		const browser = await chromium.launch(options);
		const started = pipedBrowsers().filter((pid) => !before.has(pid));
		if (started.length === 1 && started[0] !== undefined)
			watchBrowser(/** @type {Watched} */ (/** @type {unknown} */ (browser)), started[0]);
		return browser;
	});
	launching = launch.then(
		() => undefined,
		() => undefined,
	);
	return launch;
}

/**
 * Starts an environment's browser, headless, with any `args` besides its own flags. A browser that
 * is not installed fails with the fix.
 *
 * @param {Environment} environment
 * @param {readonly string[]} [args]
 * @returns {Promise<Browser>}
 */
export async function launchBrowser(environment, args = []) {
	const options = browserOptions(environment);
	try {
		return await launchChromium({
			headless: true,
			...options,
			args: [...(options.args ?? []), ...args],
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/Executable doesn't exist|is not found at/.test(message))
			throw new Error(missingBrowserFix(environment));
		throw error;
	}
}
