import { defineConfig } from '@playwright/test';
import browserTests from '../tests/playwright.config.ts';

// The browser tests' setup (the Chrome channel on a Mac, SwiftShader flags on CI), pointed at the
// benchmark pages' server. Playwright's own output goes under target/, where the lint and format
// check does not look; the hold frames go to test-results/bench/.
export default defineConfig({
	...browserTests,
	testDir: 'tests',
	outputDir: '../target/playwright-bench',
	timeout: 120_000,
	use: { ...browserTests.use, baseURL: 'http://localhost:5174' },
	webServer: {
		command: 'bunx vite --config vite.config.ts',
		cwd: import.meta.dirname,
		url: 'http://localhost:5174/index.html',
		reuseExistingServer: !process.env.CI,
	},
});
