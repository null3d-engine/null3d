import { defineConfig } from '@playwright/test';
import { HTTP_PORT, PREVIEW_PORT, REPO_ROOT } from './lib/server.ts';

const ci = Boolean(process.env.CI);

/** Chromium flags for WebGPU and WebGL2 on SwiftShader, the software GPU, on Linux CI. */
const SWIFTSHADER_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--ignore-gpu-blocklist',
	'--no-sandbox',
	'--hide-scrollbars',
];
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
			// A fresh production build every run, so the test never serves stale files.
			command: `bunx vite build && bunx vite preview --port ${PREVIEW_PORT} --strictPort`,
			cwd: REPO_ROOT,
			url: `http://localhost:${PREVIEW_PORT}/tests/pages/engine.html`,
			reuseExistingServer: false,
		},
	],
	projects: [
		{ name: ci ? 'chromium-swiftshader' : 'chrome-real-gpu', testIgnore: 'resize.spec.ts' },
		// The engine test again, on the production build: the sketch module and the engine core must
		// survive bundling on both GPU paths and in every thread mode.
		{
			name: 'production build',
			testMatch: 'engine.spec.ts',
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
