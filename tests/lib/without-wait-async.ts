// Acts out a browser without Atomics.waitAsync, such as Firefox before 145, in Playwright's Chrome.
import type { APIResponse, Page, Route } from '@playwright/test';

/** Fetches a routed request's response, again when the dev server drops the connection. */
async function fetchOnce(route: Route, tries = 3): Promise<APIResponse> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await route.fetch();
		} catch (error) {
			if (attempt >= tries) throw error;
		}
	}
}

/**
 * The engine's scripts: its source files that the dev server serves, and a production build's
 * files. Every thread of the engine loads some of them before it waits.
 */
const ENGINE_SCRIPT = /\/(packages\/engine\/src|assets)\/[^?]*\.(js|ts)(\?|$)/;

/**
 * Serves each of the engine's scripts with a first line that removes Atomics.waitAsync, so the page
 * and each of its workers run as in a browser that lacks it. Call `restoreWaitAsync` once the
 * page's result is in.
 */
export async function withoutWaitAsync(page: Page): Promise<void> {
	await page.context().route(ENGINE_SCRIPT, async (route) => {
		const response = await fetchOnce(route);
		const type = response.headers()['content-type'] ?? '';
		if (!type.includes('javascript')) return route.fulfill({ response });
		await route.fulfill({ response, body: `delete Atomics.waitAsync;\n${await response.text()}` });
	});
}

/** Serves the scripts as they are again. The page may still load files, which the test ignores. */
export function restoreWaitAsync(page: Page): Promise<void> {
	return page.context().unrouteAll({ behavior: 'ignoreErrors' });
}
