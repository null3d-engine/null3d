import { describe, expect, it } from 'bun:test';
import { missingWordsOf, parseVerifyArgs, verifyUrl } from './shader-verify.js';

describe('parseVerifyArgs', () => {
	it('checks every page on both GPU paths by default', () => {
		const options = parseVerifyArgs([]);
		expect([options.live, options.tiers]).toEqual([['/'], ['webgpu', 'webgl2']]);
		expect([options.settleMs, options.maxMs, options.timeoutMs, options.scrollDwell]).toEqual([
			5_000, 60_000, 120_000, 0,
		]);
	});

	it('takes pages, a path, steps and times of its own', () => {
		const options = parseVerifyArgs([
			'--live',
			'/start',
			'--live',
			'/game',
			'--gpu',
			'webgl2',
			'--steps',
			'./steps.mjs',
			'--click',
			'#play',
			'--scroll',
			'--scroll-dwell',
			'250',
			'--settle-ms',
			'1000',
			'--max-ms',
			'5000',
			'--timeout-ms',
			'9000',
		]);
		expect(options.live).toEqual(['/start', '/game']);
		expect(options.tiers).toEqual(['webgl2']);
		expect(options.steps).toBe('./steps.mjs');
		expect(options.click).toBe('#play');
		expect([options.scroll, options.scrollDwell, options.settleMs, options.maxMs]).toEqual([
			true,
			250,
			1000,
			5000,
		]);
		expect(options.timeoutMs).toBe(9000);
	});

	it('refuses a full address as a page, a base that is no address, and an unknown path', () => {
		expect(() => parseVerifyArgs(['--live', 'https://example.com/'])).toThrow(
			/path from the server's root/,
		);
		expect(() => parseVerifyArgs(['--base', 'localhost:5173'])).toThrow(/--base takes an address/);
		expect(() => parseVerifyArgs(['--gpu', 'metal'])).toThrow(/webgpu or webgl2/);
		expect(() => parseVerifyArgs(['--gpu', ','])).toThrow(/names no GPU path/);
	});

	it('refuses a time that is not a number of milliseconds', () => {
		expect(() => parseVerifyArgs(['--settle-ms', 'soon'])).toThrow(/--settle-ms/);
		expect(() => parseVerifyArgs(['--max-ms', '0'])).toThrow(/--max-ms/);
		expect(() => parseVerifyArgs(['--scroll-dwell', '-1'])).toThrow(/--scroll-dwell/);
	});
});

describe('missingWordsOf', () => {
	it('reads the published mesh words and a full-screen pass error', () => {
		const words = missingWordsOf(
			[0x124],
			[
				"null3D: the shader set holds only the permutation words of the project's shader list, and this pipeline asks for 0x00080124, which the list lacks.",
				'some other page error',
			],
		);
		expect(words).toEqual([
			{ pipeline: 'an object pipeline', word: 0x124 },
			{
				pipeline:
					"null3D: the shader set holds only the permutation words of the project's shader list, and this pipeline asks for 0x00080124, which the list lacks",
				word: -1,
			},
		]);
	});

	it('gives nothing for a page that lacked no word', () => {
		expect(missingWordsOf([], ['a script failed'])).toEqual([]);
	});
});

describe('verifyUrl', () => {
	it('opens the page with its GPU path, and publishes the engine for the check', () => {
		const url = verifyUrl('https://localhost:5173', '/?view=city', 'webgl2');
		expect(url).toBe('https://localhost:5173/?view=city&gpu=webgl2&bench=');
	});
});
