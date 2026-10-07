// Reads the result that a test or benchmark page publishes on its window when it finishes. The
// command-line tool's page module reads other values that a page publishes, and the result of the
// engine's hold mode.
import { errors, type Page } from '@playwright/test';
import { windowValue } from '../../packages/cli/src/page.js';
import type { ItemResult } from './runs.ts';

/** Waits until the page publishes its result, and returns it. Throws when the time runs out. */
export function pageResult<T>(page: Page, timeoutMs: number): Promise<T> {
	return windowValue<T>(page, '__null3dResult', timeoutMs);
}

/** The steps that the page has noted in its trail so far. */
const pageTrail = (page: Page): Promise<string[]> =>
	page.evaluate(() => (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? []);

/**
 * Waits until the page publishes its result, for as long as the page keeps noting steps in its
 * trail. Each wait lasts `stallMs`, and a wait in which the page noted no new step throws, with the
 * trail's last steps. A page whose work takes longer on a busy machine gets the time it needs, and
 * a stuck page still fails after one wait.
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
					`no result and no new step within ${stallMs / 1000} s. The last steps:\n${trail.slice(-5).join('\n')}`,
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
		};
	}
}
