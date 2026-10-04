import { defineConfig } from '@playwright/test';
import { browserOptions, defaultEnvironment } from '../packages/cli/src/browser.js';
import { ensureShaderModules } from '../tools/lib/shader-modules.ts';
import { HTTP_PORT, PREVIEW_PORT, REPO_ROOT } from './lib/server.ts';

// The test files import the shader modules, which git does not keep, and Playwright loads the test
// files before it starts the web servers.
ensureShaderModules(REPO_ROOT);

const ci = Boolean(process.env.CI);
/**
 * The main project's environment, which names the references that its image tests compare with:
 * SwiftShader in CI, and the real GPU through the installed Google Chrome elsewhere.
 */
const environment = defaultEnvironment();
const launchOptions = browserOptions(environment);
/** Device pixels per CSS pixel on the screen of the resize tests, as on most phones and laptops. */
const HIGH_DENSITY_RATIO = 2;

/** The dev server, which serves every page of the repository from its source. */
export const DEV_SERVER = {
	command: 'bunx vite',
	cwd: REPO_ROOT,
	url: `http://localhost:${HTTP_PORT}/tests/pages/index.html`,
	reuseExistingServer: !ci,
};

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
		DEV_SERVER,
		{
			// A fresh production build every run, so the tests never serve stale files. The errors,
			// sketch shaders, KTX2 and stats pages build on their own, so the engine test page stays
			// as the startup benchmark loads it.
			command: `bunx vite build && NULL3D_BUILD_PAGE=errors bunx vite build && NULL3D_BUILD_PAGE=sketch-shaders bunx vite build && NULL3D_BUILD_PAGE=ktx2-files bunx vite build && NULL3D_BUILD_PAGE=gltf-files bunx vite build && NULL3D_BUILD_PAGE=stats bunx vite build && bunx vite preview --port ${PREVIEW_PORT} --strictPort`,
			cwd: REPO_ROOT,
			url: `http://localhost:${PREVIEW_PORT}/tests/pages/engine.html`,
			reuseExistingServer: false,
		},
	],
	projects: [
		{
			name: environment,
			testIgnore: ['resize.spec.ts', 'content-security-policy.spec.ts', 'cdn.spec.ts'],
		},
		// The engine and errors tests again, on the production build. The sketch module and the engine
		// core must survive bundling on both GPU paths and in every thread mode. So must the engine's
		// errors in a sketch, whose bundle holds its own copy of the engine's error code, the WGSL
		// that the plugin compiles into a sketch's bundle, and the KTX2 loader and transcoder, the glTF
		// loader and its worker, the stats overlay and the frame figures, which the build ships as
		// files of their own. The start under a strict Content-Security-Policy runs only here, since
		// only a bundler turns small files into the inline addresses that such a policy blocks. So does
		// the start with the engine's files on another origin, as from a CDN, which needs built files.
		{
			name: 'production build',
			testMatch: [
				'content-security-policy.spec.ts',
				'cdn.spec.ts',
				'engine.spec.ts',
				'errors.spec.ts',
				'sketch-shaders.spec.ts',
				'ktx2.spec.ts',
				'gltf.spec.ts',
				'stats.spec.ts',
			],
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
