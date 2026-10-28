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
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyInPlace, linkInPlace, partialName, replaceFolder } from './atomic-files.ts';

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

describe('linkInPlace', () => {
	it('links a file in one step, and leaves a path that names the same file as it is', () => {
		const source = join(dir, 'shaders.ts');
		writeFileSync(source, 'export {};\n');
		const path = join(dir, 'generated/shaders.ts');
		for (let i = 0; i < 3; i++) linkInPlace(source, path);
		expect(statSync(path).ino).toBe(statSync(source).ino);
		expect(readdirSync(join(dir, 'generated'))).toEqual(['shaders.ts']);
	});

	it('links over a temporary name that an earlier run left, and leaves none behind', () => {
		const source = join(dir, 'shaders.ts');
		writeFileSync(source, 'export {};\n');
		const path = join(dir, 'shaders-linked.ts');
		writeFileSync(partialName(path), 'left over\n');
		linkInPlace(source, path);
		expect(statSync(path).ino).toBe(statSync(source).ino);
		expect(existsSync(partialName(path))).toBe(false);
	});

	it('leaves no link to the source under the temporary name when the rename fails', () => {
		const source = join(dir, 'shaders.ts');
		writeFileSync(source, 'export {};\n');
		// A folder in the path's place makes the rename fail after the link has been made.
		const path = join(dir, 'taken');
		mkdirSync(join(path, 'inside'), { recursive: true });
		expect(() => linkInPlace(source, path)).toThrow();
		expect(existsSync(partialName(path))).toBe(false);
		expect(readFileSync(source, 'utf8')).toBe('export {};\n');
	});

	it('replaces a file of other bytes with the link', () => {
		const source = join(dir, 'shaders.ts');
		writeFileSync(source, 'export const NEW = 1;\n');
		const path = join(dir, 'shaders-copy.ts');
		writeFileSync(path, 'export const OLD = 1;\n');
		linkInPlace(source, path);
		expect(readFileSync(path, 'utf8')).toBe('export const NEW = 1;\n');
		expect(statSync(path).ino).toBe(statSync(source).ino);
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
