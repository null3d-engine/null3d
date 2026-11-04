// The headless browsers that draw frames: a pinned Chrome for Testing on the computer's own GPU, or
// Playwright's Chromium on SwiftShader, the software GPU that machines without a GPU use, such as CI
// machines. The two draw object edges a little differently, so each keeps its own reference images.
// Chrome for Testing downloads into a cache folder on first use, and the installed Google Chrome
// stands in when that fails or when `NULL3D_CHROME=installed` asks for it.
import { execFileSync } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

/** The flag that turns on WebGPU's developer features, without which Chrome rounds GPU timestamps. */
export const WEBGPU_DEVELOPER_FEATURES = '--enable-webgpu-developer-features';

/**
 * Chromium flags for a run that measures GPU time: WebGPU's developer features, and Dawn's
 * timestamp quantization off, so a short pass is not rounded to the privacy grid before it is read.
 */
export const GPU_TIMING_ARGS = [
	WEBGPU_DEVELOPER_FEATURES,
	'--disable-dawn-features=timestamp_quantization',
];

/**
 * The Chrome for Testing build that draws on the real GPU. It is the Chrome version that the
 * real-GPU references and the GPU cost limits come from, and one build on every platform keeps the
 * pictures the same. Google
 * signs it with no team and no keychain rights, so it cannot keep keys in the keychain. The installed
 * Chrome on macOS makes two keys in the keychain at each start and deletes them only when its start
 * check finishes, so a browser that closes early leaves them for good, and each key it keeps slows
 * every later start.
 */
export const CHROME_FOR_TESTING_VERSION = '156.0.8078.80';

/** Chrome for Testing's name for each platform and processor that it has a build for. */
const CHROME_FOR_TESTING_PLATFORMS = /** @type {const} */ ({
	'darwin-arm64': 'mac-arm64',
	'darwin-x64': 'mac-x64',
	'linux-x64': 'linux64',
	'win32-x64': 'win64',
});

/**
 * Chrome for Testing's name for this computer's platform, such as `mac-arm64`.
 *
 * @param {string} platform
 * @param {string} arch
 * @returns {string}
 */
export function chromeForTestingPlatform(platform = process.platform, arch = process.arch) {
	const key = /** @type {keyof typeof CHROME_FOR_TESTING_PLATFORMS} */ (`${platform}-${arch}`);
	const name = CHROME_FOR_TESTING_PLATFORMS[key];
	if (!name) throw new Error(`Chrome for Testing has no build for ${platform} on ${arch}.`);
	return name;
}

/**
 * The folder that holds the pinned Chrome for Testing, which every project and every copy of the
 * repository on the computer shares: `null3d/chrome-for-testing/<version>` under `XDG_CACHE_HOME`,
 * or under `~/.cache` when that is unset.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string}
 */
export function chromeForTestingDir(env = process.env) {
	const base = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache');
	return join(base, 'null3d', 'chrome-for-testing', CHROME_FOR_TESTING_VERSION);
}

/**
 * The address of the pinned build's archive, whose one top folder goes into
 * `chromeForTestingDir()`.
 *
 * @param {string} platform
 * @returns {string}
 */
export function chromeForTestingUrl(platform = chromeForTestingPlatform()) {
	return `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/${platform}/chrome-${platform}.zip`;
}

/**
 * The pinned build's executable under `dir`.
 *
 * @param {string} dir
 * @param {string} platform
 * @returns {string}
 */
export function chromeForTestingPath(
	dir = chromeForTestingDir(),
	platform = chromeForTestingPlatform(),
) {
	const folder = join(dir, `chrome-${platform}`);
	if (platform.startsWith('mac'))
		return join(folder, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
	return join(folder, platform === 'win64' ? 'chrome.exe' : 'chrome');
}

/**
 * The builds of Chrome that draw on the real GPU: the pinned Chrome for Testing, and the installed
 * Google Chrome.
 *
 * @typedef {'testing' | 'installed'} ChromeBuild
 */

/**
 * The build of Chrome that draws on the real GPU: the installed Google Chrome when the
 * `NULL3D_CHROME` variable is `installed`, and the pinned Chrome for Testing otherwise.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {ChromeBuild}
 */
export function chromeBuild(env = process.env) {
	return env.NULL3D_CHROME === 'installed' ? 'installed' : 'testing';
}

/**
 * Whether the installed Google Chrome may draw when Chrome for Testing cannot be installed: always,
 * unless `NULL3D_CHROME=testing` asks for the pinned build alone.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function chromeFallback(env = process.env) {
	return env.NULL3D_CHROME !== 'testing';
}

/**
 * Passes bytes through, and logs how much of `total` has passed at each quarter.
 *
 * @param {number} total
 * @param {(line: string) => void} log
 */
function downloadProgress(total, log) {
	let passed = 0;
	let quarter = 0;
	return new Transform({
		transform(chunk, _encoding, done) {
			passed += chunk.length;
			const reached = total > 0 ? Math.floor((passed / total) * 4) : 0;
			if (reached > quarter && reached < 4) log(`  ${reached * 25}%`);
			quarter = reached;
			done(null, chunk);
		},
	});
}

/**
 * Downloads the pinned Chrome for Testing into its cache folder, unless it is there already, and
 * returns its executable. The archive unpacks into a folder of its own beside the target and moves
 * into place whole, so a run never sees half a browser, and two downloads at once leave one copy.
 *
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {Promise<string>}
 */
export async function installChromeForTesting({ log = console.log } = {}) {
	const dir = chromeForTestingDir();
	const executable = chromeForTestingPath(dir);
	if (existsSync(executable)) return executable;
	mkdirSync(dirname(dir), { recursive: true });
	const staging = mkdtempSync(`${dir}.download-`);
	try {
		const url = chromeForTestingUrl();
		const response = await fetch(url);
		if (!response.ok || !response.body)
			throw new Error(`${url} answered ${response.status} ${response.statusText}`);
		const total = Number(response.headers.get('content-length') ?? 0);
		log(
			`Downloading Chrome for Testing ${CHROME_FOR_TESTING_VERSION}${total ? ` (${Math.round(total / 1e6)} MB)` : ''} into ${dir}, once. null3d draws with it on this computer's GPU: Google Chrome on macOS leaves keys in the keychain.`,
		);
		const archive = join(staging, 'chrome.zip');
		await pipeline(
			Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)),
			downloadProgress(total, log),
			createWriteStream(archive),
		);
		const unpacked = join(staging, 'browser');
		mkdirSync(unpacked);
		if (process.platform === 'win32') execFileSync('tar', ['-xf', archive, '-C', unpacked]);
		else execFileSync('unzip', ['-q', archive, '-d', unpacked]);
		if (!existsSync(chromeForTestingPath(unpacked)))
			throw new Error(`${url} holds no browser at ${chromeForTestingPath(unpacked)}`);
		try {
			renameSync(unpacked, dir);
		} catch (error) {
			// Another download that ran at the same time put its copy in place first.
			if (!existsSync(executable)) throw error;
		}
		log(`  installed at ${executable}`);
		return executable;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Gets the pinned Chrome for Testing ready, downloading it on first use, and returns the build that
 * draws on the real GPU. When it cannot be installed, the installed Google Chrome draws instead,
 * with a warning, if `fallback` allows it; otherwise the failure stands.
 *
 * @param {{ fallback: boolean, exists?: (path: string) => boolean, install?: () => Promise<unknown>, warn?: (line: string) => void }} options
 * @returns {Promise<ChromeBuild>}
 */
export async function readyChromeForTesting({
	fallback,
	exists = existsSync,
	install = installChromeForTesting,
	warn = console.warn,
}) {
	try {
		if (!exists(chromeForTestingPath())) await install();
		return 'testing';
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (!fallback) throw new Error(`${missingBrowserFix('chrome-real-gpu', 'testing')} ${reason}`);
		warn(
			`Chrome for Testing ${CHROME_FOR_TESTING_VERSION} could not be installed (${reason}), so the installed Google Chrome draws instead. On macOS it may leave keys in the keychain.`,
		);
		return 'installed';
	}
}

/**
 * How Playwright starts an environment's browser. On a Mac, Playwright's own headless Chromium
 * falls back to SwiftShader, so the real GPU needs a full Chrome: the installed Google Chrome, or
 * the pinned Chrome for Testing.
 *
 * @param {Environment} environment
 * @param {ChromeBuild} chrome
 * @returns {LaunchOptions}
 */
export function browserOptions(environment, chrome = chromeBuild()) {
	if (environment !== 'chrome-real-gpu') return { args: SWIFTSHADER_ARGS };
	return chrome === 'testing' ? { executablePath: chromeForTestingPath() } : { channel: 'chrome' };
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
 * @param {ChromeBuild} chrome
 */
export function missingBrowserFix(environment, chrome = chromeBuild()) {
	const chromium = `bunx playwright-core@${driverVersion()} install chromium`;
	if (environment !== 'chrome-real-gpu')
		return `Playwright's Chromium is not installed. Install it with ${chromium}.`;
	return chrome === 'testing'
		? `Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is not installed at ${chromeForTestingPath()}. Download ${chromeForTestingUrl()} and unzip it into ${chromeForTestingDir()}.`
		: `Google Chrome is not installed. Install it from https://www.google.com/chrome/, or set CI=1 to draw on the software GPU of Playwright's Chromium, which ${chromium} installs.`;
}

/** The code that starts the message of a call that failed because its browser's process ended. */
export const BROWSER_GONE = 'BROWSER_GONE';

/** How often the guard checks that a browser's process still runs. */
const WATCH_MS = 500;

/** How long Playwright gets to notice an ended browser itself before the guard fails its calls. */
const NOTICE_MS = 2000;

/**
 * What a guarded browser needs: Playwright's own state, and the client connection that it sends on.
 *
 * @typedef {{ isConnected(): boolean, on(event: 'disconnected', listener: () => void): unknown, _connection?: { close(cause: string): void } }} Watched
 */

/**
 * Fails every call of `browser` that waits, at once, when its process `pid` ends and Playwright
 * has not noticed within a moment. A script in Bun needs it: some Bun releases close Playwright's
 * pipe to the browser at random, and the browser then ends, while Playwright waits forever on it,
 * past its own time limits. Playwright's client connection fails each waiting call with a message
 * that starts with BROWSER_GONE. A browser that Playwright saw end, as on its close, needs nothing.
 *
 * @param {Watched} browser
 * @param {number} pid
 * @param {{ alive?: (pid: number) => boolean, watchMs?: number, noticeMs?: number }} [options]
 */
export function watchBrowser(browser, pid, options = {}) {
	const { alive = processAlive, watchMs = WATCH_MS, noticeMs = NOTICE_MS } = options;
	const timer = setInterval(() => {
		if (alive(pid)) return;
		clearInterval(timer);
		setTimeout(() => {
			if (!browser.isConnected()) return;
			const cause = `${BROWSER_GONE}: the browser's process (${pid}) ended while Playwright still waited on it. Bun before 1.4.3 closes Playwright's pipe to the browser at random, and Playwright never notices; see the fresh-project test in .dev/releases.md`;
			if (browser._connection) browser._connection.close(cause);
			else {
				console.error(cause);
				process.exit(1);
			}
		}, noticeMs).unref?.();
	}, watchMs);
	timer.unref?.();
	browser.on('disconnected', () => clearInterval(timer));
}

/**
 * Whether a process runs, from its state as `ps` gives it: a process that ended but that its parent
 * has not reaped yet still exists, in state Z. Bun can leave the browser so, when it misses its end.
 *
 * @param {string} state
 */
export function runningState(state) {
	const code = state.trim();
	return code !== '' && !code.startsWith('Z');
}

/** @param {number} pid */
function processAlive(pid) {
	try {
		return runningState(
			execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }),
		);
	} catch {
		// ps fails when no process has the ID.
		return false;
	}
}

/** The browsers that Playwright started from this process, which it drives over a pipe. */
function pipedBrowsers() {
	try {
		return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' })
			.split('\n')
			.map((line) => line.trim().split(/\s+/))
			.filter(
				([, ppid, ...args]) =>
					Number(ppid) === process.pid && args.includes('--remote-debugging-pipe'),
			)
			.map(([pid]) => Number(pid));
	} catch {
		return [];
	}
}

/** The launch that runs, so that each launch finds its own new browser process. */
let launching = Promise.resolve();

/**
 * Starts Chromium or Chrome through Playwright with `options`. In Bun, `watchBrowser` guards the
 * browser, so its calls fail at once if its process ends under Playwright. Launches run one at a
 * time in Bun, so each finds the one browser process that it started.
 *
 * @param {LaunchOptions} options
 * @returns {Promise<Browser>}
 */
export function launchChromium(options) {
	if (!process.versions.bun) return chromium.launch(options);
	const launch = launching.then(async () => {
		const before = new Set(pipedBrowsers());
		const browser = await chromium.launch(options);
		const started = pipedBrowsers().filter((pid) => !before.has(pid));
		if (started.length === 1 && started[0] !== undefined)
			watchBrowser(/** @type {Watched} */ (/** @type {unknown} */ (browser)), started[0]);
		return browser;
	});
	launching = launch.then(
		() => undefined,
		() => undefined,
	);
	return launch;
}

/**
 * Starts an environment's browser, headless, with any `args` besides its own flags. On the real GPU
 * it is the `chrome` build, and Chrome for Testing downloads on first use, with the installed Google
 * Chrome in its place on a failure when `fallback` allows it. A browser that is not installed fails
 * with the fix.
 *
 * @param {Environment} environment
 * @param {readonly string[]} [args]
 * @param {ChromeBuild} [chrome]
 * @param {boolean} [fallback]
 * @returns {Promise<Browser>}
 */
export async function launchBrowser(
	environment,
	args = [],
	chrome = chromeBuild(),
	fallback = chromeFallback(),
) {
	const build =
		environment === 'chrome-real-gpu' && chrome === 'testing'
			? await readyChromeForTesting({ fallback })
			: chrome;
	const options = browserOptions(environment, build);
	try {
		return await launchChromium({
			headless: true,
			...options,
			args: [...(options.args ?? []), ...args],
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/Executable doesn't exist|is not found at/.test(message))
			throw new Error(missingBrowserFix(environment, build));
		throw error;
	}
}
