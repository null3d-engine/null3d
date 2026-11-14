import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesBelow } from './walk';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'null3d-walk-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Writes a file at a path from the root, with its folders. */
function file(path: string): void {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), path);
}

describe('filesBelow', () => {
	test('lists every file below the folder, nested ones included', () => {
		file('a.ts');
		file('one/b.wgsl');
		file('one/two/c.ts');
		expect(filesBelow(root).sort()).toEqual([
			'a.ts',
			join('one', 'b.wgsl'),
			join('one', 'two', 'c.ts'),
		]);
	});

	test('ends on two packages whose node_modules link to each other', () => {
		// The workspace packages link to each other this way, and the cycle of links stopped a
		// recursive readdir with ELOOP on Linux.
		file('examples/sketch.ts');
		file('packages/plants/src/index.ts');
		file('packages/textures/index.js');
		mkdirSync(join(root, 'packages/plants/node_modules/@scope'), { recursive: true });
		mkdirSync(join(root, 'packages/textures/node_modules/@scope'), { recursive: true });
		mkdirSync(join(root, 'examples/node_modules/@scope'), { recursive: true });
		symlinkSync(
			join(root, 'packages/textures'),
			join(root, 'packages/plants/node_modules/@scope/textures'),
		);
		symlinkSync(
			join(root, 'packages/plants'),
			join(root, 'packages/textures/node_modules/@scope/plants'),
		);
		symlinkSync(join(root, 'packages/plants'), join(root, 'examples/node_modules/@scope/plants'));
		expect(filesBelow(join(root, 'examples'))).toEqual(['sketch.ts']);
		expect(filesBelow(root).sort()).toEqual([
			join('examples', 'sketch.ts'),
			join('packages', 'plants', 'src', 'index.ts'),
			join('packages', 'textures', 'index.js'),
		]);
	});

	test('follows no symbolic link outside node_modules either, to a folder or a file', () => {
		file('real/a.ts');
		symlinkSync(join(root, 'real'), join(root, 'linked'));
		symlinkSync(join(root, 'real/a.ts'), join(root, 'b.ts'));
		symlinkSync(root, join(root, 'real/up'));
		expect(filesBelow(root)).toEqual([join('real', 'a.ts')]);
	});

	test('leaves out the folders it is told to skip, at any depth', () => {
		file('src/a.ts');
		file('src/generated/big.ts');
		file('generated/top.ts');
		expect(filesBelow(root, ['generated'])).toEqual([join('src', 'a.ts')]);
	});

	test('gives no files for a folder that does not exist', () => {
		expect(filesBelow(join(root, 'missing'))).toEqual([]);
	});
});
