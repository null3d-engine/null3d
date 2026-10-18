import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyInPlace, partialName, replaceFolder } from './atomic-files.ts';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'null3d-atomic-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('copyInPlace', () => {
	it('replaces a file in one step, so a reader of the old file still reads it whole', () => {
		const path = join(dir, 'core.wasm');
		const old = 'old core '.repeat(10_000);
		writeFileSync(path, old);
		// A reader that opened the old file before the build, as a dev server serving it does.
		const reader = openSync(path, 'r');
		const source = join(dir, 'new.wasm');
		writeFileSync(source, 'new');
		try {
			copyInPlace(source, path);
			expect(readFileSync(reader, 'utf8')).toBe(old);
		} finally {
			closeSync(reader);
		}
		expect(readFileSync(path, 'utf8')).toBe('new');
		expect(existsSync(partialName(path))).toBe(false);
	});

	it('makes the folders that the file needs', () => {
		const source = join(dir, 'a.wasm');
		writeFileSync(source, 'a');
		copyInPlace(source, join(dir, 'dist/tools/a.wasm'));
		expect(readFileSync(join(dir, 'dist/tools/a.wasm'), 'utf8')).toBe('a');
	});
});

describe('replaceFolder', () => {
	it('puts every staged file in place, removes files the build no longer makes, and the staged folder', () => {
		const staged = join(dir, 'staged');
		const out = join(dir, 'out');
		mkdirSync(join(staged, 'snippets'), { recursive: true });
		writeFileSync(join(staged, 'null3d.js'), 'glue');
		writeFileSync(join(staged, 'null3d_bg.wasm'), 'core');
		writeFileSync(join(staged, 'snippets/helper.js'), 'helper');
		mkdirSync(out);
		writeFileSync(join(out, 'null3d.js'), 'old glue');
		writeFileSync(join(out, 'stale.js'), 'stale');
		// A file that another build has not put in place yet.
		writeFileSync(join(out, 'null3d.js.1.partial'), 'another build');
		replaceFolder(staged, out);
		expect(readFileSync(join(out, 'null3d.js'), 'utf8')).toBe('glue');
		expect(readFileSync(join(out, 'null3d_bg.wasm'), 'utf8')).toBe('core');
		expect(readFileSync(join(out, 'snippets/helper.js'), 'utf8')).toBe('helper');
		expect(existsSync(join(out, 'stale.js'))).toBe(false);
		expect(existsSync(join(out, 'null3d.js.1.partial'))).toBe(true);
		expect(existsSync(staged)).toBe(false);
		expect(readdirSync(out).some((file) => file.includes(`.${process.pid}.partial`))).toBe(false);
	});

	it('makes the folder on a first build', () => {
		const staged = join(dir, 'staged');
		mkdirSync(staged);
		writeFileSync(join(staged, 'null3d.js'), 'glue');
		replaceFolder(staged, join(dir, 'dist/wasm/single'));
		expect(readFileSync(join(dir, 'dist/wasm/single/null3d.js'), 'utf8')).toBe('glue');
	});
});
