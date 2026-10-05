// What a run learned about each browser it ran in, for the record of tested devices: the browser
// the runner page found itself in, and a row of that record, ready to paste. The runner page and the
// runner tool both use this file, so it imports nothing from Node or the DOM.

import { GPU_PATH_NAMES, type GpuPath, skippedPathsText } from './gpu-paths.ts';

/** The browsers that the runner page tells apart. */
export type BrowserName =
	| 'Safari'
	| 'Chrome'
	| 'Chromium'
	| 'Brave'
	| 'Samsung Internet'
	| 'Firefox'
	| 'Edge';

/** The browser a page runs in, with its version where the browser gives it. */
export interface DetectedBrowser {
	name: BrowserName | 'unknown';
	version: string | null;
}

/** A brand and version, as user agent client hints give them. */
interface Brand {
	brand: string;
	version: string;
}

/** The user agent client hints that the runner page asks for, where the browser has them. */
export interface UserAgentData {
	fullVersionList?: readonly Brand[];
	brands?: readonly Brand[];
	model?: string;
	platform?: string;
	platformVersion?: string;
}

/** The facts about a browser that detection reads, as the runner page records them. */
export interface BrowserFacts {
	userAgent?: string;
	userAgentData?: UserAgentData | null;
	/** True when the page found Brave's own object on `navigator`. */
	brave?: boolean;
}

/**
 * Client hint brands and the browser each names. Chromium-based browsers list Chromium too, so a
 * brand of its own wins over it.
 */
const BRANDS: readonly (readonly [string, BrowserName])[] = [
	['Brave', 'Brave'],
	['Microsoft Edge', 'Edge'],
	['Samsung Internet', 'Samsung Internet'],
	['Google Chrome', 'Chrome'],
	['Chromium', 'Chromium'],
];

/**
 * User agent tokens and the browser each names, most specific first. Browsers on iOS add a token of
 * their own to WebKit's user agent, and Chromium-based browsers add one to Chrome's.
 */
const UA_TOKENS: readonly (readonly [RegExp, BrowserName])[] = [
	[/\bEdg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
	[/\bSamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
	[/\bFxiOS\/([\d.]+)/, 'Firefox'],
	[/\bFirefox\/([\d.]+)/, 'Firefox'],
	[/\bBrave\b/, 'Brave'],
	[/\bCriOS\/([\d.]+)/, 'Chrome'],
	[/\b(?:Headless)?Chrome\/([\d.]+)/, 'Chrome'],
	[/\bVersion\/([\d.]+)(?: Mobile\/\S+)? Safari\//, 'Safari'],
];

/**
 * Chromium-based browsers whose user agent token names them even where their client hints name
 * only Chromium, as some versions of Samsung Internet do.
 */
const CHROMIUM_FORKS: ReadonlySet<BrowserName> = new Set(['Edge', 'Samsung Internet']);

/** The browser that the user agent's most specific token names, if any. */
function userAgentBrowser(
	userAgent: string,
): (DetectedBrowser & { name: BrowserName }) | undefined {
	for (const [pattern, name] of UA_TOKENS) {
		const match = pattern.exec(userAgent);
		if (match) return { name, version: match[1] ?? null };
	}
	return undefined;
}

/**
 * The browser a page runs in, from Brave's object on `navigator`, the user agent client hints and
 * the user agent. Client hints give a full version where the user agent freezes it, as Chrome's
 * does. Brave gets no version without client hints: on iOS it adds only its name to WebKit's user
 * agent, so the version there is Safari's.
 */
export function detectBrowser({
	userAgent = '',
	userAgentData,
	brave,
}: BrowserFacts): DetectedBrowser {
	const hints = userAgentData?.fullVersionList ?? userAgentData?.brands ?? [];
	for (const [brand, name] of BRANDS) {
		const hint = hints.find((h) => h.brand === brand);
		if (!hint) continue;
		if (name !== 'Chromium') return { name, version: hint.version };
		if (brave === true) break;
		const fork = userAgentBrowser(userAgent);
		return fork && CHROMIUM_FORKS.has(fork.name) ? fork : { name, version: hint.version };
	}
	if (brave === true) return { name: 'Brave', version: null };
	return userAgentBrowser(userAgent) ?? { name: 'unknown', version: null };
}

/** A browser's name and version as one text, such as "Chrome 154.0.8037.57". */
export const browserText = ({ name, version }: DetectedBrowser) =>
	version ? `${name} ${version}` : name;

/** The words of a runner's name that name a browser, such as `chrome` in `sm-s926b-chrome`. */
const RUNNER_WORDS: Readonly<Record<string, readonly BrowserName[]>> = {
	safari: ['Safari'],
	chrome: ['Chrome', 'Chromium'],
	chromium: ['Chromium', 'Chrome'],
	brave: ['Brave'],
	samsung: ['Samsung Internet'],
	firefox: ['Firefox'],
	edge: ['Edge'],
};

/**
 * The browser that a runner's name says it runs, or undefined for a name that names none, such as
 * `bspixel10`, which suits a device whose browser the person chooses there.
 */
export function browserNamedBy(runner: string): readonly BrowserName[] | undefined {
	for (const word of runner.toLowerCase().split(/[^a-z0-9]+/)) {
		const names = RUNNER_WORDS[word];
		if (names) return names;
	}
	return undefined;
}

/**
 * A warning when a runner's name names one browser and its page ran in another, as when a cloud
 * device opens its default browser. Undefined when they agree, or when either is not known.
 */
export function browserMismatch(runner: string, detected: DetectedBrowser): string | undefined {
	const named = browserNamedBy(runner);
	if (!named || detected.name === 'unknown' || named.includes(detected.name)) return undefined;
	return `${runner}: the runner's name says ${named[0]}, but its page ran in ${browserText(detected)}`;
}

/** The GPU facts that the runner page reads before a run. */
export interface GpuFacts {
	/** The WebGPU adapter's details, or null without an adapter. */
	webgpu: { vendor: string; architecture: string; device: string; description: string } | null;
	/** Whether the browser gave an adapter for WebGPU's compatibility mode. */
	compatibility: boolean;
	/** The WebGL2 renderer, unmasked where the browser allows it, or null without WebGL2. */
	webgl2: { renderer: string } | null;
}

/** What the runner page recorded about its browser and device, in `device.json`. */
export interface DeviceFacts extends BrowserFacts {
	browser?: DetectedBrowser;
	gpu?: GpuFacts;
	hardwareConcurrency?: number;
	maxTouchPoints?: number;
	screen?: { width: number; height: number };
	devicePixelRatio?: number;
	/** The address the runner page loaded from, which names the cloud for a cloud device. */
	origin?: string;
}

/**
 * How the runner reached a browser: an app on this Mac, the phone over USB, the network, or a
 * session that it opened on a device cloud.
 */
export type LaunchKind = 'mac' | 'linux' | 'android' | 'lan' | 'cloud';

/** One runner's outcome in a run, with what the record's row needs besides the device. */
export interface RowInput {
	/** The run's name, which starts with its date and ends with its plan. */
	run: string;
	launch: LaunchKind;
	device: DeviceFacts;
	pass: number;
	skip: number;
	fail: number;
	/** The GPU paths that the device lacks, whose pages its runner page skipped. */
	skippedPaths?: readonly GpuPath[];
}

/** The record's columns, in order, as the header of its table gives them. */
export const RECORD_COLUMNS = [
	'Device',
	'OS',
	'Browser',
	'GPU',
	'GPU paths',
	'Where',
	'Plans',
	'Result',
	'Known issues',
] as const;

/** The device's kind and model, with its screen and cores, which help to tell models apart. */
export function deviceText({
	userAgent = '',
	userAgentData,
	maxTouchPoints,
	screen,
	devicePixelRatio,
	hardwareConcurrency,
}: DeviceFacts): string {
	let kind = userAgentData?.model ?? '';
	if (!kind) {
		if (/\biPhone\b/.test(userAgent)) kind = 'iPhone';
		else if (/\biPad\b/.test(userAgent)) kind = 'iPad';
		// Safari on an iPad gives a Mac's user agent; only the touch screen tells them apart.
		else if (/\bMacintosh\b/.test(userAgent)) kind = (maxTouchPoints ?? 0) > 1 ? 'iPad' : 'Mac';
		else if (/\bAndroid\b/.test(userAgent)) kind = 'Android device';
		else if (/\bWindows\b/.test(userAgent)) kind = 'Windows PC';
	}
	const details = [
		screen && devicePixelRatio ? `${screen.width} x ${screen.height} at ${devicePixelRatio}x` : '',
		hardwareConcurrency ? `${hardwareConcurrency} cores` : '',
	].filter(Boolean);
	return [kind, ...details].filter(Boolean).join(', ');
}

/**
 * The Windows release that a client hint's platform version names. Its first number is not the
 * release: 1 to 10 are versions of Windows 10, 13 and up are Windows 11, and 0 is an older release.
 */
function windowsText(platformVersion: string): string {
	const major = Number.parseInt(platformVersion, 10);
	if (Number.isNaN(major)) return 'Windows';
	if (major >= 13) return 'Windows 11';
	return major > 0 ? 'Windows 10' : 'Windows before 10';
}

/**
 * The OS and its version, from the client hints alone. User agents freeze the OS version: Safari 26
 * gives iOS 18.7 on iOS 26, Chrome gives Android 10 on every Android, and every browser gives
 * Windows 10 on Windows 11. So without client hints the cell stays empty, for a person to fill in.
 */
export function osText({ userAgentData }: DeviceFacts): string {
	const platform = userAgentData?.platform;
	if (!platform) return '';
	const platformVersion = userAgentData.platformVersion ?? '';
	if (platform === 'Windows') return windowsText(platformVersion);
	const version = platformVersion.replace(/(\.0)+$/, '');
	return version ? `${platform} ${version}` : platform;
}

/** GPU names that mark drawing on the CPU, as on a machine or a virtual machine without a GPU. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render driver/i;

/** The GPU as the browser names it: the WebGL2 renderer, and WebGPU's adapter details. */
function gpuText(gpu: GpuFacts | undefined): string {
	if (!gpu) return '';
	const adapter = gpu.webgpu
		? [gpu.webgpu.vendor, gpu.webgpu.architecture, gpu.webgpu.device]
				.filter((part, i, all) => part && all.indexOf(part) === i)
				.join(' ')
		: '';
	const text = [gpu.webgl2?.renderer ?? '', adapter ? `WebGPU adapter: ${adapter}` : '']
		.filter(Boolean)
		.join('; ');
	return SOFTWARE_RENDERER.test(text) ? `${text} (a software renderer: no GPU)` : text;
}

/** The GPU paths that the browser offers. */
function pathsText(gpu: GpuFacts | undefined): string {
	if (!gpu) return '';
	return [
		gpu.webgpu ? GPU_PATH_NAMES.webgpu : '',
		gpu.compatibility ? GPU_PATH_NAMES.compat : '',
		gpu.webgl2 ? GPU_PATH_NAMES.webgl2 : '',
	]
		.filter(Boolean)
		.join(', ');
}

/** Where the browser ran: the owner's Mac or phone, or a cloud that the page's address names. */
function whereText(launch: LaunchKind, origin: string | undefined): string {
	if (launch === 'cloud') return 'BrowserStack Automate';
	if (origin?.includes('bs-local.com')) return 'BrowserStack Live';
	if (origin?.includes('testingbot')) return "TestingBot's device cloud";
	if (launch === 'mac') return "the owner's Mac";
	if (launch === 'linux') return 'a Linux machine';
	if (launch === 'android') return "the owner's phone";
	return '';
}

/** A run's plan and date, from its name, such as `checks 2026-10-03`. */
function planText(run: string): string {
	const match = /^(\d{4})(\d{2})(\d{2})-\d{6}-(.+)$/.exec(run);
	return match ? `${match[4]} ${match[1]}-${match[2]}-${match[3]}` : run;
}

/** A table cell's text, with the pipes that would end the cell escaped. */
const cell = (text: string) => text.replaceAll('|', '\\|');

/**
 * One row of the record of tested devices, as a Markdown table row, from what the runner page
 * recorded and the run's counts. A fact that the browser does not give stays empty. The known
 * issues are for a person to fill in.
 */
export function testedDeviceRow({
	run,
	launch,
	device,
	pass,
	skip,
	fail,
	skippedPaths = [],
}: RowInput): string {
	const cells = [
		deviceText(device),
		osText(device),
		browserText(device.browser ?? detectBrowser(device)),
		gpuText(device.gpu),
		pathsText(device.gpu),
		whereText(launch, device.origin),
		planText(run),
		[
			`${pass} passed, ${skip} skipped, ${fail} failed`,
			...(skippedPaths.length > 0 ? [skippedPathsText(skippedPaths)] : []),
		].join('; '),
		'',
	];
	return `|${cells.map((text) => (text ? ` ${cell(text)} ` : ' ')).join('|')}|`;
}
