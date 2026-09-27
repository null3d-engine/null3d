import { defineConfig } from '@playwright/test';
import { HTTP_PORT, REPO_ROOT } from './lib/server.ts';

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
	webServer: {
		command: 'bunx vite',
		cwd: REPO_ROOT,
		url: `http://localhost:${HTTP_PORT}/tests/pages/index.html`,
		reuseExistingServer: !ci,
	},
	projects: [{ name: ci ? 'chromium-swiftshader' : 'chrome-real-gpu' }],
});
