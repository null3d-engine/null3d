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

/** How long a page may take to publish its result. */
const RESULT_TIMEOUT_MS = 90_000;

/** Opens a page and returns the result that it publishes, with every error that it logs. */
export async function openPage<T extends PageReport>(
	page: Page,
	path: string,
): Promise<{ result: T; errors: string[] }> {
	const { errors } = watchConsole(page);
	await page.goto(path);
	return { result: await pageResult<T>(page, RESULT_TIMEOUT_MS), errors };
}

/** Opens a page and returns its result. It fails on a page error and on any console error. */
export async function runPage<T extends PageReport>(page: Page, path: string): Promise<T> {
	const { result, errors } = await openPage<T>(page, path);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(errors).toEqual([]);
	return result;
}
