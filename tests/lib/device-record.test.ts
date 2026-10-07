// The browser that the runner page detects, the warning for a runner named for another browser,
// and the run's entry for the record of tested devices. The user agents and client hints of Safari, Chrome,
// Brave and Firefox come from real runs; the others are the forms that those browsers send.
import { describe, expect, it } from 'bun:test';
import { summaryLine } from '../real-browsers.ts';
import {
	browserMismatch,
	type DeviceFacts,
	detectBrowser,
	type TestedDeviceEntry,
	testedDeviceEntry,
} from './device-record.ts';

/** Client hints as Chromium-based browsers give them, with the brands in their own order. */
const hints = (brands: Record<string, string>, more: Record<string, string> = {}) => ({
	fullVersionList: Object.entries(brands).map(([brand, version]) => ({ brand, version })),
	...more,
});

const UA = {
	iPhoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
	iPadSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15',
	iPadBrave:
		'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.7 Mobile/15E148 Safari/604.1 Brave',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
	macFirefox:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
	samsungInternet:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
	androidEdge:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.3485.54',
	androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
	iPhoneChrome:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
	windowsEdge:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.3510.41',
	windowsFirefox:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
};

describe('the browser that the runner page detects', () => {
	it("reads Safari's version from its user agent, which gives iOS 18.7 on iOS 26", () => {
		expect(detectBrowser({ userAgent: UA.iPhoneSafari })).toEqual({
			name: 'Safari',
			version: '26.4',
		});
		expect(detectBrowser({ userAgent: UA.iPadSafari })).toEqual({
			name: 'Safari',
			version: '26.6.2',
		});
	});

	it("reads a Chromium browser's full version from its client hints, not its frozen user agent", () => {
		const chrome = hints({
			Chromium: '154.0.8037.57',
			'Google Chrome': '154.0.8037.57',
			'Not A(Brand': '99.0.0.0',
		});
		expect(detectBrowser({ userAgent: UA.androidChrome, userAgentData: chrome })).toEqual({
			name: 'Chrome',
			version: '154.0.8037.57',
		});
		const brave = hints({ Brave: '153.0.0.0', 'Not_A Brand': '8.0.0.0', Chromium: '153.0.0.0' });
		expect(detectBrowser({ userAgent: UA.macChrome, userAgentData: brave, brave: true })).toEqual({
			name: 'Brave',
			version: '153.0.0.0',
		});
		const samsung = hints({ 'Samsung Internet': '28.0', Chromium: '130.0.6723.86' });
		expect(detectBrowser({ userAgent: UA.samsungInternet, userAgentData: samsung })).toEqual({
			name: 'Samsung Internet',
			version: '28.0',
		});
	});

	it('tells Edge from Chrome on Windows', () => {
		const edge = hints({
			'Microsoft Edge': '154.0.3510.41',
			Chromium: '154.0.7871.12',
			'Not.A/Brand': '99.0.0.0',
		});
		expect(detectBrowser({ userAgent: UA.windowsEdge, userAgentData: edge })).toEqual({
			name: 'Edge',
			version: '154.0.3510.41',
		});
		const chrome = hints({ Chromium: '154.0.7871.12', 'Google Chrome': '154.0.7871.12' });
		expect(detectBrowser({ userAgent: UA.windowsChrome, userAgentData: chrome })).toEqual({
			name: 'Chrome',
			version: '154.0.7871.12',
		});
	});

	it("trusts a fork's user agent token where its client hints name only Chromium", () => {
		const chromiumOnly = hints({ Chromium: '130.0.6723.86', 'Not?A_Brand': '99.0.0.0' });
		const name = (userAgent: string) => detectBrowser({ userAgent, userAgentData: chromiumOnly });
		expect(name(UA.samsungInternet)).toEqual({ name: 'Samsung Internet', version: '28.0' });
		expect(name(UA.androidEdge)).toEqual({ name: 'Edge', version: '140.0.3485.54' });
		expect(name(UA.androidChrome)).toEqual({ name: 'Chromium', version: '130.0.6723.86' });
	});

	it("names Brave on iOS without a version, because the version there is Safari's", () => {
		expect(detectBrowser({ userAgent: UA.iPadBrave, brave: true })).toEqual({
			name: 'Brave',
			version: null,
		});
		expect(detectBrowser({ userAgent: UA.androidChrome, brave: true })).toEqual({
			name: 'Brave',
			version: null,
		});
	});

	it('tells the other browsers apart by their user agent tokens', () => {
		const name = (userAgent: string) => detectBrowser({ userAgent });
		expect(name(UA.macFirefox)).toEqual({ name: 'Firefox', version: '156.0' });
		expect(name(UA.androidFirefox)).toEqual({ name: 'Firefox', version: '143.0' });
		expect(name(UA.samsungInternet)).toEqual({ name: 'Samsung Internet', version: '28.0' });
		expect(name(UA.androidEdge)).toEqual({ name: 'Edge', version: '140.0.3485.54' });
		expect(name(UA.iPhoneChrome)).toEqual({ name: 'Chrome', version: '140.0.7339.122' });
		expect(name(UA.androidChrome)).toEqual({ name: 'Chrome', version: '154.0.0.0' });
		expect(name(UA.windowsFirefox)).toEqual({ name: 'Firefox', version: '157.0' });
		expect(name(UA.windowsEdge)).toEqual({ name: 'Edge', version: '154.0.3510.41' });
		expect(name('a browser nobody knows')).toEqual({ name: 'unknown', version: null });
	});
});

describe('the warning for a runner named for another browser', () => {
	const chrome = { name: 'Chrome', version: '153.0.8010.52' } as const;

	it('warns when the device opened another browser than its runner names', () => {
		expect(browserMismatch('tb-safari', chrome)).toBe(
			"tb-safari: the runner's name says Safari, but its page ran in Chrome 153.0.8010.52",
		);
	});

	it('stays quiet when they agree, or when the name or the page names no browser', () => {
		expect(browserMismatch('tbpixel-chrome', chrome)).toBeUndefined();
		expect(browserMismatch('mac-google-chrome', chrome)).toBeUndefined();
		expect(browserMismatch('sm-s926b-brave', { name: 'Brave', version: null })).toBeUndefined();
		expect(browserMismatch('tb-android', chrome)).toBeUndefined();
		expect(browserMismatch('tb-safari', { name: 'unknown', version: null })).toBeUndefined();
	});

	it("puts the detected browser in the runner's summary line", () => {
		expect(summaryLine('tb-android', { pass: 3, skip: 1, fail: 0, browser: 'Chrome 153' })).toBe(
			'tb-android (Chrome 153): 3 passed, 1 skipped, 0 failed',
		);
	});
});

describe("the run's entry for the record of tested devices", () => {
	const cells = ({ facts, plans, result }: TestedDeviceEntry) => [...facts, plans, result];

	it('fills each fact from the device file, and the plans and result from the run', () => {
		const pixel: DeviceFacts = {
			userAgent: UA.androidChrome,
			userAgentData: hints(
				{ 'Google Chrome': '153.0.8010.52', Chromium: '153.0.8010.52' },
				{ model: 'Pixel 8', platform: 'Android', platformVersion: '17.0.0' },
			),
			brave: false,
			browser: { name: 'Chrome', version: '153.0.8010.52' },
			gpu: {
				webgpu: { vendor: 'arm', architecture: 'valhall', device: '', description: '' },
				compatibility: true,
				webgl2: { renderer: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)' },
			},
			hardwareConcurrency: 9,
			screen: { width: 412, height: 915 },
			devicePixelRatio: 2.625,
			origin: 'https://local.testingbot.com:3001',
		};
		const row = testedDeviceEntry({
			run: '20261003-004511-checks',
			launch: 'lan',
			device: pixel,
			pass: 202,
			skip: 0,
			fail: 338,
		});
		expect(cells(row)).toEqual([
			'Pixel 8, 412 x 915 at 2.625x, 9 cores',
			'Android 17',
			'Chrome 153.0.8010.52',
			'ANGLE (ARM, Mali-G715, OpenGL ES 3.2); WebGPU adapter: arm valhall',
			'WebGPU, compatibility mode, WebGL2',
			"TestingBot's device cloud",
			'checks 2026-10-03',
			'202 passed, 0 skipped, 338 failed',
		]);
	});

	it("leaves the OS empty where the user agent freezes it, and finds an iPad behind a Mac's user agent", () => {
		const iPad: DeviceFacts = {
			userAgent: UA.iPadSafari,
			brave: false,
			maxTouchPoints: 5,
			hardwareConcurrency: 8,
			screen: { width: 834, height: 1194 },
			devicePixelRatio: 2,
		};
		const row = cells(
			testedDeviceEntry({
				run: '20261002-125319-checks',
				launch: 'lan',
				device: iPad,
				pass: 490,
				skip: 0,
				fail: 0,
			}),
		);
		expect(row.slice(0, 3)).toEqual(['iPad, 834 x 1194 at 2x, 8 cores', '', 'Safari 26.6.2']);
		// An older run's device file has no GPU facts, so those cells stay empty too.
		expect(row.slice(3, 6)).toEqual(['', '', '']);
		const mac = cells(
			testedDeviceEntry({
				run: '20260930-154610-checks',
				launch: 'mac',
				device: { ...iPad, maxTouchPoints: 0, userAgent: UA.macFirefox },
				pass: 293,
				skip: 0,
				fail: 0,
			}),
		);
		expect([mac[0], mac[2], mac[5]]).toEqual([
			'Mac, 834 x 1194 at 2x, 8 cores',
			'Firefox 156.0',
			"the owner's Mac",
		]);
	});

	it('names a Windows PC, its Windows release, its GPU and BrowserStack', () => {
		const windows = (platformVersion: string): DeviceFacts => ({
			userAgent: UA.windowsEdge,
			userAgentData: hints(
				{ 'Microsoft Edge': '154.0.3510.41', Chromium: '154.0.7871.12' },
				{ model: '', platform: 'Windows', platformVersion },
			),
			gpu: {
				webgpu: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' },
				compatibility: true,
				webgl2: {
					renderer:
						'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)',
				},
			},
			hardwareConcurrency: 16,
			screen: { width: 1920, height: 1080 },
			devicePixelRatio: 1,
			origin: 'https://bs-local.com:3001',
		});
		const row = (device: DeviceFacts) =>
			cells(
				testedDeviceEntry({
					run: '20261004-090000-smoke',
					launch: 'lan',
					device,
					pass: 50,
					skip: 0,
					fail: 0,
				}),
			);
		expect(row(windows('19.0.0')).slice(0, 7)).toEqual([
			'Windows PC, 1920 x 1080 at 1x, 16 cores',
			'Windows 11',
			'Edge 154.0.3510.41',
			'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11); WebGPU adapter: nvidia ampere',
			'WebGPU, compatibility mode, WebGL2',
			'BrowserStack Live',
			'smoke 2026-10-04',
		]);
		expect(row(windows('10.0.0'))[1]).toBe('Windows 10');
		expect(row(windows('0.3.0'))[1]).toBe('Windows before 10');
		// Firefox gives no client hints, so the release stays for a person to fill in.
		const firefox = row({ ...windows(''), userAgent: UA.windowsFirefox, userAgentData: undefined });
		expect(firefox.slice(0, 3)).toEqual([
			'Windows PC, 1920 x 1080 at 1x, 16 cores',
			'',
			'Firefox 157.0',
		]);
	});

	it('marks a software renderer, which draws on the CPU because the machine has no GPU', () => {
		const row = testedDeviceEntry({
			run: '20261004-090000-smoke',
			launch: 'lan',
			device: {
				userAgent: UA.windowsChrome,
				gpu: {
					webgpu: null,
					compatibility: false,
					webgl2: { renderer: 'ANGLE (Microsoft, Microsoft Basic Render Driver, D3D11)' },
				},
			},
			pass: 0,
			skip: 0,
			fail: 50,
		});
		expect(cells(row)[3]).toBe(
			'ANGLE (Microsoft, Microsoft Basic Render Driver, D3D11) (a software renderer: no GPU)',
		);
	});

	it("names the owner's phone, and keeps the GPU's name as the browser gives it", () => {
		const { facts } = testedDeviceEntry({
			run: '20261003-002933-checks',
			launch: 'android',
			device: {
				userAgent: UA.androidChrome,
				gpu: { webgpu: null, compatibility: false, webgl2: { renderer: 'A | B' } },
			},
			pass: 1,
			skip: 0,
			fail: 0,
		});
		expect(facts[3]).toBe('A | B');
		expect(facts[5]).toBe("the owner's phone");
	});
});
