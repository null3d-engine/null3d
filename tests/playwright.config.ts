import { defineConfig } from '@playwright/test';
import { browserOptions, defaultEnvironment } from '../packages/cli/src/browser.js';
import { HTTP_PORT, PREVIEW_PORT, REPO_ROOT } from './lib/server.ts';

const ci = Boolean(process.env.CI);
/**
 * The main project's environment, which names the references that its image tests compare with:
 * SwiftShader in CI, and the real GPU through the installed Google Chrome elsewhere.
 */
const environment = defaultEnvironment();
const launchOptions = browserOptions(environment);
/** Device pixels per CSS pixel on the screen of the resize tests, as on most phones and laptops. */
const HIGH_DENSITY_RATIO = 2;

export default defineConfig({
	testDir: 'image',
	outputDir: '../test-results/playwright',
	timeout: 60_000,
	forbidOnly: ci,
	reporter: ci ? [['list'], ['github']] : 'list',
	use: {
		baseURL: `http://localhost:${HTTP_PORT}/tests/pages/`,
		headless: true,
		launchOptions,
	},
	webServer: [
		{
			command: 'bunx vite',
			cwd: REPO_ROOT,
			url: `http://localhost:${HTTP_PORT}/tests/pages/index.html`,
			reuseExistingServer: !ci,
		},
		{
			// A fresh production build every run, so the tests never serve stale files. The errors
			// page builds on its own, so the engine test page stays as the startup benchmark loads it.
			command: `bunx vite build && NULL3D_BUILD_PAGE=errors bunx vite build && bunx vite preview --port ${PREVIEW_PORT} --strictPort`,
			cwd: REPO_ROOT,
			url: `http://localhost:${PREVIEW_PORT}/tests/pages/engine.html`,
			reuseExistingServer: false,
		},
	],
	projects: [
		{ name: environment, testIgnore: 'resize.spec.ts' },
		// The engine and errors tests again, on the production build. The sketch module and the engine
		// core must survive bundling on both GPU paths and in every thread mode. So must the engine's
		// errors in a sketch, whose bundle holds its own copy of the engine's error code.
		{
			name: 'production build',
			testMatch: ['engine.spec.ts', 'errors.spec.ts'],
			use: { baseURL: `http://localhost:${PREVIEW_PORT}/tests/pages/` },
		},
		// The resize tests, on a high-density screen. Playwright's emulated pixel ratio does not reach
		// the size in device pixels that the browser reports for an element (Playwright issue 18591),
		// so the browser itself also starts at that ratio.
		{
			name: 'high-density screen',
			testMatch: 'resize.spec.ts',
			use: {
				deviceScaleFactor: HIGH_DENSITY_RATIO,
				launchOptions: {
					...launchOptions,
					args: [
						...(launchOptions.args ?? []),
						`--force-device-scale-factor=${HIGH_DENSITY_RATIO}`,
					],
				},
			},
		},
	],
});
