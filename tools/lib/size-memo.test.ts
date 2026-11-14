import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	FULL_SIZE_PARTS,
	keepSizeMemo,
	mergeSizeMemoParts,
	readSizeMemo,
	sizeMemoPartFile,
	sizePartsFor,
	writeSizeMemo,
} from './size-memo';
import { type SizeEntry, sizePartFile } from './size-report';

const folder = () => mkdtempSync(join(tmpdir(), 'size-memo-'));
const size = (raw: number): SizeEntry => ({ raw, gzip: raw / 2, brotli: raw / 4 });
const entries = (sizes: Record<string, SizeEntry>, compressed = 1) => ({
	met: new Map(Object.entries(sizes)),
	compressed,
});

describe('the size memo file', () => {
	afterEach(() => {
		delete process.env.NULL3D_NO_CACHE;
	});

	it('reads back the entries that it wrote', () => {
		const path = join(folder(), 'sizes.json');
		writeSizeMemo(path, entries({ a: size(8), b: size(16) }));
		expect(Object.fromEntries(readSizeMemo(path).known)).toEqual({ a: size(8), b: size(16) });
	});

	it("reads as empty when it is missing, broken, or another runtime's compressors made it", () => {
		const dir = folder();
		expect(readSizeMemo(join(dir, 'none.json')).known.size).toBe(0);
		writeFileSync(join(dir, 'broken.json'), '{');
		expect(readSizeMemo(join(dir, 'broken.json')).known.size).toBe(0);
		writeFileSync(
			join(dir, 'other.json'),
			JSON.stringify({ stamp: 'another zlib', compressed: 1, sizes: { a: size(8) } }),
		);
		expect(readSizeMemo(join(dir, 'other.json')).known.size).toBe(0);
	});

	it('is kept only when the measuring compressed a file, and never while the caches are off', () => {
		const path = join(folder(), 'sizes.json');
		expect(keepSizeMemo(entries({ a: size(8) }, 0), null, path)).toBe(false);
		expect(existsSync(path)).toBe(false);
		process.env.NULL3D_NO_CACHE = '1';
		expect(keepSizeMemo(entries({ a: size(8) }), null, path)).toBe(false);
		expect(existsSync(path)).toBe(false);
		writeSizeMemo(path, entries({ a: size(8) }));
		expect(readSizeMemo(path).known.size).toBe(0);
		delete process.env.NULL3D_NO_CACHE;
		expect(keepSizeMemo(entries({ a: size(8) }), null, path)).toBe(true);
		expect(readSizeMemo(path).known.size).toBe(1);
	});

	it('is kept when the measuring met other shader modules than the memo names, though it compressed nothing', () => {
		const path = join(folder(), 'sizes.json');
		writeSizeMemo(path, entries({ a: size(8) }), 'set-1');
		expect(keepSizeMemo(entries({ a: size(8) }, 0), 'set-1', path)).toBe(false);
		expect(keepSizeMemo(entries({ a: size(8) }, 0), 'set-2', path)).toBe(true);
		expect(sizePartsFor('set-2', path)).toEqual([1]);
	});

	it('needs one size part for the shader modules that the memo names, and the full split otherwise', () => {
		const path = join(folder(), 'sizes.json');
		const full = Array.from({ length: FULL_SIZE_PARTS }, (_, i) => i + 1);
		expect(sizePartsFor('set-1', path)).toEqual(full);
		writeSizeMemo(path, entries({ a: size(8) }), 'set-1');
		expect(sizePartsFor('set-1', path)).toEqual([1]);
		expect(sizePartsFor('set-2', path)).toEqual(full);
		expect(sizePartsFor(null, path)).toEqual(full);
		// A memo that other compressors made holds no size for this runtime.
		writeFileSync(
			path,
			JSON.stringify({ stamp: 'another zlib', compressed: 0, sizes: {}, modules: 'set-1' }),
		);
		expect(sizePartsFor('set-1', path)).toEqual(full);
	});

	it("merges every part's entries, and leaves out the parts' size files and another stamp's", () => {
		const dir = folder();
		writeSizeMemo(join(dir, sizeMemoPartFile({ index: 1, count: 2 })), entries({ a: size(8) }, 0));
		writeSizeMemo(join(dir, sizeMemoPartFile({ index: 2, count: 2 })), entries({ b: size(16) }, 3));
		writeFileSync(join(dir, sizePartFile({ index: 1, count: 2 })), '{"sizes": {}}');
		writeFileSync(
			join(dir, 'memo-part-3-of-3.json'),
			JSON.stringify({ stamp: 'another zlib', compressed: 5, sizes: { c: size(32) } }),
		);
		const merged = mergeSizeMemoParts(dir);
		expect(Object.fromEntries(merged.met)).toEqual({ a: size(8), b: size(16) });
		expect(merged.compressed).toBe(3);
		expect(mergeSizeMemoParts(join(dir, 'none')).met.size).toBe(0);
	});
});
