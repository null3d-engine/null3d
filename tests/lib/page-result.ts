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
		const trail = await page.evaluate(
			() => (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? [],
		);
		return { ok: false, error: `no result within ${timeoutMs / 1000} s`, trail };
	}
}
