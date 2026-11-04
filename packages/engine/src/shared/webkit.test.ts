import { describe, expect, it } from 'bun:test';
import { type AdapterNames, appleGpu, appleGpuInWebKit, isAppleWebKit } from './webkit';

/** User agents of the browsers that the detection must tell apart. */
const UA = {
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15',
	iPhoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
	iPhoneChrome:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
	iPadFirefox:
		'Mozilla/5.0 (iPad; CPU OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
	macFirefox:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
	linuxChrome:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};

const names = (vendor: string, architecture = '', description = ''): AdapterNames => ({
	vendor,
	architecture,
	description,
});

/** The adapter names that each browser reports, as the tested devices record them. */
const ADAPTER = {
	/** Safari on the Mac, iPhone and iPad names the vendor and the architecture `apple`. */
	webKit: names('apple', 'apple'),
	/** Chrome on an Apple silicon Mac. */
	macChrome: names('apple', 'metal-3'),
	/** Firefox hides the adapter's names. */
	hidden: names(''),
	adreno: names('qualcomm', 'adreno-8xx'),
	swiftShader: names('google', 'swiftshader', 'SwiftShader Device (Subzero)'),
};

describe('an Apple GPU in WebKit', () => {
	it('is Safari on the Mac, and every browser on iPhone and iPad, on an Apple GPU', () => {
		for (const userAgent of [UA.macSafari, UA.iPhoneSafari, UA.iPhoneChrome, UA.iPadFirefox])
			expect(appleGpuInWebKit(ADAPTER.webKit, userAgent), userAgent).toBe(true);
	});

	it('is not Chrome on the Mac, which reports the same Apple GPU', () => {
		expect(appleGpu(ADAPTER.macChrome)).toBe(true);
		expect(appleGpuInWebKit(ADAPTER.macChrome, UA.macChrome)).toBe(false);
	});

	it('is not Firefox, Android, Linux or a software renderer', () => {
		expect(appleGpuInWebKit(ADAPTER.hidden, UA.macFirefox)).toBe(false);
		expect(appleGpuInWebKit(ADAPTER.webKit, UA.macFirefox)).toBe(false);
		expect(appleGpuInWebKit(ADAPTER.adreno, UA.androidChrome)).toBe(false);
		expect(appleGpuInWebKit(ADAPTER.swiftShader, UA.linuxChrome)).toBe(false);
	});

	it('needs both signals: WebKit with hidden or other names is no Apple GPU', () => {
		expect(appleGpuInWebKit(ADAPTER.hidden, UA.macSafari)).toBe(false);
		expect(appleGpuInWebKit(ADAPTER.adreno, UA.iPhoneSafari)).toBe(false);
		expect(appleGpuInWebKit(ADAPTER.webKit, '')).toBe(false);
	});

	it('reads the GPU from any of the names, as whole words', () => {
		expect(appleGpu(names('', '', 'Apple M5 Max'))).toBe(true);
		expect(appleGpu(names('', 'apple-m1'))).toBe(true);
		expect(appleGpu(names('pineapple'))).toBe(false);
		expect(appleGpu(names('nvidia', 'blackwell'))).toBe(false);
	});

	it("reads WebKit only from Apple's own frozen engine number", () => {
		expect(isAppleWebKit(UA.macSafari)).toBe(true);
		for (const userAgent of [UA.macChrome, UA.androidChrome, UA.macFirefox, ''])
			expect(isAppleWebKit(userAgent), userAgent).toBe(false);
	});
});
