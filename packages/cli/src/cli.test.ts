import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ERROR_FIXES } from '../../engine/src/errors/fixes.ts';
import {
	browserOptions,
	CHROME_FOR_TESTING_SHA256,
	CHROME_FOR_TESTING_VERSION,
	CHROME_REFUSED,
	CHROME_REFUSED_FIX,
	checkChromeArchive,
	chromeBuild,
	chromeFallback,
	chromeForTestingDir,
	chromeForTestingInstalled,
	chromeForTestingPath,
	chromeForTestingPlatform,
	chromeForTestingSha256,
	chromeForTestingUrl,
	defaultEnvironment,
	installChromeForTesting,
	missingBrowserFix,
	readyChromeForTesting,
	SWIFTSHADER_ARGS,
} from './browser.js';
import { main, VERSION } from './cli.js';
import { holdPath, switchedPath } from './page.js';

describe('main', () => {
	const log = spyOn(console, 'log').mockImplementation(() => {});
	const error = spyOn(console, 'error').mockImplementation(() => {});
	afterEach(() => {
		log.mockClear();
		error.mockClear();
	});

	it('prints its version, and its commands as help', async () => {
		expect(await main(['--version'])).toBe(0);
		expect(log).toHaveBeenLastCalledWith(VERSION);
		expect(await main([])).toBe(0);
		expect(log.mock.lastCall?.[0]).toContain("shot         Draws one frame of the project's page");
		expect(log.mock.lastCall?.[0]).toContain('test         Type checks and lints the project');
		expect(log.mock.lastCall?.[0]).toContain('create       Makes a new project from a template');
	});

	it('fails on a command it does not have, and names its commands', async () => {
		expect(await main(['scaffold'])).toBe(1);
		expect(error.mock.lastCall?.[0]).toBe(
			'null3d has no "scaffold" command. Its commands: assets, bench, check-addon, create, shot, test, upgrade. Run bunx @null3d/cli --help for more.',
		);
		expect(await main(['toString'])).toBe(1);
	});

	it("turns a mistake in a command's options into a pointer to the command's help", async () => {
		expect(await main(['shot', '--gpu', 'metal'])).toBe(1);
		expect(error.mock.lastCall?.[0]).toBe(
			'null3d shot: --gpu takes webgpu, compat, webgl2, not "metal". Run bunx @null3d/cli shot --help for its options.',
		);
		expect(await main(['shot', '--help'])).toBe(0);
		expect(log.mock.lastCall?.[0]).toStartWith('Usage: bunx @null3d/cli shot [options]');
	});
});

describe('the environments', () => {
	it('draw on SwiftShader when the CI variable is set, and on the real GPU elsewhere', () => {
		expect(defaultEnvironment({ CI: 'true' })).toBe('chromium-swiftshader');
		expect(defaultEnvironment({ CI: '' })).toBe('chrome-real-gpu');
		expect(defaultEnvironment({})).toBe('chrome-real-gpu');
	});

	it("start Google Chrome or Chrome for Testing for the real GPU, and Playwright's Chromium with SwiftShader's flags", () => {
		expect(browserOptions('chrome-real-gpu', 'installed')).toEqual({ channel: 'chrome' });
		expect(browserOptions('chrome-real-gpu', 'testing')).toEqual({
			executablePath: chromeForTestingPath(),
		});
		expect(browserOptions('chromium-swiftshader', 'testing')).toEqual({ args: SWIFTSHADER_ARGS });
	});

	it('use Chrome for Testing unless NULL3D_CHROME asks for the installed Google Chrome', () => {
		expect(chromeBuild({})).toBe('testing');
		expect(chromeBuild({ NULL3D_CHROME: 'testing' })).toBe('testing');
		expect(chromeBuild({ NULL3D_CHROME: 'installed' })).toBe('installed');
	});

	it('fall back to the installed Google Chrome unless NULL3D_CHROME asks for Chrome for Testing alone', () => {
		expect(chromeFallback({})).toBe(true);
		expect(chromeFallback({ NULL3D_CHROME: 'installed' })).toBe(true);
		expect(chromeFallback({ NULL3D_CHROME: 'testing' })).toBe(false);
	});

	it("name the install command of the browser driver's own Chromium, and Chrome for Testing's download", () => {
		expect(missingBrowserFix('chromium-swiftshader')).toBe(
			"Playwright's Chromium is not installed. Install it with bunx playwright-core@1.63.0 install chromium.",
		);
		expect(missingBrowserFix('chrome-real-gpu', 'installed')).toStartWith(
			'Google Chrome is not installed.',
		);
		expect(missingBrowserFix('chrome-real-gpu', 'testing')).toBe(
			`Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is not installed at ${chromeForTestingPath()}. The tool downloads it from ${chromeForTestingUrl()} into ${chromeForTestingDir()} on first use, and checks its SHA-256 hash. Run the command again with a network connection.`,
		);
	});
});

describe('Chrome for Testing', () => {
	it('lives in the shared cache folder, under XDG_CACHE_HOME when it is set', () => {
		const version = CHROME_FOR_TESTING_VERSION;
		expect(chromeForTestingDir({ HOME: '/home/a' })).toBe(
			join('/home/a/.cache/null3d/chrome-for-testing', version),
		);
		expect(chromeForTestingDir({ HOME: '/home/a', XDG_CACHE_HOME: '/xdg' })).toBe(
			join('/xdg/null3d/chrome-for-testing', version),
		);
	});

	it('starts the cached copy without a download', async () => {
		const install = mock(async () => '');
		const warn = mock(() => {});
		expect(
			await readyChromeForTesting({ fallback: true, installed: () => true, install, warn }),
		).toBe('testing');
		expect(install).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it('downloads on first use', async () => {
		const install = mock(async () => '');
		expect(await readyChromeForTesting({ fallback: false, installed: () => false, install })).toBe(
			'testing',
		);
		expect(install).toHaveBeenCalledTimes(1);
	});

	it('falls back to the installed Google Chrome with a warning when the download fails', async () => {
		const install = mock(async () => {
			throw new Error('offline');
		});
		const warn = mock((_line: string) => {});
		expect(
			await readyChromeForTesting({ fallback: true, installed: () => false, install, warn }),
		).toBe('installed');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toBe(
			`Chrome for Testing ${CHROME_FOR_TESTING_VERSION} could not be installed (offline), so the installed Google Chrome draws instead. On macOS it may leave keys in the keychain.`,
		);
	});

	it('fails with the fix when the download fails and no fallback is allowed', async () => {
		const install = mock(async () => {
			throw new Error('offline');
		});
		await expect(
			readyChromeForTesting({ fallback: false, installed: () => false, install }),
		).rejects.toThrow(`${missingBrowserFix('chrome-real-gpu', 'testing')} offline`);
	});

	it("names each platform's build, archive and executable", () => {
		expect(chromeForTestingPlatform('darwin', 'arm64')).toBe('mac-arm64');
		expect(chromeForTestingPlatform('darwin', 'x64')).toBe('mac-x64');
		expect(chromeForTestingPlatform('linux', 'x64')).toBe('linux64');
		expect(chromeForTestingPlatform('win32', 'x64')).toBe('win64');
		expect(() => chromeForTestingPlatform('linux', 'arm64')).toThrow('no build for linux on arm64');
		expect(chromeForTestingUrl('mac-arm64')).toBe(
			`https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/mac-arm64/chrome-mac-arm64.zip`,
		);
		expect(chromeForTestingPath('/c', 'mac-arm64')).toBe(
			'/c/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
		);
		expect(chromeForTestingPath('/c', 'linux64')).toBe('/c/chrome-linux64/chrome');
		expect(chromeForTestingPath('/c', 'win64')).toBe(join('/c/chrome-win64', 'chrome.exe'));
	});
});

describe("Chrome for Testing's download check", () => {
	const PLATFORMS = ['mac-arm64', 'mac-x64', 'linux64', 'win64'];
	const DOCS = 'https://github.com/null3d-engine/null3d/blob/generated/docs/errors/E1437.md';
	let root = '';
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'null3d-chrome-check-'));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	/** A cache folder whose executable is in place, with `record` as the hash its install checked. */
	function cached(record?: string): string {
		const dir = join(root, 'cache', CHROME_FOR_TESTING_VERSION);
		mkdirSync(dirname(chromeForTestingPath(dir, 'linux64')), { recursive: true });
		writeFileSync(chromeForTestingPath(dir, 'linux64'), '');
		if (record !== undefined) writeFileSync(join(dir, 'verified.sha256'), `${record}\n`);
		return dir;
	}

	it('records a hash for every platform that has a build, with the fix of the engine table', () => {
		for (const platform of PLATFORMS)
			expect(chromeForTestingSha256(platform)).toMatch(/^[0-9a-f]{64}$/);
		expect(Object.keys(CHROME_FOR_TESTING_SHA256).sort()).toEqual([...PLATFORMS].sort());
		expect(CHROME_REFUSED).toBe('E1437');
		expect(CHROME_REFUSED_FIX).toBe(ERROR_FIXES.E1437);
	});

	it('keeps an archive whose hash matches', () => {
		const archive = join(root, 'chrome.zip');
		writeFileSync(archive, 'the archive');
		const digest = createHash('sha256').update('the archive').digest('hex');
		expect(() => checkChromeArchive(archive, digest, digest, 'linux64')).not.toThrow();
		expect(existsSync(archive)).toBe(true);
	});

	it('refuses and deletes an archive whose hash does not match', () => {
		const archive = join(root, 'chrome.zip');
		writeFileSync(archive, 'other bytes');
		const digest = createHash('sha256').update('other bytes').digest('hex');
		const expected = chromeForTestingSha256('linux64');
		expect(() => checkChromeArchive(archive, digest, expected, 'linux64')).toThrow(
			`E1437: the Chrome for Testing ${CHROME_FOR_TESTING_VERSION} archive for linux64 has the SHA-256 hash ${digest}, not ${expected}, so the tool deleted it. ${CHROME_REFUSED_FIX} See ${DOCS}`,
		);
		expect(existsSync(archive)).toBe(false);
	});

	it('installs nothing from a download whose hash does not match, and leaves no file of it', async () => {
		const dir = join(root, 'cache', CHROME_FOR_TESTING_VERSION);
		const download = mock(async () => new Response('not the pinned build'));
		const install = installChromeForTesting({ dir, platform: 'linux64', download, log: () => {} });
		await expect(install).rejects.toMatchObject({ code: 'E1437' });
		expect(download).toHaveBeenCalledTimes(1);
		expect(existsSync(dir)).toBe(false);
		expect(readdirSync(join(root, 'cache'))).toEqual([]);
	});

	it('refuses a platform that has no build or no recorded hash, before any download', async () => {
		expect(() => chromeForTestingPlatform('linux', 'arm64')).toThrow(
			'E1437: Chrome for Testing has no build for linux on arm64.',
		);
		expect(() => chromeForTestingSha256('linux-arm64')).toThrow(
			`E1437: the tool records no SHA-256 hash for Chrome for Testing ${CHROME_FOR_TESTING_VERSION} on linux-arm64, so it cannot check a download.`,
		);
		expect(() => chromeForTestingSha256('toString')).toThrow('E1437');
		const download = mock(async () => new Response(''));
		await expect(
			installChromeForTesting({
				dir: join(root, 'cache', CHROME_FOR_TESTING_VERSION),
				platform: 'linux-arm64',
				download,
				log: () => {},
			}),
		).rejects.toMatchObject({ code: 'E1437' });
		expect(download).not.toHaveBeenCalled();
	});

	it('trusts a cached copy only when its install recorded the expected hash', async () => {
		expect(chromeForTestingInstalled(cached(), 'linux64')).toBe(false);
		rmSync(join(root, 'cache'), { recursive: true });
		expect(chromeForTestingInstalled(cached('0'.repeat(64)), 'linux64')).toBe(false);
		rmSync(join(root, 'cache'), { recursive: true });
		const dir = cached(chromeForTestingSha256('linux64'));
		expect(chromeForTestingInstalled(dir, 'linux64')).toBe(true);
		const download = mock(async () => new Response(''));
		expect(await installChromeForTesting({ dir, platform: 'linux64', download })).toBe(
			chromeForTestingPath(dir, 'linux64'),
		);
		expect(download).not.toHaveBeenCalled();
	});

	it('leaves an unchecked cached copy untrusted when the new download is refused', async () => {
		const dir = cached();
		const download = mock(async () => new Response('not the pinned build'));
		await expect(
			installChromeForTesting({ dir, platform: 'linux64', download, log: () => {} }),
		).rejects.toMatchObject({ code: 'E1437' });
		expect(chromeForTestingInstalled(dir, 'linux64')).toBe(false);
	});
});

describe('holdPath', () => {
	it('adds a bare hold without a time, and the time and the tier when given', () => {
		expect(holdPath('/')).toBe('/?hold=');
		expect(holdPath('/', { time: 1.5, gpu: 'webgl2' })).toBe('/?hold=1.5&gpu=webgl2');
		expect(holdPath('harbor.html?view=dock', { time: 0 })).toBe('/harbor.html?view=dock&hold=0');
	});

	it('replaces hold switches that the path already has', () => {
		expect(holdPath('/?hold=9&gpu=webgpu', { time: 2, gpu: 'compat' })).toBe('/?hold=2&gpu=compat');
	});
});

describe('switchedPath', () => {
	it("adds each switch to the page's own query, bare for an empty value, and leaves out the rest", () => {
		expect(switchedPath('/', { bench: '', gpu: undefined })).toBe('/?bench=');
		expect(switchedPath('/game.html?level=2', { bench: '', gpu: 'webgl2' })).toBe(
			'/game.html?level=2&bench=&gpu=webgl2',
		);
	});
});
