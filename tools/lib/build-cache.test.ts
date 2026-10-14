import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	acquireLock,
	cacheDir,
	cacheOff,
	hashFiles,
	hashOf,
	writeFileAtomic,
	writeFolderAtomic,
} from './build-cache';

/** A temporary folder, removed after the test. */
function withFolder(run: (folder: string) => void): void {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-cache-'));
	try {
		run(folder);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
}

describe('hashOf', () => {
	it('is stable and changes with any input', () => {
		expect(hashOf('a')).toBe(hashOf('a'));
		expect(hashOf('a')).not.toBe(hashOf('b'));
		expect(hashOf('a', 'b')).not.toBe(hashOf('ab'));
	});
});

describe('hashFiles', () => {
	it('changes with a file\u2019s path and contents', () => {
		withFolder((root) => {
			writeFileSync(join(root, 'a'), 'one');
			const before = hashFiles(root, ['a']);
			expect(hashFiles(root, ['a'])).toBe(before);
			writeFileSync(join(root, 'a'), 'two');
			expect(hashFiles(root, ['a'])).not.toBe(before);
		});
	});
});

describe('writeFileAtomic', () => {
	it('leaves the file whole, with no partial file beside it', () => {
		withFolder((folder) => {
			const file = join(folder, 'record.json');
			writeFileAtomic(file, '{"a":1}\n');
			expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n');
			expect(readdirSync(folder)).toEqual(['record.json']);
		});
	});
});

describe('writeFolderAtomic', () => {
	it('writes the whole folder and removes the staging folder', () => {
		withFolder((folder) => {
			const entry = join(folder, 'entry');
			const ok = writeFolderAtomic(entry, (staging) => {
				writeFileSync(join(staging, 'wasm'), 'bytes');
				writeFileSync(join(staging, 'glue'), 'text');
			});
			expect(ok).toBe(true);
			expect(readdirSync(entry).sort()).toEqual(['glue', 'wasm']);
			expect(readdirSync(folder)).toEqual(['entry']);
		});
	});

	it('returns false and leaves no entry when the fill fails', () => {
		withFolder((folder) => {
			const entry = join(folder, 'entry');
			const ok = writeFolderAtomic(entry, () => {
				throw new Error('no space left');
			});
			expect(ok).toBe(false);
			expect(existsSync(entry)).toBe(false);
		});
	});
});

describe('cacheOff', () => {
	it('reads the canonical variable and each older alias', () => {
		const names = ['NULL3D_NO_CACHE', 'NULL3D_NO_BUILD_CACHE', 'NULL3D_NO_SHADER_CACHE'];
		const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
		try {
			for (const name of names) delete process.env[name];
			expect(cacheOff()).toBe(false);
			for (const name of names) {
				process.env[name] = '1';
				expect(cacheOff()).toBe(true);
				delete process.env[name];
			}
		} finally {
			for (const name of names) {
				if (before[name] === undefined) delete process.env[name];
				else process.env[name] = before[name];
			}
		}
	});
});

describe('cacheDir', () => {
	it('names a named folder under the root, or the override, or the checkout for local', () => {
		expect(cacheDir('wasm-artifacts')).toContain('wasm-artifacts');
		expect(cacheDir('wasm-artifacts')).not.toContain('cargo-target');
		expect(cacheDir('cargo-target', '/tmp/elsewhere')).toBe('/tmp/elsewhere');
		expect(cacheDir('cargo-target', 'local')).toBe(join(process.cwd(), 'target', 'cargo-target'));
	});
});

describe('acquireLock', () => {
	it('takes a free lock, releases it, and takes over a lock whose holder has stopped', () => {
		withFolder((folder) => {
			const lock = join(folder, 'build.lock');
			const release = acquireLock(lock);
			expect(existsSync(lock)).toBe(true);
			expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
			release();
			expect(existsSync(lock)).toBe(false);
			// A lock written by a process that has stopped is taken over rather than waited on.
			writeFileSync(lock, '999999999');
			const release2 = acquireLock(lock);
			expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
			release2();
		});
	});

	it('makes a second process wait until the first releases it', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
		const lock = join(folder, 'build.lock');
		const module = join(import.meta.dir, 'build-cache.ts');
		const release = acquireLock(lock);
		const child = spawn(
			'bun',
			[
				'-e',
				`import { acquireLock } from ${JSON.stringify(module)}; const r = acquireLock(${JSON.stringify(lock)}); console.log('acquired'); r();`,
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		);
		let out = '';
		child.stdout.on('data', (chunk) => {
			out += chunk;
		});
		try {
			await Bun.sleep(700);
			// It says which process holds the lock while it waits, rather than sitting silent: a
			// build that waits can look hung, and one did for 13 minutes on 14 October.
			expect(out).toContain(`held by pid ${process.pid}`);
			release();
			await Bun.sleep(700);
			expect(out).toContain('acquired');
		} finally {
			child.kill();
			rmSync(folder, { recursive: true, force: true });
		}
	});
});
