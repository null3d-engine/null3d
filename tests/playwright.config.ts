import { defineConfig } from '@playwright/test';

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
		baseURL: 'http://localhost:5173',
		headless: true,
		...(ci ? { launchOptions: { args: SWIFTSHADER_ARGS } } : { channel: 'chrome' }),
	},
	webServer: {
		command: 'bunx vite --config vite.config.ts',
		cwd: import.meta.dirname,
		url: 'http://localhost:5173/index.html',
		reuseExistingServer: !ci,
	},
	projects: [{ name: ci ? 'chromium-swiftshader' : 'chrome-real-gpu' }],
});
