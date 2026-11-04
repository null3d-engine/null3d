import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { join } from 'node:path';
import {
	browserOptions,
	CHROME_FOR_TESTING_VERSION,
	chromeBuild,
	chromeFallback,
	chromeForTestingDir,
	chromeForTestingPath,
	chromeForTestingPlatform,
	chromeForTestingUrl,
	defaultEnvironment,
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
			`Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is not installed at ${chromeForTestingPath()}. Download ${chromeForTestingUrl()} and unzip it into ${chromeForTestingDir()}.`,
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
		expect(await readyChromeForTesting({ fallback: true, exists: () => true, install, warn })).toBe(
			'testing',
		);
		expect(install).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it('downloads on first use', async () => {
		const install = mock(async () => '');
		expect(await readyChromeForTesting({ fallback: false, exists: () => false, install })).toBe(
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
			await readyChromeForTesting({ fallback: true, exists: () => false, install, warn }),
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
			readyChromeForTesting({ fallback: false, exists: () => false, install }),
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
