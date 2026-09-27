import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../real-browsers.ts';
import { checksPlan, judge } from './plans.ts';
import { batchTimeoutMs, runName, turnBatches } from './runs.ts';

describe('turnBatches', () => {
	it('lets one browser per device run at a time, in the order given', () => {
		const runners = [
			{ name: 'mac-safari', device: 'mac' },
			{ name: 'mac-brave-browser', device: 'mac' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'sm-s926b-chrome-beta', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
		];
		expect(turnBatches(runners)).toEqual([
			['mac-safari', 'sm-s926b-chrome', 'ipad-safari'],
			['mac-brave-browser', 'sm-s926b-chrome-beta'],
		]);
	});
});

describe('runName', () => {
	it('sorts by time and is safe as a folder name', () => {
		expect(runName('checks', new Date('2026-09-27T10:15:30.123Z'))).toBe('20260927-101530-checks');
	});
});

describe('the checks plan', () => {
	const items = checksPlan();

	it('has unique item names and pages on the test pages path', () => {
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		for (const item of items) expect(item.path.startsWith('/tests/pages/')).toBe(true);
		expect(items.map((item) => item.id)).toContain('engine-webgl2-single-threaded');
		expect(batchTimeoutMs({ run: 'r', createdAt: '', items })).toBeGreaterThan(
			items.length * 30_000,
		);
	});

	it('skips a WebGPU page on a browser without WebGPU only when allowed', () => {
		const webgpu = items.find((item) => item.id === 'clear-webgpu');
		const webgl2 = items.find((item) => item.id === 'clear-webgl2');
		if (!webgpu || !webgl2) throw new Error('the plan lacks the clear pages');
		const missing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgpu in this browser.',
		};
		expect(judge(webgpu.check, missing, true)).toBe('skip');
		expect(judge(webgpu.check, missing, false)).toEqual([missing.error]);
		expect(judge(webgl2.check, { ok: false, error: 'no WebGPU adapter' }, true)).toEqual([
			'no WebGPU adapter',
		]);
	});

	it('judges isolation from the page result', () => {
		const isolation = items.find((item) => item.id === 'isolation');
		if (!isolation) throw new Error('the plan lacks the isolation page');
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: true, threaded: true }, false),
		).toEqual([]);
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: false, threaded: false }, false),
		).toEqual(['the page is not cross-origin isolated', 'the threaded build did not load']);
	});
});

describe('parseArgs', () => {
	it('reads the plan, the flags, the device lists and the macOS apps', () => {
		expect(
			parseArgs([
				'--allow-no-webgpu',
				'--android',
				'chrome,brave',
				'--lan',
				'ipad-safari',
				'Safari',
			]),
		).toEqual({
			plan: 'checks',
			allowNoWebGPU: true,
			mac: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
		});
		expect(() => parseArgs(['--plan', 'nothing'])).toThrow('no plan named nothing');
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});
});
