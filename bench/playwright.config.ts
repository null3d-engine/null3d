import { defineConfig } from '@playwright/test';
import { HTTP_PORT } from '../tests/lib/server.ts';
import browserTests from '../tests/playwright.config.ts';

// The browser tests' setup and dev server (the Chrome channel on a Mac, SwiftShader flags on CI),
// pointed at the benchmark pages. Playwright's own output goes under target/, where the lint and
// format check does not look; the hold frames go to test-results/bench/.
export default defineConfig({
	...browserTests,
	testDir: 'tests',
	outputDir: '../target/playwright-bench',
	timeout: 120_000,
	use: { ...browserTests.use, baseURL: `http://localhost:${HTTP_PORT}/bench/pages/` },
});
