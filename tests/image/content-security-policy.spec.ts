import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, type EngineResult, engineProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

// The engine starts under the strict Content-Security-Policy that a WebAssembly app usually sends:
// every file from the page's own origin, WebAssembly allowed, and no other code. The production
// build runs these tests, because a bundler decides which addresses the engine fetches: an
// address that Vite inlines as data: is blocked by such a policy, which the dev server never shows.

/** The strict policy. The test page's own style element needs inline styles; the engine needs none. */
const STRICT =
	"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'";

/**
 * Serves every response to the page with `policy`, as a host that sets the header on every file
 * does: a worker takes the policy of its own script's response, not the page's.
 */
async function withPolicy(page: Page, policy: string): Promise<string[]> {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text());
	});
	await page.route('**/*', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), 'content-security-policy': policy },
		});
	});
	return violations;
}

// The engine's files may still be on their way when a test ends, and their routes then fail.
test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

for (const mode of ENGINE_MODES)
	test(`the engine starts under a strict Content-Security-Policy, ${mode.name}`, async ({
		page,
	}) => {
		const violations = await withPolicy(page, STRICT);
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<EngineResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(engineProblems(result, mode, 'webgl2')).toEqual([]);
		expect(violations).toEqual([]);
	});

for (const mode of ENGINE_MODES.filter(({ name }) =>
	['pipelined', 'single-threaded'].includes(name),
))
	test(`a policy without 'wasm-unsafe-eval' stops the start with E1418, ${mode.name}`, async ({
		page,
	}) => {
		await withPolicy(page, STRICT.replace(" 'wasm-unsafe-eval'", ''));
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<{ error?: string }>(page, 30_000);
		expect(result.error ?? '').toMatch(
			new RegExp(
				`^E1418: the page's Content-Security-Policy does not let the ${mode.build} engine core compile: `,
			),
		);
	});
