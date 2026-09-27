import { describe, expect, it } from 'bun:test';
import { growthProblems, lockedVersion, measure, releaseTarget } from './build-wasm';

describe('lockedVersion', () => {
	it('reads a package version from Cargo.lock', () => {
		const lock =
			'[[package]]\nname = "once_cell"\nversion = "1.21.4"\n\n[[package]]\nname = "wasm-bindgen"\nversion = "0.2.129"\n';
		expect(lockedVersion(lock, 'wasm-bindgen')).toBe('0.2.129');
		expect(() => lockedVersion(lock, 'missing')).toThrow('missing is not in Cargo.lock');
	});
});

describe('releaseTarget', () => {
	it('names the prebuilt wasm-bindgen download for each supported machine', () => {
		expect(releaseTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
		expect(releaseTarget('darwin', 'x64')).toBe('x86_64-apple-darwin');
		expect(releaseTarget('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
		expect(() => releaseTarget('win32', 'x64')).toThrow('no prebuilt wasm-bindgen');
	});
});

describe('size checks', () => {
	it('measures raw and Brotli sizes', () => {
		const size = measure(Buffer.alloc(10_000, 7));
		expect(size.raw).toBe(10_000);
		expect(size.brotli).toBeLessThan(100);
	});

	it('fails growth above 2% after Brotli, and ignores files with no baseline', () => {
		const baseline = { 'a.wasm': { raw: 1000, brotli: 1000 } };
		expect(growthProblems({ 'a.wasm': { raw: 1000, brotli: 1020 } }, baseline)).toEqual([]);
		expect(growthProblems({ 'a.wasm': { raw: 1000, brotli: 1021 } }, baseline)[0]).toContain(
			'grew 2.1%',
		);
		expect(growthProblems({ 'b.wasm': { raw: 1, brotli: 5000 } }, baseline)).toEqual([]);
	});
});
