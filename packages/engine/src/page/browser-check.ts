// The checks that refuse a browser the engine cannot run in, before the start downloads or asks for
// anything. Each refusal names what the browser lacks, so a page can show its own message.

import { EngineError } from '../errors/engine-error';

/** The oldest version of Apple's WebKit, as Safari and iOS number it, that runs the engine. */
export const MIN_WEBKIT_VERSION = 18;

/** WebAssembly that uses a SIMD instruction; a browser without SIMD rejects it. */
const SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
	253, 98, 11,
]);

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

/**
 * The version of Apple's WebKit that a user agent gives, as Safari and iOS number it, or undefined
 * when the browser runs another engine or gives no version. It reads Safari's `Version/`, else the
 * iOS or iPadOS version, which browsers such as Chrome, Edge and Firefox on iPhone give in place of
 * it. A feature test could not take its place: no cheap test tells Safari 17 from Safari 18, and the
 * faults that end support for Safari 17 show only once the engine runs.
 */
export function webKitVersion(userAgent: string): number | undefined {
	const webKit = APPLE_WEBKIT.exec(userAgent);
	if (!webKit || Number(webKit[1]) < FIRST_APPLE_WEBKIT) return undefined;
	const version = SAFARI_VERSION.exec(userAgent) ?? IOS_VERSION.exec(userAgent);
	return version ? Number(version[1]) : undefined;
}

/**
 * Throws when the browser cannot run the engine: E1303 when its WebAssembly lacks SIMD, as in
 * Safari before 16.4, and E1306 when it runs Apple's WebKit from before Safari 18. A browser whose
 * user agent gives no WebKit version passes the second check.
 */
export function checkBrowser(userAgent = globalThis.navigator?.userAgent ?? ''): void {
	if (!WebAssembly.validate(SIMD_PROBE))
		throw new EngineError('E1303', 'this browser runs WebAssembly without SIMD.');
	const webKit = webKitVersion(userAgent);
	if (webKit !== undefined && webKit < MIN_WEBKIT_VERSION)
		throw new EngineError(
			'E1306',
			`this browser runs the WebKit engine of Safari ${webKit}, and the engine needs Safari ${MIN_WEBKIT_VERSION} or later.`,
		);
}
