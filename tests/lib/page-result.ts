// Reads the result that a test or benchmark page publishes on its window when it finishes. The
// command-line tool's page module reads other values that a page publishes, and the result of the
// engine's hold mode.
import { type ConsoleMessage, errors, type Page } from '@playwright/test';
import { windowValue } from '../../packages/cli/src/page.js';
import { neighbourNote } from './running-tests.ts';
import { type ItemResult, lastSteps } from './runs.ts';
import { stallMessage } from './stall-message.ts';
import { calibrationNote, noteCalibration } from './start-calibrations.ts';

/** The page's name for the run's readings: its sketch and tier where the address names them. */
function pageName(page: Page): string {
	try {
		const url = new URL(page.url());
		const sketch = url.searchParams.get('sketch') ?? url.pathname;
		const gpu = url.searchParams.get('gpu');
		return gpu === null ? sketch : `${sketch} on ${gpu}`;
	} catch {
		return page.url();
	}
}

/** Records a page's start reading for the run. */
function recordCalibration(page: Page, calibrationMs: unknown): void {
	noteCalibration(pageName(page), calibrationMs);
}

/**
 * Watches the start reading that the page sets as its start begins, from the first moment the page
 * answers. A page that later stalls in a long synchronous phase cannot answer a question, but the
 * reading it set before the stall still counts.
 */
function readingFromStart(page: Page): () => number | undefined {
	let ms: number | undefined;
	page
		.evaluate(() => (globalThis as { __null3dStartCalibration?: number }).__null3dStartCalibration)
		.then((value) => {
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) ms = value;
		})
		.catch(() => {});
	return () => ms;
}

/**
 * Waits until the page publishes its result, and returns it. Throws when the time runs out, with
 * the page's last steps and the tests that other workers ran beside it added to the message: a page
 * that published nothing still says where its time went, and a bare timeout says nothing. Each page
 * also gives the run its start reading, which says whether this page stood out.
 */
export async function pageResult<T>(page: Page, timeoutMs: number): Promise<T> {
	// Start the reading now, so a page that stalls later has already answered.
	const startReading = readingFromStart(page);
	try {
		const result = await windowValue<T>(page, '__null3dResult', timeoutMs);
		const published = (result as { calibrationMs?: unknown } | null)?.calibrationMs;
		recordCalibration(page, published ?? startReading());
		return result;
	} catch (e) {
		if (e instanceof errors.TimeoutError) {
			// The page may have answered before its stall, so take the reading kept from its start.
			// A page that never answered still names the missing reading: zero, not undefined.
			const calibrationMs = startReading() ?? 0;
			recordCalibration(page, calibrationMs);
			// A page that closed keeps its own timeout: reading it would throw in its place.
			try {
				e.message +=
					lastSteps(await pageTrail(page)) + calibrationNote(calibrationMs) + neighbourNote();
			} catch {}
			// The caller's failure text names the reading's place among the run's pages.
			(e as { calibrationMs?: number }).calibrationMs = calibrationMs;
		}
		throw e;
	}
}

/**
 * Collects what goes wrong in a page from now on: a crash, uncaught errors, errors that the page or
 * its workers write to the console, and files that fail to load. A page that publishes no result in
 * time gives no cause of its own, so these explain it.
 */
export function watchPageProblems(page: Page): string[] {
	const problems: string[] = [];
	const onConsole = (message: ConsoleMessage) => {
		if (message.type() === 'error') problems.push(`console: ${message.text()}`);
	};
	page.on('crash', () => problems.push('the page crashed'));
	page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
	page.on('console', onConsole);
	page.on('worker', (worker) => worker.on('console', onConsole));
	page.on('requestfailed', (request) =>
		problems.push(
			`failed to load ${request.url()}: ${request.failure()?.errorText ?? 'no answer'}`,
		),
	);
	page.on('response', (response) => {
		if (response.status() >= 400) problems.push(`HTTP ${response.status()} for ${response.url()}`);
	});
	return problems;
}

/** The steps that the page has noted in its trail so far. */
const pageTrail = (page: Page): Promise<string[]> =>
	page.evaluate(() => (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? []);

/**
 * Waits until the page publishes its result, for as long as the page keeps noting steps in its
 * trail. Each wait lasts `stallMs`, and a wait in which the page noted no new step throws, with the
 * trail's last steps, the page's start reading and the tests that ran beside it. A page whose work
 * takes longer on a busy machine gets the time it needs, and a stuck page still fails after one wait.
 */
export async function pageResultWhileProgressing<T>(page: Page, stallMs: number): Promise<T> {
	let steps = -1;
	for (;;) {
		try {
			return await pageResult<T>(page, stallMs);
		} catch (e) {
			if (!(e instanceof errors.TimeoutError)) throw e;
			const trail = await pageTrail(page);
			if (trail.length <= steps)
				throw new Error(
					stallMessage(trail, stallMs, (e as { calibrationMs?: number }).calibrationMs),
				);
			steps = trail.length;
		}
	}
}

/**
 * Opens a page and returns the result it publishes, as the runner page records it: a page that
 * publishes nothing in time gives a failure with the steps it got through, and never throws.
 */
export async function loadResult(page: Page, path: string, timeoutMs: number): Promise<ItemResult> {
	await page.goto(path);
	try {
		return await pageResult<ItemResult>(page, timeoutMs);
	} catch (e) {
		if (!(e instanceof errors.TimeoutError)) throw e;
		return {
			ok: false,
			error: `no result within ${timeoutMs / 1000} s`,
			trail: await pageTrail(page),
			// Zero, not undefined: the page ran the instrument, and the reading is missing.
			calibrationMs: (e as { calibrationMs?: number }).calibrationMs ?? 0,
		};
	}
}
