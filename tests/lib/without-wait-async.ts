// Acts out a browser without Atomics.waitAsync, such as Firefox before 145, in Playwright's Chrome.
import type { Page } from '@playwright/test';
import { prefixEngineScripts, restoreEngineScripts } from './engine-scripts.ts';

/**
 * Removes Atomics.waitAsync from the page and each of its workers before the engine runs, so they
 * run as in a browser that lacks it. Call `restoreWaitAsync` once the page's result is in.
 */
export function withoutWaitAsync(page: Page): Promise<void> {
	return prefixEngineScripts(page, 'delete Atomics.waitAsync;');
}

/** Serves the scripts as they are again. The page may still load files, which the test ignores. */
export const restoreWaitAsync = restoreEngineScripts;
