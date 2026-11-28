// Records the permutation words that a project's pages draw with, for the list that narrows a
// production build's shader files. Each page runs with `?permutations=record`: the engine collects
// the words that its pipelines ask for, and publishes them once a held frame has drawn, or once
// the recorder stops a live page that it has driven through its states. `null3d shaders record`
// and the repository's own recorder both run this module.
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { switchedPath } from './page.js';
import { recordedWords } from './shader-words.js';

/** @import { Browser, Page } from 'playwright-core' */

/**
 * The quality presets to record, so a device that picks one for its own class finds every word it
 * draws. Low draws with FXAA and no fading bands, and the other presets draw with MSAA and the
 * fading bands, so these two cover the shader bits that a preset sets.
 */
export const RECORD_PRESETS = /** @type {const} */ (['low', 'high']);

/**
 * The GPU paths to record. Each path's builds list bits that the other's do not, such as the morph
 * targets of WebGL2 and the instance index of WebGPU, and one list serves every device.
 */
export const RECORD_GPUS = /** @type {const} */ (['webgpu', 'webgl2']);

/** How long to wait after a HUD pick before the next one, in ms, so its frames ask for the word. */
const PICK_MS = 600;

/**
 * The least time that a live page draws before its recording ends, in ms, so its scene and camera
 * move. A page that adds a word keeps drawing, and a page that adds none still gets this long.
 */
export const LIVE_MS = 15_000;

/** How long a live page's word set must stay unchanged before the recorder stops it, in ms. */
const SETTLE_MS = 5_000;

/** The longest time that a live page draws before its recording ends, in ms. */
const MAX_MS = 60_000;

/** How long a page may take to load, and to start or publish its words, in ms. */
const LOAD_MS = 120_000;

/**
 * A scroll step waits until the page has asked for nothing for this long, in ms. A scene stage that
 * a scroll reveals downloads its models and its shader files, and its pipelines ask for their words
 * once those arrive.
 */
const SCROLL_QUIET_MS = 500;
/** The shortest and longest wait of a scroll step, in ms. */
const SCROLL_MIN_MS = 1000;
const SCROLL_MAX_MS = 15_000;
/** The most steps of one scroll, for a page that grows as it scrolls. */
const SCROLL_STEPS = 200;

/**
 * @typedef {object} RecordTarget
 * @property {string} path The page's path from the base address, with its switches, such as
 *   `/?gpu=webgl2&preset=low&hold=`.
 * @property {boolean} live True for a live page, which the recorder drives through its states and
 *   then stops.
 * @property {boolean} [scroll] True for a live page that the recorder scrolls to its end.
 */

/**
 * The pages to record: each held page in hold mode at each preset on each GPU path, and each live
 * page on each GPU path. A held page whose path names its own hold time keeps it.
 *
 * @param {{ held?: readonly string[], live?: readonly string[], scroll?: boolean }} pages
 * @returns {RecordTarget[]}
 */
export function recordTargets({ held = [], live = [], scroll = false }) {
	/** @type {RecordTarget[]} */
	const targets = [];
	for (const path of held) {
		const hold = new URL(path, 'http://localhost').searchParams.has('hold') ? undefined : '';
		for (const gpu of RECORD_GPUS)
			for (const preset of RECORD_PRESETS)
				targets.push({ path: switchedPath(path, { hold, gpu, preset }), live: false });
	}
	for (const path of live)
		for (const gpu of RECORD_GPUS)
			targets.push({ path: switchedPath(path, { gpu }), live: true, scroll });
	return targets;
}

/**
 * The address that records `path`: the base address and the page's path, with the switch that
 * starts a recording.
 *
 * @param {string} base
 * @param {string} path
 */
export function recordingUrl(base, path) {
	const url = new URL(`${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`);
	url.searchParams.set('permutations', 'record');
	return url.href;
}

/**
 * The words that `--extra` lists: hexadecimal numbers joined by commas, with or without `0x`.
 * Throws for a word that is not one.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function readExtraWords(text) {
	return text
		.split(',')
		.map((word) => word.trim())
		.filter((word) => word !== '')
		.map((word) => {
			const digits = word.replace(/^0x/i, '');
			if (!/^[0-9a-f]{1,8}$/i.test(digits))
				throw new Error(
					`"${word}" is not a permutation word: write a hexadecimal number such as 0x10`,
				);
			return Number.parseInt(digits, 16);
		});
}

/**
 * Presses every button of each group of the page's controls HUD, which turns on every effect and
 * quality the page offers, so the words those states ask for reach the recording. A page without a
 * HUD is left as it is.
 *
 * @param {Page} page
 * @returns {Promise<number>} The buttons pressed.
 */
export async function sweepHud(page) {
	// The examples page gives every demo a place for a HUD, but only a scene that posts a controls
	// model shows the chevron that opens it.
	const chevron = page.locator('button.hud__chevron:visible');
	if ((await chevron.count()) === 0) return 0;
	await chevron.first().click({ timeout: 5_000 });
	await page.waitForTimeout(PICK_MS);
	let picks = 0;
	const tabs = page.locator('button.hud__tab');
	const count = await tabs.count();
	for (let k = 0; k < count; k++) {
		await tabs.nth(k).click({ timeout: 5_000 });
		await page.waitForTimeout(PICK_MS);
		// A group's buttons are the visible ones, since only the selected tab's panel shows.
		const buttons = page.locator('.hud__group:not([hidden]) button.hud__btn');
		const shown = await buttons.count();
		for (let b = 0; b < shown; b++) {
			await buttons
				.nth(b)
				.click({ timeout: 5_000 })
				.catch(() => undefined);
			await page.waitForTimeout(PICK_MS);
			picks++;
		}
	}
	return picks;
}

/**
 * Follows the page's requests, and gives a wait that ends once the page has asked for nothing for
 * a while: at least the shortest wait and at most the longest.
 *
 * @param {Page} page
 */
export function requestWatch(page) {
	let open = 0;
	let last = Date.now();
	const touch = () => {
		last = Date.now();
	};
	page.on('request', () => {
		open++;
		touch();
	});
	const done = () => {
		open = Math.max(0, open - 1);
		touch();
	};
	page.on('requestfinished', done);
	page.on('requestfailed', done);
	return {
		/** Waits until the page is quiet, or until the longest wait has passed. */
		async quiet() {
			const start = Date.now();
			for (;;) {
				await sleep(100);
				const now = Date.now();
				if (now - start >= SCROLL_MAX_MS) return;
				if (now - start >= SCROLL_MIN_MS && open === 0 && now - last >= SCROLL_QUIET_MS) return;
			}
		},
	};
}

/**
 * The parts of the page's window that the scroll reads, typed, as the tool's settings lack the
 * browser's types.
 *
 * @typedef {{ scrollY: number, document: { querySelectorAll(selector: string): Iterable<{ scrollTop: number }> } }} ScrollView
 */

/**
 * Scrolls the page down to its end in steps of the window's height, as a visitor's wheel does, so
 * that a page which builds its later scenes as it scrolls asks for their words. After each step it
 * waits until the page has asked for nothing for a while. It stops when a step moves nothing.
 *
 * @param {Page} page
 * @param {{ quiet(): Promise<void> }} watch
 * @returns {Promise<number>} The steps that moved the page.
 */
export async function scrollToEnd(page, watch, dwell = 0) {
	const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
	await page.mouse.move(width / 2, height / 2);
	// The distance scrolled: the window's and every scrolling element's, so a page that scrolls an
	// element of its own scrolls too.
	const scrolled = () =>
		page.evaluate(() => {
			const view = /** @type {ScrollView} */ (/** @type {unknown} */ (globalThis));
			let total = view.scrollY;
			for (const element of view.document.querySelectorAll('*')) total += element.scrollTop;
			return total;
		});
	let steps = 0;
	while (steps < SCROLL_STEPS) {
		const before = await scrolled();
		await page.mouse.wheel(0, height);
		await watch.quiet();
		// A state that a scroll reveals can arrive with time, so a stop can rest before the next step.
		if (dwell > 0) await sleep(dwell);
		if ((await scrolled()) <= before) break;
		steps++;
	}
	return steps;
}

/**
 * Waits until a live page's word set has stopped growing. It waits at least `minMs`, then until
 * `settleMs` has passed with no new word, and gives up at `maxMs`. A fixed wait is a sample; a set
 * that stopped growing is evidence that the page has shown every state that adds a word.
 *
 * @param {Page} page
 * @param {{ minMs?: number, settleMs?: number, maxMs?: number }} [options]
 * @returns {Promise<number>} The words that the page reached.
 */
export async function waitForStableWords(
	page,
	{ minMs = LIVE_MS, settleMs = SETTLE_MS, maxMs = MAX_MS } = {},
) {
	const start = Date.now();
	let count = -1;
	let changed = start;
	for (;;) {
		const found = await page.evaluate(() => {
			const recorded = /** @type {{ __null3dPermutations?: number[] }} */ (globalThis);
			return recorded.__null3dPermutations?.length ?? 0;
		});
		const now = Date.now();
		if (found !== count) {
			count = found;
			changed = now;
		}
		const elapsed = now - start;
		if (elapsed >= maxMs || (elapsed >= minMs && now - changed >= settleMs)) return count;
		await sleep(250);
	}
}

/**
 * Loads the module that `--steps` names: its default export, or its `steps` export. The function
 * takes `{ page, log, path }`, where `page` is the Playwright page, and drives the project through
 * the states that add shader words.
 *
 * @param {string} file
 * @returns {Promise<(context: { page: Page, log: (line: string) => void, path: string }) => Promise<void> | void>}
 */
export async function loadSteps(file) {
	const module = await import(pathToFileURL(resolve(file)).href);
	const steps = module.default ?? module.steps;
	if (typeof steps !== 'function')
		throw new Error(
			`${file} exports no function to drive the page. Export one as default, or as steps.`,
		);
	return steps;
}

/**
 * Records the words of one page: it loads the page with the recording switch, presses `click` when
 * the page names one, drives a live page through its states and stops it, and reads the words that
 * the page publishes. A page that fails names its errors.
 *
 * @param {Browser} browser
 * @param {string} base
 * @param {RecordTarget} target
 * @param {{
 *   click?: string,
 *   log: (line: string) => void,
 *   liveMs?: number,
 *   settleMs?: number,
 *   maxMs?: number,
 *   scrollDwell?: number,
 *   steps?: (context: { page: Page, log: (line: string) => void, path: string }) => Promise<void> | void,
 * }} options
 * @returns {Promise<number[]>}
 */
async function recordPage(
	browser,
	base,
	target,
	{ click, log, liveMs = LIVE_MS, settleMs = SETTLE_MS, maxMs = MAX_MS, scrollDwell = 0, steps },
) {
	// A server of the project may serve a local certificate, which this browser does not trust.
	const tab = await browser.newPage({ ignoreHTTPSErrors: true });
	/** @type {string[]} */
	const errors = [];
	tab.on('pageerror', (error) => errors.push(error.message));
	tab.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	const watch = requestWatch(tab);
	try {
		await tab.goto(recordingUrl(base, target.path), { waitUntil: 'load', timeout: LOAD_MS });
		// A page whose engine starts on a click draws nothing until it is asked to start, so the
		// recording would wait for a stop that never comes.
		if (click !== undefined) await tab.locator(click).first().click({ timeout: 30_000 });
		if (target.live) {
			// The engine puts the stop on the page once it starts, so the words are read after the
			// page has offered its controls.
			await tab.waitForFunction(
				() =>
					/** @type {{ __null3dStopRecording?: unknown }} */ (globalThis).__null3dStopRecording !==
					undefined,
				undefined,
				{ timeout: LOAD_MS, polling: 250 },
			);
			// The first frames draw and the camera moves before the sweep. A project that gives its
			// own steps drives its states instead, so an action-gated state needs no --extra word.
			if (steps !== undefined) {
				await steps({ page: tab, log, path: target.path });
				await waitForStableWords(tab, { minMs: 0, settleMs, maxMs });
			} else {
				await waitForStableWords(tab, { minMs: liveMs, settleMs, maxMs });
				const picks = await sweepHud(tab);
				if (picks > 0) log(`${target.path}: pressed ${picks} controls`);
				if (target.scroll)
					log(`${target.path}: scrolled ${await scrollToEnd(tab, watch, scrollDwell)} steps`);
				await waitForStableWords(tab, { minMs: 0, settleMs, maxMs });
			}
		}
		const found = await recordedWords(tab);
		log(`${target.path}: ${found.length} words`);
		return found;
	} catch (error) {
		const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
		const logged = errors.length > 0 ? ` The page logged: ${errors.slice(0, 3).join(' | ')}` : '';
		throw new Error(`${reason}.${logged}`);
	} finally {
		await tab.close();
	}
}

/**
 * Records the words of every target in `browser`, several pages at once: each page spends most of
 * its time loading and building its scene. A page that fails gets a second try, since a page that
 * times out beside others is often slow rather than broken; a second failure ends the run, so no
 * list leaves out a page's words. Gives every word that a page asked for, with `extra`, in order.
 *
 * @param {{
 *   browser: Browser,
 *   base: string,
 *   targets: readonly RecordTarget[],
 *   workers?: number,
 *   click?: string,
 *   extra?: readonly number[],
 *   liveMs?: number,
 *   settleMs?: number,
 *   maxMs?: number,
 *   scrollDwell?: number,
 *   steps?: (context: { page: Page, log: (line: string) => void, path: string }) => Promise<void> | void,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<number[]>}
 */
export async function recordWords({
	browser,
	base,
	targets,
	workers = 4,
	click,
	extra = [],
	liveMs = LIVE_MS,
	settleMs,
	maxMs,
	scrollDwell,
	steps,
	log = console.log,
}) {
	const words = new Set(extra.map((word) => word >>> 0));
	let next = 0;
	/** @type {Error | undefined} */
	let failure;
	const worker = async () => {
		while (failure === undefined) {
			const target = targets[next++];
			if (target === undefined) return;
			const record = () =>
				recordPage(browser, base, target, {
					click,
					log,
					liveMs,
					settleMs,
					maxMs,
					scrollDwell,
					steps,
				});
			try {
				for (const word of await record().catch(record)) words.add(word >>> 0);
			} catch (error) {
				failure = new Error(
					`${target.path}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
	if (failure !== undefined) throw failure;
	return [...words].sort((a, b) => a - b);
}
