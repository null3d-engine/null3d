// Reads the result that a test or benchmark page publishes on its window when it finishes.
import type { Page } from '@playwright/test';

/** Waits until the page publishes its result, and returns it. Throws when the time runs out. */
export async function pageResult<T>(page: Page, timeoutMs: number): Promise<T> {
	const handle = await page.waitForFunction(
		() => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult,
		undefined,
		{ timeout: timeoutMs },
	);
	return (await handle.jsonValue()) as T;
}
