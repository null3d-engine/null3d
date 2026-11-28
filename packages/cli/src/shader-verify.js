// null3d shaders verify: builds the project for production with its shader list, serves the
// build, drives each live page on the GPU paths, and fails when the engine reports a word that the
// list lacks. A mesh pipeline whose word is missing draws nothing, so the check finds the word
// without the page losing its whole scene. A full-screen pass has no draw to skip, so its missing
// word stops the page, and the page's error names it.
import { setTimeout as sleep } from 'node:timers/promises';
import { readArguments, readMilliseconds, UsageError } from './args.js';
import { defaultEnvironment, launchBrowser } from './browser.js';
import { switchedPath } from './page.js';
import { startBuildServer } from './server.js';
import { loadSteps, requestWatch, scrollToEnd, sweepHud } from './shader-record.js';

/** @import { Page } from 'playwright-core' */

/** The GPU paths that `verify` drives unless `--gpu` names one. */
const TIERS = ['webgpu', 'webgl2'];

/** How long a page may take to load and start, in ms. */
const LOAD_MS = 120_000;

/** How long the page rests after its states are driven, so a late pipeline reports its word. */
const SETTLE_MS = 5_000;

const OPTIONS = /** @type {const} */ ({
	base: { type: 'string' },
	live: { type: 'string', multiple: true },
	click: { type: 'string' },
	scroll: { type: 'boolean', default: false },
	'scroll-dwell': { type: 'string' },
	steps: { type: 'string' },
	gpu: { type: 'string' },
	'settle-ms': { type: 'string' },
	'max-ms': { type: 'string' },
	'timeout-ms': { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli shaders verify [options]

Builds the project for production with the shader list that the Vite plugin's shaders.list option
names, serves the build, drives each live page on both GPU paths, and fails when the engine reports
a permutation word that the list lacks. A mesh pipeline whose word is missing draws nothing, so the
scene stays, and this check names the state that reached it. Record the pages again with
bunx @null3d/cli shaders record, or add the word with --extra, and build again.

Options:
  --base <url>              The address of a server that serves a production build with the
                            project's shader list. Without it, the command builds the project and
                            serves the build itself
  --live <path>             A page to drive. Repeat it for each page (/)
  --click <selector>        An element to press after each page loads, for a page whose engine
                            starts on a click, such as "#play"
  --steps <file>            A module whose default export, or steps export, is a function of
                            { page, log, path } that drives the page through its states. Use it
                            for action-gated and time-based states
  --scroll                  Scroll each live page down to its end, one window's height at a time
  --scroll-dwell <ms>       Rest after each scroll step, so a state that arrives with time reaches
                            its word (0)
  --gpu <path>              Check webgpu or webgl2 alone, or both, joined by a comma
                            (webgpu,webgl2)
  --settle-ms <ms>          Rest after the states are driven, so a late pipeline reports its word
                            (5000)
  --max-ms <ms>             The longest a page may draw before the check reads its words (60000)
  --timeout-ms <ms>         The longest a page may take to load and start (120000)

The check fails as a whole when any page on any path lacks a word. It prints each missing word,
the page, the path and the pipeline that asked for it.`;

/**
 * The options that `args` gives the verify subcommand.
 *
 * @param {readonly string[]} args The arguments after `verify`.
 */
export function parseVerifyArgs(args) {
	const { values } = readArguments(args, OPTIONS, false);
	const { base, click, scroll, steps, gpu, help } = values;
	if (base !== undefined && !/^https?:\/\//.test(base))
		throw new UsageError(`--base takes an address such as https://localhost:5173, not "${base}"`);
	const live = values.live ?? [];
	for (const path of live)
		if (/^[a-z][a-z0-9+.-]*:/i.test(path) || !path.startsWith('/'))
			throw new UsageError(`--live takes a path from the server's root, such as /, not "${path}"`);
	const tiers = gpu === undefined ? [...TIERS] : gpu.split(',').filter((tier) => tier !== '');
	for (const tier of tiers)
		if (!TIERS.includes(tier))
			throw new UsageError(`--gpu takes ${TIERS.join(' or ')}, not "${tier}"`);
	if (tiers.length === 0) throw new UsageError('--gpu names no GPU path');
	return {
		base,
		live: live.length === 0 ? ['/'] : live,
		click,
		scroll,
		scrollDwell:
			values['scroll-dwell'] === undefined
				? 0
				: readMilliseconds('--scroll-dwell', values['scroll-dwell']),
		steps,
		tiers,
		settleMs:
			values['settle-ms'] === undefined
				? SETTLE_MS
				: readMilliseconds('--settle-ms', values['settle-ms']),
		maxMs:
			values['max-ms'] === undefined
				? 60_000
				: readMilliseconds('--max-ms', values['max-ms'], { above: true }),
		timeoutMs:
			values['timeout-ms'] === undefined
				? LOAD_MS
				: readMilliseconds('--timeout-ms', values['timeout-ms'], { above: true }),
		help,
	};
}

/**
 * The address that checks `path` on `tier`. The `bench` switch publishes the engine on the page,
 * so the check waits for the first frame instead of guessing when the page is ready.
 *
 * @param {string} base
 * @param {string} path
 * @param {string} tier
 */
export function verifyUrl(base, path, tier) {
	const address = new URL(`${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`);
	const switched = new URL(
		switchedPath(`${address.pathname}${address.search}`, { gpu: tier, bench: '' }),
		base,
	);
	return switched.href;
}

/**
 * Drives one page on one GPU path and gives the words that the engine reported missing, and the
 * page errors that name a missing word.
 *
 * @param {Page} page
 * @param {{
 *   path: string,
 *   settleMs: number,
 *   maxMs: number,
 *   timeoutMs: number,
 *   click?: string,
 *   scroll: boolean,
 *   scrollDwell: number,
 *   steps?: (context: { page: Page, log: (line: string) => void, path: string }) => Promise<void> | void,
 *   log: (line: string) => void,
 * }} options
 * @returns {Promise<{ pipeline: string, word: number }[]>}
 */
async function missingOnPage(page, options) {
	const { path, settleMs, maxMs, scroll, scrollDwell, steps, log } = options;
	/** @type {string[]} */
	const problems = [];
	page.on('pageerror', (error) => problems.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') problems.push(message.text());
	});
	await page.waitForFunction(
		() =>
			/** @type {{ __null3dMissingWords?: number[] }} */ (globalThis).__null3dMissingWords !==
			undefined,
		undefined,
		{ timeout: options.timeoutMs, polling: 100 },
	);
	// The first frame builds the scene's first pipelines. A switch that a build ignores leaves the
	// engine's own choice, which is a path that the device has.
	await page.evaluate(() => {
		const engine = /** @type {{ __null3dEngine?: { firstFrame: Promise<unknown> } }} */ (globalThis)
			.__null3dEngine;
		return engine?.firstFrame ?? Promise.resolve();
	});
	if (options.click !== undefined)
		await page.locator(options.click).first().click({ timeout: 30_000 });
	if (steps !== undefined) await steps({ page, log, path });
	else {
		await sweepHud(page);
		if (scroll) {
			const watch = requestWatch(page);
			await scrollToEnd(page, watch, scrollDwell);
		}
	}
	await sleep(Math.min(settleMs, maxMs));
	const reported = await page.evaluate(() => {
		const words = /** @type {{ __null3dMissingWords?: number[] }} */ (globalThis)
			.__null3dMissingWords;
		return words ?? [];
	});
	return missingWordsOf(reported, problems);
}

/**
 * The words that a page lacked: those that it published for its mesh pipelines, and those that a
 * full-screen pass named in a page error. A word from an error is negative, because the error
 * carries the text and not the number.
 *
 * @param {readonly number[]} reported
 * @param {readonly string[]} problems
 * @returns {{ pipeline: string, word: number }[]}
 */
export function missingWordsOf(reported, problems) {
	const named = problems.filter((text) => /permutation word/.test(text));
	return [
		...reported.map((word) => ({ pipeline: 'an object pipeline', word })),
		...named.map((text) => ({ pipeline: text.split('.')[0] ?? text, word: -1 })),
	];
}

/**
 * Builds and serves the project when `base` is undefined, drives every page on every path, and
 * prints each missing word. Returns the exit code.
 *
 * @param {ReturnType<typeof parseVerifyArgs>} options
 * @returns {Promise<number>}
 */
export async function runVerify(options) {
	const server = options.base === undefined ? await startBuildServer() : undefined;
	try {
		const base = options.base ?? /** @type {{ url: string }} */ (server).url;
		const steps = options.steps === undefined ? undefined : await loadSteps(options.steps);
		const browser = await launchBrowser(defaultEnvironment());
		/** @type {{ page: string, tier: string, missing: { pipeline: string, word: number }[] }[]} */
		const failures = [];
		try {
			for (const path of options.live) {
				for (const tier of options.tiers) {
					const page = await browser.newPage({ ignoreHTTPSErrors: true });
					try {
						console.log(`Checking ${path} on ${tier} at ${base}`);
						await page.goto(verifyUrl(base, path, tier), {
							waitUntil: 'load',
							timeout: options.timeoutMs,
						});
						const missing = await missingOnPage(page, {
							...options,
							path,
							steps,
							log: console.log,
						});
						if (missing.length > 0) {
							failures.push({ page: path, tier, missing });
							for (const { pipeline, word } of missing)
								console.log(
									`MISSING ${path} on ${tier}: ${
										word < 0
											? pipeline
											: `the permutation word 0x${(word >>> 0).toString(16).padStart(8, '0')}`
									}`,
								);
						} else console.log(`OK      ${path} on ${tier}`);
					} catch (error) {
						const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
						console.log(`SKIPPED ${path} on ${tier}: ${message}`);
					} finally {
						await page.close();
					}
				}
			}
		} finally {
			await browser.close();
		}
		if (failures.length === 0) {
			console.log('Every page drew with the words of the shader list.');
			return 0;
		}
		console.log(
			`${failures.length} page and path checks lacked a word. Record the pages again with bunx @null3d/cli shaders record, or add the word with --extra, then build again.`,
		);
		return 1;
	} finally {
		await server?.close();
	}
}
