// The start check that refuses Apple's WebKit from before Safari 18, with user agents in the forms
// that the browsers send, and a start in such a browser, which must fail before it asks for
// memory, workers or files.
import { afterEach, describe, expect, it } from 'bun:test';
import { EngineError } from '../errors/engine-error';
import { webKitVersion } from '../shared/webkit';
import { checkBrowser } from './browser-check';
import { createEngine } from './engine';

const UA = {
	macSafari15:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15',
	macSafari17:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	macSafari18:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
	macSafari26:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15',
	iPhoneSafari17:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	iPhoneChrome17:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
	iPadFirefox17:
		'Mozilla/5.0 (iPad; CPU OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
	iPhoneSafari18:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
	iPhoneChrome18:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
	iPhoneSafari26:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
	iPhoneChrome26:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
	macFirefox:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
	windowsEdge:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.3510.41',
	windowsFirefox:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
	linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
	samsungInternet:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
	androidWebView:
		'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.0.0 Mobile Safari/537.36',
	androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
};

/** The user agents of the browsers that the check refuses. */
const REFUSED = new Set([
	'macSafari15',
	'macSafari17',
	'iPhoneSafari17',
	'iPhoneChrome17',
	'iPadFirefox17',
]);

const REFUSED_17 =
	'E1306: this browser runs the WebKit engine of Safari 17, and the engine needs Safari 18 or later.';

describe('the WebKit version in a user agent', () => {
	it("reads Safari's version on macOS, iPhone and iPad", () => {
		expect(webKitVersion(UA.macSafari17)).toBe(17);
		expect(webKitVersion(UA.macSafari18)).toBe(18);
		expect(webKitVersion(UA.macSafari26)).toBe(26);
		expect(webKitVersion(UA.iPhoneSafari17)).toBe(17);
		expect(webKitVersion(UA.iPhoneSafari26)).toBe(26);
	});

	it('reads the iOS or iPadOS version for other browsers on iPhone and iPad', () => {
		expect(webKitVersion(UA.iPhoneChrome17)).toBe(17);
		expect(webKitVersion(UA.iPadFirefox17)).toBe(17);
		expect(webKitVersion(UA.iPhoneChrome18)).toBe(18);
		expect(webKitVersion(UA.iPhoneChrome26)).toBe(18);
	});

	it("gives no version for Chromium's and Firefox's engines, even with a Version/ part", () => {
		for (const name of [
			'macChrome',
			'macFirefox',
			'windowsChrome',
			'windowsEdge',
			'windowsFirefox',
			'linuxFirefox',
			'androidChrome',
			'samsungInternet',
			'androidWebView',
			'androidFirefox',
		] as const)
			expect(webKitVersion(UA[name]), name).toBeUndefined();
		expect(webKitVersion('')).toBeUndefined();
	});
});

describe('the start check of the browser', () => {
	it('refuses Safari 17 on macOS, and every iOS 17 browser', () => {
		for (const userAgent of [
			UA.macSafari17,
			UA.iPhoneSafari17,
			UA.iPhoneChrome17,
			UA.iPadFirefox17,
		])
			expect(() => checkBrowser(userAgent)).toThrow(REFUSED_17);
	});

	it('refuses Safari before 16.4 for its missing SIMD first, then for its version', () => {
		const validate = WebAssembly.validate;
		try {
			WebAssembly.validate = () => false;
			expect(() => checkBrowser(UA.macSafari15)).toThrow(
				'E1303: this browser runs WebAssembly without SIMD.',
			);
		} finally {
			WebAssembly.validate = validate;
		}
		expect(() => checkBrowser(UA.macSafari15)).toThrow(
			'E1306: this browser runs the WebKit engine of Safari 15,',
		);
	});

	it('passes Safari 18 and 26, iOS 18 and 26, and every other engine', () => {
		for (const [name, userAgent] of Object.entries(UA))
			if (!REFUSED.has(name)) expect(() => checkBrowser(userAgent), name).not.toThrow();
		expect(() => checkBrowser('')).not.toThrow();
	});
});

describe('a start in Safari 17', () => {
	const real = {
		navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
		Worker: globalThis.Worker,
		Memory: WebAssembly.Memory,
		fetch: globalThis.fetch,
	};

	afterEach(() => {
		if (real.navigator) Object.defineProperty(globalThis, 'navigator', real.navigator);
		globalThis.Worker = real.Worker;
		WebAssembly.Memory = real.Memory;
		globalThis.fetch = real.fetch;
	});

	it('rejects with E1306 before it asks for memory, workers or files', async () => {
		const asked: string[] = [];
		Object.defineProperty(globalThis, 'navigator', {
			value: { userAgent: UA.iPhoneSafari17, hardwareConcurrency: 6 },
			configurable: true,
		});
		globalThis.Worker = class {
			constructor() {
				asked.push('worker');
			}
		} as unknown as typeof Worker;
		WebAssembly.Memory = class {
			constructor() {
				asked.push('memory');
			}
		} as unknown as typeof WebAssembly.Memory;
		globalThis.fetch = (async () => {
			asked.push('fetch');
			return new Response();
		}) as unknown as typeof fetch;
		const start = createEngine({
			canvas: {} as HTMLCanvasElement,
			sketch: 'https://example.com/sketch.js',
		});
		const error = await start.then(
			() => undefined,
			(reason: unknown) => reason,
		);
		expect(error).toBeInstanceOf(EngineError);
		expect((error as EngineError).message).toStartWith(REFUSED_17);
		expect(asked).toEqual([]);
	});
});
