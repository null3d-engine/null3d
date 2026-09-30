import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
	browserOptions,
	defaultEnvironment,
	missingBrowserFix,
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
		expect(log.mock.lastCall?.[0]).toContain("shot    Draws one frame of the project's page");
	});

	it('fails on a command it does not have, and names its commands', async () => {
		expect(await main(['create'])).toBe(1);
		expect(error.mock.lastCall?.[0]).toBe(
			'null3d has no "create" command. Its commands: bench, shot. Run bunx @null3d/cli --help for more.',
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

	it("start Google Chrome for the real GPU, and Playwright's Chromium with SwiftShader's flags", () => {
		expect(browserOptions('chrome-real-gpu')).toEqual({ channel: 'chrome' });
		expect(browserOptions('chromium-swiftshader')).toEqual({ args: SWIFTSHADER_ARGS });
	});

	it("name the install command of the browser driver's own Chromium", () => {
		expect(missingBrowserFix('chromium-swiftshader')).toBe(
			"Playwright's Chromium is not installed. Install it with bunx playwright-core@1.63.0 install chromium.",
		);
		expect(missingBrowserFix('chrome-real-gpu')).toStartWith('Google Chrome is not installed.');
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
