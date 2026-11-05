// Apple's WebKit, the engine of Safari and of every browser on iPhone and iPad, and its version,
// as user agents give them. The start check refuses old versions, the WebGPU backend works around a
// fault of some versions, and the draw path probe runs only on an Apple GPU in WebKit (hard rule
// 14). The module imports nothing, so worker code can use it.

/**
 * Apple's WebKit names itself AppleWebKit/605.1.15, a number it froze years ago. Chromium's Blink
 * names itself AppleWebKit/537.36, also frozen, and Gecko names no AppleWebKit at all. A number of
 * 600 or more therefore marks Apple's WebKit, the engine of Safari and of every browser on iPhone
 * and iPad.
 */
const APPLE_WEBKIT = /\bAppleWebKit\/(\d+)/;
const FIRST_APPLE_WEBKIT = 600;
/** Safari's own version, which Safari and most browsers built on its engine give. */
const SAFARI_VERSION = /\bVersion\/(\d+)/;
/**
 * The iOS or iPadOS version, which on those systems is the version of the WebKit that every
 * browser runs. Since iOS 26, browsers give a version 18 here on newer systems, which still passes.
 */
const IOS_VERSION = /\bOS (\d+)_\d+(?:_\d+)? like Mac OS X\b/;

/** Whether a user agent names Apple's WebKit, the engine of Safari and of every browser on iPhone and iPad. */
export function isAppleWebKit(userAgent: string): boolean {
	const webKit = APPLE_WEBKIT.exec(userAgent);
	return webKit !== null && Number(webKit[1]) >= FIRST_APPLE_WEBKIT;
}

/**
 * The version of Apple's WebKit that a user agent gives, as Safari and iOS number it, or undefined
 * when the browser runs another engine or gives no version. It reads Safari's `Version/`, else the
 * iOS or iPadOS version, which browsers such as Chrome, Edge and Firefox on iPhone give in place of
 * it. A feature test could not take its place: no cheap test tells Safari 17 from Safari 18, and the
 * faults that end support for Safari 17 show only once the engine runs.
 */
export function webKitVersion(userAgent: string): number | undefined {
	if (!isAppleWebKit(userAgent)) return undefined;
	const version = SAFARI_VERSION.exec(userAgent) ?? IOS_VERSION.exec(userAgent);
	return version ? Number(version[1]) : undefined;
}

/** A word of a WebGPU adapter's reported names that marks an Apple GPU. */
const APPLE_GPU = /\bapple\b/i;

/**
 * The names that a WebGPU adapter reports, as `GPUAdapterInfo` gives them. A browser may leave any
 * of them empty, as Firefox does.
 */
export interface AdapterNames {
	vendor: string;
	architecture: string;
	description: string;
}

/**
 * Whether a WebGPU adapter's reported names mark an Apple GPU. Safari reports the vendor and the
 * architecture as `apple` on the Mac, the iPhone and the iPad, and Chrome on the Mac reports the
 * vendor `apple`. A browser that hides the names, as Firefox does, reports no Apple GPU.
 */
export function appleGpu(names: AdapterNames): boolean {
	return (
		APPLE_GPU.test(names.vendor) ||
		APPLE_GPU.test(names.architecture) ||
		APPLE_GPU.test(names.description)
	);
}

/**
 * Whether the device is an Apple GPU in Apple's WebKit: Safari on the Mac, or any browser on iPhone
 * and iPad. WebKit's validation of each indexed indirect draw costs a fixed time there, which the
 * direct draw path removes (D-174). The GPU comes from the adapter's names. The browser engine comes
 * from the user agent, the one signal that tells WebKit from Chrome on the same Mac, since both
 * report the same adapter and no feature tells them apart.
 */
export function appleGpuInWebKit(names: AdapterNames, userAgent: string): boolean {
	return appleGpu(names) && isAppleWebKit(userAgent);
}
