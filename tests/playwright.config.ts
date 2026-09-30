import { defineConfig } from '@playwright/test';
import type { Environment } from './lib/images.ts';
import { HTTP_PORT, PREVIEW_PORT, REPO_ROOT, SWIFTSHADER_ARGS } from './lib/server.ts';

const ci = Boolean(process.env.CI);
/** The main project's environment, which names the references that its image tests compare with. */
const environment: Environment = ci ? 'chromium-swiftshader' : 'chrome-real-gpu';

/** Device pixels per CSS pixel on the screen of the resize tests, as on most phones and laptops. */
const HIGH_DENSITY_RATIO = 2;

// On a Mac, the installed Google Chrome runs on the real GPU. Playwright's default headless shell
// would fall back to SwiftShader there, so real-GPU runs use the Chrome channel.
export default defineConfig({
	testDir: 'image',
	outputDir: '../test-results/playwright',
	timeout: 60_000,
	forbidOnly: ci,
	reporter: ci ? [['list'], ['github']] : 'list',
	use: {
		baseURL: `http://localhost:${HTTP_PORT}/tests/pages/`,
		headless: true,
		...(ci ? { launchOptions: { args: SWIFTSHADER_ARGS } } : { channel: 'chrome' }),
	},
	webServer: [
		{
			command: 'bunx vite',
			cwd: REPO_ROOT,
			url: `http://localhost:${HTTP_PORT}/tests/pages/index.html`,
			reuseExistingServer: !ci,
		},
		{
			// A fresh production build every run, so the tests never serve stale files. The errors and
			// sketch shaders pages build on their own, so the engine test page stays as the startup
			// benchmark loads it.
			command: `bunx vite build && NULL3D_BUILD_PAGE=errors bunx vite build && NULL3D_BUILD_PAGE=sketch-shaders bunx vite build && bunx vite preview --port ${PREVIEW_PORT} --strictPort`,
			cwd: REPO_ROOT,
			url: `http://localhost:${PREVIEW_PORT}/tests/pages/engine.html`,
			reuseExistingServer: false,
		},
	],
	projects: [
		{ name: environment, testIgnore: 'resize.spec.ts' },
		// The engine and errors tests again, on the production build. The sketch module and the engine
		// core must survive bundling on both GPU paths and in every thread mode. So must the engine's
		// errors in a sketch, whose bundle holds its own copy of the engine's error code, and the WGSL
		// that the plugin compiles into a sketch's bundle.
		{
			name: 'production build',
			testMatch: ['engine.spec.ts', 'errors.spec.ts', 'sketch-shaders.spec.ts'],
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
					args: [
						...(ci ? SWIFTSHADER_ARGS : []),
						`--force-device-scale-factor=${HIGH_DENSITY_RATIO}`,
					],
				},
			},
		},
	],
});
