import { describe, expect, it } from 'bun:test';
import { lockedVersion, memoryImportLimits, parseOptions, releaseTarget } from './build-wasm';

describe('parseOptions', () => {
	it('reads the size check, its base, the base build, the names build and the core build', () => {
		expect(parseOptions([])).toEqual({
			checkSize: false,
			sizesOnly: false,
			keepNames: false,
			coreOnly: false,
		});
		expect(parseOptions(['--check-size', '--base', 'origin/main'])).toEqual({
			checkSize: true,
			base: 'origin/main',
			sizesOnly: false,
			keepNames: false,
			coreOnly: false,
		});
		expect(parseOptions(['--sizes-only']).sizesOnly).toBe(true);
		expect(parseOptions(['--names']).keepNames).toBe(true);
		expect(parseOptions(['--core-only', '--names'])).toMatchObject({
			coreOnly: true,
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
			expect(() => parseOptions(['--core-only', other])).toThrow(
				'--core-only makes no size report',
			);
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

describe('memoryImportLimits', () => {
	const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
	// An import section with one function import, then a shared memory: env.f, env.memory (18, 65536).
	const importSection = [
		0x02, 0x1a, 0x02, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x00, 0x00, 0x03, 0x65, 0x6e, 0x76, 0x06,
		0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x03, 0x12, 0x80, 0x80, 0x04,
	];

	it('reads the initial size, the maximum and the shared flag of an imported memory', () => {
		const bytes = new Uint8Array([...header, ...importSection]);
		expect(memoryImportLimits(bytes)).toEqual({ initial: 18, maximum: 65536, shared: true });
	});

	it('returns null for a module without imports', () => {
		expect(memoryImportLimits(new Uint8Array(header))).toBeNull();
	});
});
