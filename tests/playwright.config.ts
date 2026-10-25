import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserOptions, defaultEnvironment } from '../packages/cli/src/browser.js';
import { refuseInQuietWindow } from '../tools/lib/quiet-window.ts';
import { ensureShaderModules } from '../tools/lib/shader-modules.ts';
import { ALONE_PROJECT_SUFFIX, RUNS_ALONE } from './lib/alone.ts';
import {
	HTTP_PORT,
	PREVIEW_PORT,
	PRODUCTION_BUILD_TESTS,
	PRODUCTION_PAGES_SWITCH,
	REPO_ROOT,
} from './lib/server.ts';

// A run refuses to start in another run's quiet window. Its workers and web servers inherit the
// runner's pass, so a window that opens later never stops a run halfway.
refuseInQuietWindow('The browser tests');
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
/** The main project's tests: every test file but those that only the other projects run. */
const MAIN_PROJECT = {
	testIgnore: ['resize.spec.ts', 'content-security-policy.spec.ts', 'cdn.spec.ts'],
};
/**
 * How this run treats the production build ([`PRODUCTION_PAGES_SWITCH`]). The build takes minutes,
 * and only the production build projects read it, so a CI job whose tests include none of them
 * skips it, and one job builds the pages once for both runs of those projects.
 */
const productionPagesMode = process.env[PRODUCTION_PAGES_SWITCH];
const productionPages = productionPagesMode !== 'skip';

/** The production build project's tests, and the server that serves its pages. */
const PRODUCTION_BUILD = {
	testMatch: [...PRODUCTION_BUILD_TESTS],
	use: { baseURL: `http://localhost:${PREVIEW_PORT}/tests/pages/` },
};

/**
 * The dev server, which serves every page of the repository from its source. Off CI a run reuses a
 * server that already answers on its port, and the checkout setup refuses one of another copy.
 */
export const DEV_SERVER = {
	command: 'bunx vite',
	cwd: REPO_ROOT,
	url: `http://localhost:${HTTP_PORT}/tests/pages/index.html`,
	reuseExistingServer: !ci,
};

/** The production build of the test pages, and the preview that serves it. */
const PRODUCTION_SERVER = {
	// A fresh production build every run, so the tests never serve stale files, unless the run says
	// that the pages are built. `bun run build:test-pages` builds each page on its own, so the engine
	// test page stays as the startup benchmark loads it.
	command: `${productionPagesMode === 'prebuilt' ? '' : 'bun run build:test-pages && '}bunx vite preview --port ${PREVIEW_PORT} --strictPort`,
	cwd: REPO_ROOT,
	// The port, not a page: a CI part builds only the pages that its tests load.
	port: PREVIEW_PORT,
	reuseExistingServer: false,
	// The chain builds seven pages before the preview serves them, and on a slow runner the default
	// minute runs out partway through: the run then fails as if the server never started, with every
	// build it finished in the log. A busy CI machine took the chain past five minutes on 19 October
	// 2026 while each build was still finishing.
	timeout: 900_000,
};

export default defineConfig({
	testDir: 'image',
	outputDir: '../test-results/playwright',
	timeout: 60_000,
	// Refuses a run that times frames at macOS background priority, before any browser starts, and a
	// run whose reused dev server serves another copy of the repository. The paths are absolute,
	// because Playwright resolves a global setup against the config file that names it: the
	// benchmark config spreads this one, so a relative path would resolve under bench/.
	globalSetup: [
		join(import.meta.dirname, 'lib/priority-setup.ts'),
		join(import.meta.dirname, 'lib/checkout-setup.ts'),
	],
	forbidOnly: ci,
	reporter: ci ? [['list'], ['github']] : 'list',
	use: {
		baseURL: `http://localhost:${HTTP_PORT}/tests/pages/`,
		headless: true,
		launchOptions,
	},
	webServer: [DEV_SERVER, ...(productionPages ? [PRODUCTION_SERVER] : [])],
	projects: [
		{ name: environment, ...MAIN_PROJECT, grepInvert: RUNS_ALONE },
		// The engine and errors tests again, on the production build. The sketch module and the engine
		// core must survive bundling on both GPU paths and in every thread mode. So must the engine's
		// errors in a sketch, whose bundle holds its own copy of the engine's error code, the WGSL
		// that the plugin compiles into a sketch's bundle, and the KTX2 loader and transcoder, the glTF
		// loader and its worker, the stats overlay and the frame figures, which the build ships as
		// files of their own. The start under a strict Content-Security-Policy runs only here, since
		// only a bundler turns small files into the inline addresses that such a policy blocks. So does
		// the start with the engine's files on another origin, as from a CDN, which needs built files.
		...(productionPages
			? [{ name: 'production build', ...PRODUCTION_BUILD, grepInvert: RUNS_ALONE }]
			: []),
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
		// The tests that run alone (`tests/lib/alone.ts`), one at a time in each project. CI runs
		// them in a job of their own, so that no other test runs beside them, and the shards leave
		// them out. The other projects never run them.
		{
			name: `${environment}${ALONE_PROJECT_SUFFIX}`,
			...MAIN_PROJECT,
			grep: RUNS_ALONE,
			workers: 1,
		},
		...(productionPages
			? [
					{
						name: `production build${ALONE_PROJECT_SUFFIX}`,
						...PRODUCTION_BUILD,
						grep: RUNS_ALONE,
						workers: 1,
					},
				]
			: []),
	],
});
