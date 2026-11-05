// The headless browsers that draw frames: a pinned Chrome for Testing on the computer's own GPU, or
// Playwright's Chromium on SwiftShader, the software GPU that machines without a GPU use, such as CI
// machines. The two draw object edges a little differently, so each keeps its own reference images.
// Chrome for Testing downloads into a cache folder on first use, and the installed Google Chrome
// stands in when that fails or when `NULL3D_CHROME=installed` asks for it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
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
 * The SHA-256 hash of the pinned build's archive on each platform, in lowercase hexadecimal. The
 * tool refuses a download with any other hash before it unpacks it. A change of the pinned version
 * records each platform's hash again, as the image tests guide in `.dev/` says.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHROME_FOR_TESTING_SHA256 = {
	'mac-arm64': '8bc590d1b1acac042a000234c768f31830f25a3983a83ed5e067114c87c4cad1',
	'mac-x64': '672b79dc79fdf28bb2ec9787b7fa33810c2b3cfd946a0fb4d3b72775f4e6fd9a',
	linux64: 'b711c720f774be355197f32edf37e0651418ba036d92446ee2da19ac017540a7',
	win64: '16edb57d6107bf1c48a7c149b8d78b155fe614410093796dd72441fd6640540f',
};

/** The engine's error code for a Chrome for Testing build that the tool refuses to install. */
export const CHROME_REFUSED = 'E1437';

/** The fix that ends the refusal's message, which a unit test keeps equal to the engine's table. */
export const CHROME_REFUSED_FIX =
	"Run the command again. A download that broke off, or that something changed on the way, fails the check. If the check fails again, a proxy or a mirror between this computer and Google's storage changes the file, so download without it. On a platform that has no Chrome for Testing build, set CI=1 to draw with Playwright's Chromium on the software GPU, or NULL3D_CHROME=installed to draw with the installed Google Chrome.";

/**
 * A refusal to install Chrome for Testing, worded as the engine words its errors: the code, what
 * failed, the fix and the code's docs page.
 *
 * @param {string} detail
 */
function chromeRefused(detail) {
	return Object.assign(
		new Error(
			`${CHROME_REFUSED}: ${detail} ${CHROME_REFUSED_FIX} See https://github.com/null3d-engine/null3d/blob/generated/docs/errors/${CHROME_REFUSED}.md`,
		),
		{ code: CHROME_REFUSED },
	);
}

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
	if (!name) throw chromeRefused(`Chrome for Testing has no build for ${platform} on ${arch}.`);
	return name;
}

/**
 * The SHA-256 hash that the pinned build's archive must have on `platform`. A platform without a
 * recorded hash is refused, so no download goes unchecked.
 *
 * @param {string} platform
 * @returns {string}
 */
export function chromeForTestingSha256(platform = chromeForTestingPlatform()) {
	const hash = Object.hasOwn(CHROME_FOR_TESTING_SHA256, platform)
		? CHROME_FOR_TESTING_SHA256[platform]
		: undefined;
	if (!hash)
		throw chromeRefused(
			`the tool records no SHA-256 hash for Chrome for Testing ${CHROME_FOR_TESTING_VERSION} on ${platform}, so it cannot check a download.`,
		);
	return hash;
}

/**
 * Refuses a downloaded `archive` whose SHA-256 hash, `digest`, is not the `expected` one. It deletes
 * the file first, so nothing can unpack it later.
 *
 * @param {string} archive
 * @param {string} digest
 * @param {string} expected
 * @param {string} platform
 */
export function checkChromeArchive(archive, digest, expected, platform) {
	if (digest === expected) return;
	rmSync(archive, { force: true });
	throw chromeRefused(
		`the Chrome for Testing ${CHROME_FOR_TESTING_VERSION} archive for ${platform} has the SHA-256 hash ${digest}, not ${expected}, so the tool deleted it.`,
	);
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

/** The file in the cache folder that holds the archive's hash, which the install checked. */
const VERIFIED_FILE = 'verified.sha256';

/**
 * Whether the pinned build under `dir` is installed and was checked when it was installed: its
 * executable is there, and the hash that the install recorded beside it is the expected one. A copy
 * without that record, such as one unzipped by hand, is not trusted.
 *
 * @param {string} dir
 * @param {string} platform
 */
export function chromeForTestingInstalled(
	dir = chromeForTestingDir(),
	platform = chromeForTestingPlatform(),
) {
	if (!existsSync(chromeForTestingPath(dir, platform))) return false;
	try {
		return (
			readFileSync(join(dir, VERIFIED_FILE), 'utf8').trim() === chromeForTestingSha256(platform)
		);
	} catch {
		// No record, or a platform without a hash: the copy is not trusted.
		return false;
	}
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
 * Passes bytes through, and adds each to `hash`.
 *
 * @param {import('node:crypto').Hash} hash
 */
function hashing(hash) {
	return new Transform({
		transform(chunk, _encoding, done) {
			hash.update(chunk);
			done(null, chunk);
		},
	});
}

/**
 * Downloads the pinned Chrome for Testing into its cache folder, unless a checked copy is there
 * already, and returns its executable. The archive's SHA-256 hash must be the one recorded for the
 * platform, or the install deletes the archive before it unpacks it, and fails with E1437. The archive
 * unpacks into a folder of its own beside the target, with the checked hash recorded in it, and
 * moves into place whole. So a run never sees half a browser, and two downloads at once leave one
 * copy. A copy that holds no record of its check is replaced.
 *
 * @param {{ log?: (line: string) => void, dir?: string, platform?: string, download?: (url: string) => Promise<Response> }} [options]
 * @returns {Promise<string>}
 */
export async function installChromeForTesting({
	log = console.log,
	dir = chromeForTestingDir(),
	platform = chromeForTestingPlatform(),
	download = (url) => fetch(url),
} = {}) {
	const executable = chromeForTestingPath(dir, platform);
	if (chromeForTestingInstalled(dir, platform)) return executable;
	const expected = chromeForTestingSha256(platform);
	mkdirSync(dirname(dir), { recursive: true });
	const staging = mkdtempSync(`${dir}.download-`);
	try {
		const url = chromeForTestingUrl(platform);
		const response = await download(url);
		if (!response.ok || !response.body)
			throw new Error(`${url} answered ${response.status} ${response.statusText}`);
		const total = Number(response.headers.get('content-length') ?? 0);
		log(
			`Downloading Chrome for Testing ${CHROME_FOR_TESTING_VERSION}${total ? ` (${Math.round(total / 1e6)} MB)` : ''} into ${dir}, once. null3d draws with it on this computer's GPU: Google Chrome on macOS leaves keys in the keychain.`,
		);
		const archive = join(staging, 'chrome.zip');
		const hash = createHash('sha256');
		await pipeline(
			Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)),
			hashing(hash),
			downloadProgress(total, log),
			createWriteStream(archive),
		);
		const digest = hash.digest('hex');
		checkChromeArchive(archive, digest, expected, platform);
		const unpacked = join(staging, 'browser');
		mkdirSync(unpacked);
		if (process.platform === 'win32') execFileSync('tar', ['-xf', archive, '-C', unpacked]);
		else execFileSync('unzip', ['-q', archive, '-d', unpacked]);
		if (!existsSync(chromeForTestingPath(unpacked, platform)))
			throw new Error(`${url} holds no browser at ${chromeForTestingPath(unpacked, platform)}`);
		writeFileSync(join(unpacked, VERIFIED_FILE), `${digest}\n`);
		// A copy that holds no record of a checked hash goes first: nothing vouches for its files.
		if (existsSync(dir) && !chromeForTestingInstalled(dir, platform))
			rmSync(dir, { recursive: true, force: true });
		try {
			renameSync(unpacked, dir);
		} catch (error) {
			// Another download that ran at the same time put its checked copy in place first.
			if (!chromeForTestingInstalled(dir, platform)) throw error;
		}
		log(`  installed at ${executable}`);
		return executable;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Gets the pinned Chrome for Testing ready, downloading it on first use, and returns the build that
 * draws on the real GPU. A copy whose install did not check its hash downloads again. When it
 * cannot be installed, the installed Google Chrome draws instead, with a warning, if `fallback`
 * allows it; otherwise the failure stands.
 *
 * @param {{ fallback: boolean, installed?: () => boolean, install?: () => Promise<unknown>, warn?: (line: string) => void }} options
 * @returns {Promise<ChromeBuild>}
 */
export async function readyChromeForTesting({
	fallback,
	installed = chromeForTestingInstalled,
	install = installChromeForTesting,
	warn = console.warn,
}) {
	try {
		if (!installed()) await install();
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
		? `Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is not installed at ${chromeForTestingPath()}. The tool downloads it from ${chromeForTestingUrl()} into ${chromeForTestingDir()} on first use, and checks its SHA-256 hash. Run the command again with a network connection.`
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
