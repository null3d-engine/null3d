// The headless runner: the project's own Vite dev server and a headless browser. It opens the
// project's pages in the engine's hold mode, and returns the frame that the engine drew, or the
// error that stopped it, with what the page and the server logged meanwhile.
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultEnvironment, launchBrowser } from './browser.js';
import { holdPath, readHold, watchConsole } from './page.js';
import { startDevServer } from './server.js';

/** @import { Browser, Page } from 'playwright-core' */
/** @import { Environment } from './browser.js' */
/** @import { HoldFailure, HoldReport, Tier } from './page.js' */
/** @import { DevServer } from './server.js' */

/**
 * @typedef {object} Runner
 * @property {DevServer} server The project's dev server.
 * @property {Browser} browser
 * @property {Environment} environment Where the browser draws.
 * @property {() => Promise<void>} close Stops the browser and the server.
 */

/**
 * @typedef {object} HoldOptions
 * @property {string} path The page, from the server's root, with any query of its own.
 * @property {number} [time] The sketch time to hold at, in seconds. Without it, the engine holds
 *   at the page's own hold time, or at 0.
 * @property {Tier} [gpu] The GPU tier to force. Without it, the engine picks one.
 * @property {readonly [number, number]} size The browser window's size in CSS pixels, at one
 *   device pixel per CSS pixel.
 * @property {number} timeoutMs How long the page may take to publish the held frame.
 */

/**
 * @typedef {object} HeldPage
 * @property {string} path The page with hold mode's switches.
 * @property {HoldReport} result The held frame, or the error that stopped the hold.
 * @property {string[]} errors The page's uncaught errors and console errors, then the dev
 *   server's errors.
 * @property {string[]} warnings The page's console warnings.
 * @property {number} ms Time from the page's navigation to the result, in milliseconds.
 */

/** How often the runner looks for hold mode's result. */
const POLL_MS = 100;

/**
 * Starts the Vite dev server of the project in the current folder, and a headless browser.
 *
 * @param {{ environment?: Environment }} [options]
 * @returns {Promise<Runner>}
 */
export async function startRunner({ environment = defaultEnvironment() } = {}) {
	const server = await startDevServer();
	try {
		const browser = await launchBrowser(environment);
		return {
			server,
			browser,
			environment,
			async close() {
				await browser.close();
				await server.close();
			},
		};
	} catch (error) {
		await server.close();
		throw error;
	}
}

/**
 * A failed hold with no error code, for a page that failed outside the engine.
 *
 * @param {string} error
 * @returns {HoldFailure}
 */
const failure = (error) => ({ ok: false, code: null, error });

/**
 * Opens a page in hold mode in a new browser window, and returns hold mode's result with what the
 * page and the dev server logged.
 *
 * @param {Runner} runner
 * @param {HoldOptions} options
 * @returns {Promise<HeldPage>}
 */
export async function holdPage({ server, browser }, { path, time, gpu, size, timeoutMs }) {
	const held = holdPath(path, { time, gpu });
	const url = new URL(held, server.url);
	// Vite answers an address that has no file with the project's main page, so a mistyped page
	// would draw that page instead.
	if (url.pathname.endsWith('.html') && !server.hasFile(decodeURIComponent(url.pathname)))
		return {
			path: held,
			result: failure(`the project has no page ${url.pathname}`),
			errors: [],
			warnings: [],
			ms: 0,
		};
	const [width, height] = size;
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		ignoreHTTPSErrors: true,
	});
	const serverErrors = server.errors.length;
	// Stacks name the server's address, whose port changes on every run: paths from its root stay.
	const fromRoot = (/** @type {string} */ text) => text.replaceAll(url.origin, '');
	try {
		const page = await context.newPage();
		const log = watchConsole(page);
		const started = performance.now();
		const result = await waitForHold(page, log.errors, url.href, timeoutMs);
		const logged = server.errors.slice(serverErrors).map((error) => `dev server error: ${error}`);
		return {
			path: held,
			result,
			errors: [...log.errors, ...logged].map(fromRoot),
			warnings: log.warnings.map(fromRoot),
			ms: Math.round(performance.now() - started),
		};
	} finally {
		await context.close();
	}
}

/**
 * Loads a page and waits for hold mode's result. A page that logged an error and has not started
 * the engine in hold mode by the time it loaded fails at once: a page script that throws, or a
 * module that fails to load, stops the page before it can start the engine.
 *
 * @param {Page} page
 * @param {readonly string[]} errors The page's errors so far, which grow while it runs.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<HoldReport>}
 */
async function waitForHold(page, errors, url, timeoutMs) {
	const seconds = timeoutMs / 1000;
	const deadline = performance.now() + timeoutMs;
	let crashed = false;
	page.on('crash', () => {
		crashed = true;
	});
	try {
		await page.goto(url, { timeout: timeoutMs });
	} catch (error) {
		return failure(`the page did not load: ${error instanceof Error ? error.message : error}`);
	}
	for (;;) {
		if (crashed) return failure('the browser tab crashed before the engine published a result');
		// A page that reloads, as Vite's dev server asks after it bundles new dependencies, has no
		// state to read for a moment.
		const state = await readHold(page).catch(() => ({ started: true, report: undefined }));
		if (state.report) return state.report;
		if (!state.started && errors.length > 0)
			return failure('the page failed before it started the engine in hold mode');
		if (performance.now() > deadline)
			return failure(
				state.started
					? `the engine published no held frame within ${seconds} s`
					: `the page did not start the engine in hold mode within ${seconds} s. Hold mode needs a page that starts the engine as it loads, with no click`,
			);
		await sleep(POLL_MS);
	}
}
