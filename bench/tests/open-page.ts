// Opens a benchmark or test page and waits for the result that it publishes, with every error that
// it logs, for the Playwright tests of the benchmark pages.
import { expect, type Page } from '@playwright/test';
import { watchConsole } from '../../packages/cli/src/page.js';
import { pageResult } from '../../tests/lib/page-result.ts';

/** What every page publishes: whether it succeeded, and its error when it did not. */
export interface PageReport {
	ok: boolean;
	error?: string;
}

/**
 * How long a page may take to publish its result. A software GPU on a loaded CI runner needs longer:
 * the page builds its pipelines and finishes its first frame before it can run its benchmark.
 */
export const RESULT_TIMEOUT_MS = process.env.CI ? 180_000 : 90_000;

/**
 * Opens a page and returns the result that it publishes, with every error that it logs. A page that
 * loads large files first gives itself a longer `timeoutMs`.
 */
export async function openPage<T extends PageReport>(
	page: Page,
	path: string,
	timeoutMs = RESULT_TIMEOUT_MS,
): Promise<{ result: T; errors: string[] }> {
	const { errors } = watchConsole(page);
	await page.goto(path);
	return { result: await pageResult<T>(page, timeoutMs), errors };
}

/** Opens a page and returns its result. It fails on a page error and on any console error. */
export async function runPage<T extends PageReport>(
	page: Page,
	path: string,
	timeoutMs = RESULT_TIMEOUT_MS,
): Promise<T> {
	const { result, errors } = await openPage<T>(page, path, timeoutMs);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(errors).toEqual([]);
	return result;
}
