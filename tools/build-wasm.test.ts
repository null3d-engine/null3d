import { describe, expect, it } from 'bun:test';
import {
	addReleaseInstance,
	checkHeapStart,
	lockedVersion,
	parseOptions,
	releaseTarget,
} from './build-wasm';

describe('parseOptions', () => {
	it('reads the size check, its base, the base build, the names build, the pages build, an earlier build and the base alone', () => {
		expect(parseOptions([])).toEqual({
			checkSize: false,
			sizesOnly: false,
			keepNames: false,
			pagesOnly: false,
			prebuilt: false,
			printBase: false,
		});
		expect(parseOptions(['--check-size', '--base', 'origin/main'])).toEqual({
			checkSize: true,
			base: 'origin/main',
			sizesOnly: false,
			keepNames: false,
			pagesOnly: false,
			prebuilt: false,
			printBase: false,
		});
		expect(parseOptions(['--check-size', '--prebuilt'])).toMatchObject({
			checkSize: true,
			prebuilt: true,
		});
		expect(parseOptions(['--print-base', '--base', 'HEAD^'])).toMatchObject({
			printBase: true,
			base: 'HEAD^',
		});
		expect(parseOptions(['--sizes-only']).sizesOnly).toBe(true);
		expect(parseOptions(['--names']).keepNames).toBe(true);
		expect(parseOptions(['--pages-only', '--names'])).toMatchObject({
			pagesOnly: true,
			keepNames: true,
		});
	});

	it('rejects unknown options, a base without a commit or a check, and builds that exclude each other', () => {
		expect(() => parseOptions(['--update-size'])).toThrow('unknown option --update-size');
		expect(() => parseOptions(['--check-size', '--base'])).toThrow('--base needs a commit');
		expect(() => parseOptions(['--base', 'main'])).toThrow('--base names the commit');
		expect(() => parseOptions(['--check-size', '--names'])).toThrow('cannot measure sizes');
		expect(() => parseOptions(['--sizes-only', '--names'])).toThrow('cannot measure sizes');
		expect(() => parseOptions(['--check-size', '--sizes-only'])).toThrow(
			'cannot also run the check',
		);
		for (const other of ['--check-size', '--sizes-only'])
			expect(() => parseOptions(['--pages-only', other])).toThrow(
				'--pages-only makes no size report',
			);
		for (const other of ['--names', '--pages-only', '--sizes-only'])
			expect(() => parseOptions(['--prebuilt', other])).toThrow(
				'--prebuilt measures the files of an earlier build',
			);
		for (const other of ['--check-size', '--prebuilt', '--sizes-only'])
			expect(() => parseOptions(['--print-base', other])).toThrow('--print-base builds nothing');
	});
});

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

describe('addReleaseInstance', () => {
	const glue = [
		'let cachedFloat64ArrayMemory0 = null;',
		'let cachedTextDecoder = new TextDecoder();',
		'let cachedUint8ArrayMemory0 = null;',
		'let wasmModule, wasmInstance, wasm;',
		'function initSync(module, memory) {',
		'    if (wasm !== undefined) return wasm;',
		'}',
		'',
	].join('\n');

	it('adds a function that drops the instance and every view of its memory', () => {
		const released = addReleaseInstance(glue);
		expect(released.startsWith(glue)).toBe(true);
		expect(released.slice(glue.length)).toBe(
			[
				'',
				'export function releaseInstance() {',
				'    wasmModule = wasmInstance = wasm = undefined;',
				'    cachedFloat64ArrayMemory0 = null;',
				'    cachedUint8ArrayMemory0 = null;',
				'}',
				'',
			].join('\n'),
		);
	});

	it('fails on glue that holds its instance in another way', () => {
		expect(() => addReleaseInstance(glue.replace('wasmInstance, ', ''))).toThrow(
			'update addReleaseInstance',
		);
	});
});

describe('checkHeapStart', () => {
	/** A module's first bytes up to an import section with a shared memory of `initial` pages. */
	const withMemory = (initial: number) => {
		const entry = [1, 0x61, 1, 0x6d, 2, 3, initial, 0x80, 0x80, 0x04];
		return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 2, entry.length + 1, 1, ...entry]);
	};

	it('passes when wasm-bindgen added one page', () => {
		expect(() => checkHeapStart(withMemory(17), withMemory(18))).not.toThrow();
	});

	it('fails on any other count, which would move the heap onto its pages', () => {
		expect(() => checkHeapStart(withMemory(17), withMemory(17))).toThrow('BINDGEN_PAGES');
		expect(() => checkHeapStart(withMemory(17), withMemory(19))).toThrow('19 pages');
	});
});
