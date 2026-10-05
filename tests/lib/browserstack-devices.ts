// The devices that BrowserStack Automate runs the device runner on: tiers A and B of the device
// guide (.dev/devices.md), as BrowserStack's Automate list names them. Each entry is one runner,
// named bs<device>-<browser>. Where Automate lacks a device or a browser of the guide's table, the
// entry names the stand-in and says why.
//
// Automate's Windows machines have no GPU: their browsers draw with Microsoft's software renderer,
// which gives no WebGPU adapter. So the Windows runners may lack WebGPU, and their runs test the
// WebGL2 path in software and the clear failure of each WebGPU page. Firefox on them is left out:
// it gave no WebGL2 context either, so the smoke plan of 4 October 2026 passed only 2 of its 51
// pages there, and tested nothing that Chrome's run does not.

/** A tier of the device guide: A for each gate and release, B for each milestone. */
export type CloudTier = 'A' | 'B';

/** The browsers that BrowserStack Automate offers, by the names its capabilities take. */
export type CloudBrowser = 'chrome' | 'samsung' | 'edge' | 'firefox' | 'safari' | 'chromium';

/** A system as BrowserStack's list of Automate browsers names it. */
export type CloudOs = 'android' | 'ios' | 'Windows' | 'OS X';

export interface CloudDevice {
	/** The runner's name, `bs<device>-<browser>`, which the runner page and the results use. */
	runner: string;
	tier: CloudTier;
	/** BrowserStack's name of the phone or tablet; desktops have none. */
	device?: string;
	os: CloudOs;
	/** The system's version as BrowserStack names it, such as `15.0`, `26`, `11` or `Sequoia`. */
	osVersion: string;
	browser: CloudBrowser;
	/** A desktop browser's version: `latest`, or a version such as `18.4`. */
	browserVersion?: string;
	/** The device's browser has no core WebGPU, so its WebGPU pages skip instead of failing. */
	allowNoWebgpu?: true;
	/** Why this entry stands in for another device or browser of the guide's tier. */
	standIn?: string;
	/**
	 * The device's model number, as a phone's runners on the local network are named, such as
	 * `sm-s921b`. Image tests then compare with the references that the manifest keeps for it.
	 */
	model?: string;
}

/** The phones and tablets, whose sessions run on real devices. */
export const isMobile = (device: CloudDevice) => device.os === 'android' || device.os === 'ios';

export const CLOUD_DEVICES: readonly CloudDevice[] = [
	{
		runner: 'bsiphone17-safari',
		tier: 'A',
		device: 'iPhone 17',
		os: 'ios',
		osVersion: '26',
		browser: 'safari',
	},
	{
		runner: 'bsiphone18pro-safari',
		tier: 'A',
		device: 'iPhone 18 Pro',
		os: 'ios',
		osVersion: '27',
		browser: 'safari',
	},
	{
		runner: 'bsipadpro13-safari',
		tier: 'A',
		device: 'iPad Pro 13 2025',
		os: 'ios',
		osVersion: '26',
		browser: 'safari',
	},
	{
		runner: 'bsiphone16-safari',
		tier: 'A',
		device: 'iPhone 16',
		os: 'ios',
		osVersion: '18',
		browser: 'safari',
		allowNoWebgpu: true,
	},
	{
		runner: 'bsgalaxys25-chrome',
		tier: 'A',
		device: 'Samsung Galaxy S25',
		os: 'android',
		osVersion: '15.0',
		browser: 'chrome',
	},
	{
		runner: 'bsgalaxys25-samsung',
		tier: 'A',
		device: 'Samsung Galaxy S25',
		os: 'android',
		osVersion: '15.0',
		browser: 'samsung',
	},
	{
		runner: 'bspixel10-chrome',
		tier: 'A',
		device: 'Google Pixel 10',
		os: 'android',
		osVersion: '16.0',
		browser: 'chrome',
	},
	{
		runner: 'bspixel9-chrome',
		tier: 'A',
		device: 'Google Pixel 9',
		os: 'android',
		osVersion: '17.0',
		browser: 'chrome',
	},
	{
		runner: 'bsgalaxytaba9plus-chrome',
		tier: 'A',
		device: 'Samsung Galaxy Tab A9 Plus',
		os: 'android',
		osVersion: '14.0',
		browser: 'chrome',
		allowNoWebgpu: true,
		standIn:
			'Automate has no Redmi Note 12 4G; the Tab A9 Plus has an Adreno 619, of the same Adreno 6xx line with compatibility mode only, and little memory',
	},
	{
		runner: 'bswin11-chrome',
		tier: 'A',
		os: 'Windows',
		osVersion: '11',
		browser: 'chrome',
		browserVersion: 'latest',
		allowNoWebgpu: true,
	},
	{
		runner: 'bsipad10-safari',
		tier: 'B',
		device: 'iPad 10th',
		os: 'ios',
		osVersion: '27',
		browser: 'safari',
	},
	{
		runner: 'bsiphone13-safari',
		tier: 'B',
		device: 'iPhone 13',
		os: 'ios',
		osVersion: '17',
		browser: 'safari',
		allowNoWebgpu: true,
	},
	{
		runner: 'bsiphone17-chromium',
		tier: 'B',
		device: 'iPhone 17',
		os: 'ios',
		osVersion: '26',
		browser: 'chromium',
		standIn:
			'Automate has no Chrome on iOS; its Chromium on iOS draws with WebKit as Chrome does there',
	},
	{
		runner: 'bsgalaxys24-chrome',
		tier: 'B',
		device: 'Samsung Galaxy S24',
		os: 'android',
		osVersion: '16.0',
		browser: 'chrome',
		allowNoWebgpu: true,
		model: 'sm-s921b',
	},
	{
		runner: 'bsgalaxys25-edge',
		tier: 'B',
		device: 'Samsung Galaxy S25',
		os: 'android',
		osVersion: '15.0',
		browser: 'edge',
	},
	{
		runner: 'bsgalaxys25-firefox',
		tier: 'B',
		device: 'Samsung Galaxy S25',
		os: 'android',
		osVersion: '15.0',
		browser: 'firefox',
		allowNoWebgpu: true,
	},
	{
		runner: 'bsgalaxym32-chrome',
		tier: 'B',
		device: 'Samsung Galaxy M32',
		os: 'android',
		osVersion: '11.0',
		browser: 'chrome',
		allowNoWebgpu: true,
		standIn:
			'Automate has no Galaxy A16 5G; the M32 has a low-end Mali-G52 and 4 to 6 GB, on Android 11, so it runs WebGL2 only',
	},
	{
		runner: 'bsgalaxytabs11-chrome',
		tier: 'B',
		device: 'Samsung Galaxy Tab S11',
		os: 'android',
		osVersion: '16.0',
		browser: 'chrome',
	},
	{
		runner: 'bspixel11-chrome',
		tier: 'B',
		device: 'Google Pixel 11',
		os: 'android',
		osVersion: '17.0',
		browser: 'chrome',
		allowNoWebgpu: true,
	},
	{
		runner: 'bswin11-edge',
		tier: 'B',
		os: 'Windows',
		osVersion: '11',
		browser: 'edge',
		browserVersion: 'latest',
		allowNoWebgpu: true,
	},
	{
		runner: 'bsmacsequoia-safari',
		tier: 'B',
		os: 'OS X',
		osVersion: 'Sequoia',
		browser: 'safari',
		browserVersion: '18.4',
		allowNoWebgpu: true,
	},
];

/** The device list's entry for a runner, or undefined when the list has none. */
export const cloudDevice = (runner: string) =>
	CLOUD_DEVICES.find((device) => device.runner === runner);
