import { defineConfig } from '@playwright/test';
import { PREVIEW_PORT, REPO_ROOT } from '../tests/lib/server.ts';
import browserTests from '../tests/playwright.config.ts';

/** Where the build goes, from the repository's root, as the benchmark tools build it. */
const BUILD = 'target/bench-pages';

// The browser tests' setup (the Chrome channel on a Mac, SwiftShader flags on CI), pointed at the
// production build of the benchmark pages, which every benchmark run measures. The build is fresh
// on every run, so the tests never serve stale files. Playwright's own output goes under target/,
// where the lint and format check does not look; the hold frames go to test-results/bench/.
export default defineConfig({
	...browserTests,
	testDir: 'tests',
	outputDir: '../target/playwright-bench',
	timeout: 120_000,
	use: { ...browserTests.use, baseURL: `http://localhost:${PREVIEW_PORT}/bench/pages/` },
	webServer: {
		command: `bunx vite build --config bench/vite.pages.config.ts --outDir ${BUILD} && bunx vite preview --outDir ${BUILD} --port ${PREVIEW_PORT} --strictPort`,
		cwd: REPO_ROOT,
		url: `http://localhost:${PREVIEW_PORT}/bench/pages/index.html`,
		reuseExistingServer: false,
	},
});
