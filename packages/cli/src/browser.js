// The headless browsers that draw frames: Google Chrome on the computer's own GPU, or Playwright's
// Chromium on SwiftShader, the software GPU that machines without a GPU use, such as CI machines.
// The two draw object edges a little differently, so each keeps its own reference images.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

/** @import { Browser, LaunchOptions } from 'playwright-core' */

/**
 * The places that draw frames: Chromium on SwiftShader, and Chrome on the real GPU.
 *
 * @type {readonly ['chromium-swiftshader', 'chrome-real-gpu']}
 */
export const ENVIRONMENTS = ['chromium-swiftshader', 'chrome-real-gpu'];

/** @typedef {(typeof ENVIRONMENTS)[number]} Environment */

/** Chromium flags for WebGPU and WebGL2 on SwiftShader, the software GPU. */
export const SWIFTSHADER_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan',
	'--use-angle=swiftshader',
	'--use-vulkan=swiftshader',
	'--enable-unsafe-swiftshader',
	'--ignore-gpu-blocklist',
	'--no-sandbox',
	'--hide-scrollbars',
];

/**
 * How Playwright starts an environment's browser. On a Mac, Playwright's own headless Chromium
 * falls back to SwiftShader, so the real GPU needs the installed Google Chrome.
 *
 * @param {Environment} environment
 * @returns {LaunchOptions}
 */
export function browserOptions(environment) {
	return environment === 'chrome-real-gpu' ? { channel: 'chrome' } : { args: SWIFTSHADER_ARGS };
}

/**
 * The environment that draws when none is asked for: SwiftShader when the CI variable is set, as
 * CI machines have no GPU, and the real GPU elsewhere.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Environment}
 */
export function defaultEnvironment(env = process.env) {
	return env.CI ? 'chromium-swiftshader' : 'chrome-real-gpu';
}

/** The version of Playwright's browser driver, whose own Chromium build the SwiftShader runs need. */
function driverVersion() {
	const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	return /** @type {string} */ (manifest.dependencies['playwright-core']);
}

/**
 * What to do when an environment's browser is not installed.
 *
 * @param {Environment} environment
 */
export function missingBrowserFix(environment) {
	const chromium = `bunx playwright-core@${driverVersion()} install chromium`;
	return environment === 'chrome-real-gpu'
		? `Google Chrome is not installed. Install it from https://www.google.com/chrome/, or set CI=1 to draw on the software GPU of Playwright's Chromium, which ${chromium} installs.`
		: `Playwright's Chromium is not installed. Install it with ${chromium}.`;
}

/**
 * Starts an environment's browser, headless. A browser that is not installed fails with the fix.
 *
 * @param {Environment} environment
 * @returns {Promise<Browser>}
 */
export async function launchBrowser(environment) {
	try {
		return await chromium.launch({ headless: true, ...browserOptions(environment) });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/Executable doesn't exist|is not found at/.test(message))
			throw new Error(missingBrowserFix(environment));
		throw error;
	}
}
