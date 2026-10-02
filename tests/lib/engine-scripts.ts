// Runs code in every thread of the engine in Playwright's browser, before the engine's own code: the
// test serves each of the engine's scripts with the code as its first lines.
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
 * Serves each of the engine's scripts with `code` as its first lines, so the page and each of its
 * workers run it before the engine's code. A module runs the modules it imports first, so `code`
 * must do its work once per thread, whichever script runs it first. Call `restoreEngineScripts`
 * once the page's result is in.
 */
export async function prefixEngineScripts(page: Page, code: string): Promise<void> {
	await page.context().route(ENGINE_SCRIPT, async (route) => {
		const response = await fetchOnce(route);
		const type = response.headers()['content-type'] ?? '';
		if (!type.includes('javascript')) return route.fulfill({ response });
		await route.fulfill({ response, body: `${code}\n${await response.text()}` });
	});
}

/** Serves the scripts as they are again. The page may still load files, which the test ignores. */
export function restoreEngineScripts(page: Page): Promise<void> {
	return page.context().unrouteAll({ behavior: 'ignoreErrors' });
}
