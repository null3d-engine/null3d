import { describe, expect, it } from 'bun:test';
import { probeDrawPath, skipDrawPathProbe } from './draw-path-probe';

const MAC_SAFARI =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15';
const IPHONE_CHROME =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1';
const MAC_CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const LINUX_CHROME =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

const info = (vendor: string, architecture = '', description = '') =>
	({ vendor, architecture, device: '', description }) as GPUAdapterInfo;

/** A device whose every call fails, and that counts the calls the probe made. */
function failingDevice(): { device: GPUDevice; calls: () => number } {
	let calls = 0;
	const device = new Proxy(
		{},
		{
			get: () => {
				calls++;
				throw new Error('the device is lost');
			},
		},
	) as GPUDevice;
	return { device, calls: () => calls };
}

describe('the draw path probe', () => {
	it('runs only on an Apple GPU in WebKit', () => {
		expect(skipDrawPathProbe(info('apple', 'apple'), MAC_SAFARI)).toBeUndefined();
		expect(skipDrawPathProbe(info('apple', 'apple'), IPHONE_CHROME)).toBeUndefined();
		expect(skipDrawPathProbe(info('apple', 'metal-3'), MAC_CHROME)).toBe('not-apple-gpu-in-webkit');
		expect(skipDrawPathProbe(info(''), MAC_SAFARI)).toBe('not-apple-gpu-in-webkit');
		expect(skipDrawPathProbe(info('google', 'swiftshader'), LINUX_CHROME)).toBe(
			'software-renderer',
		);
	});

	it('keeps the indirect path without touching the device where it does not run', async () => {
		const { device, calls } = failingDevice();
		expect(await probeDrawPath(device, info('apple', 'metal-3'), MAC_CHROME, false)).toEqual({
			directDraws: false,
			reason: 'not-apple-gpu-in-webkit',
		});
		expect(await probeDrawPath(device, info('google', 'swiftshader'), LINUX_CHROME, false)).toEqual(
			{ directDraws: false, reason: 'software-renderer' },
		);
		expect(calls()).toBe(0);
	});

	it('keeps the indirect path where the measurement fails', async () => {
		const { device, calls } = failingDevice();
		expect(await probeDrawPath(device, info('apple', 'apple'), MAC_SAFARI, true)).toEqual({
			directDraws: false,
			reason: 'probe-failed',
		});
		expect(calls()).toBeGreaterThan(0);
	});
});
