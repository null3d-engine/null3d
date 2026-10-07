// The checks that refuse a browser the engine cannot run in, before the start downloads or asks for
// anything. Each refusal names what the browser lacks, so a page can show its own message.

import { EngineError } from '../errors/engine-error';
import { webKitVersion } from '../shared/webkit';

/** The oldest version of Apple's WebKit, as Safari and iOS number it, that runs the engine. */
export const MIN_WEBKIT_VERSION = 18;

/** WebAssembly that uses a SIMD instruction; a browser without SIMD rejects it. */
const SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
	253, 98, 11,
]);

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
