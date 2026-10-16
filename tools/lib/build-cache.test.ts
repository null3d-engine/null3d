import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	acquireLock,
	CACHE_ROOT,
	cacheDir,
	cacheOff,
	cacheRoot,
	cargoEnv,
	hashFiles,
	hashOf,
	pruneCache,
	touchCacheEntry,
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
		expect(cacheDir('wasm-artifacts')).not.toContain('shader-cache');
		expect(cacheDir('shader-cache', '/tmp/elsewhere')).toBe('/tmp/elsewhere');
		expect(cacheDir('shader-cache', 'local')).toBe(join(process.cwd(), 'target', 'shader-cache'));
	});
});

describe('cacheRoot', () => {
	it('takes NULL3D_BUILD_CACHE, else null3d under XDG_CACHE_HOME, else under the home folder', () => {
		expect(cacheRoot({ NULL3D_BUILD_CACHE: '/elsewhere' })).toBe('/elsewhere');
		expect(cacheRoot({ XDG_CACHE_HOME: '/xdg' })).toBe(join('/xdg', 'null3d'));
		expect(cacheRoot({ HOME: '/home/someone' })).toBe(join('/home/someone', '.cache', 'null3d'));
		// The named variable wins over the base folder, so a test or a job can move one cache alone.
		expect(cacheRoot({ NULL3D_BUILD_CACHE: '/elsewhere', XDG_CACHE_HOME: '/xdg' })).toBe(
			'/elsewhere',
		);
	});
});

describe('cargoEnv', () => {
	it('names the checkout’s own Rust build folder, and sccache when it is installed', () => {
		withFolder((folder) => {
			const bin = join(folder, 'bin');
			mkdirSync(bin);
			const sccache = join(bin, 'sccache');
			writeFileSync(sccache, '#!/bin/sh\n');
			chmodSync(sccache, 0o755);
			const PATH = `${join(folder, 'empty')}:${bin}`;
			// Every cargo run of a checkout gets that checkout's target folder: Cargo judges a
			// workspace crate fresh by file times, so a shared folder links one checkout's crates into
			// another's build.
			expect(cargoEnv('/work/one', { PATH })).toEqual({
				CARGO_TARGET_DIR: join('/work/one', 'target'),
				RUSTC_WRAPPER: sccache,
				SCCACHE_DIR: join(CACHE_ROOT, 'sccache'),
			});
			expect(cargoEnv('/work/one', { PATH, SCCACHE_DIR: '/elsewhere' }).SCCACHE_DIR).toBe(
				'/elsewhere',
			);
			// A wrapper the caller names, or an empty one that turns wrapping off, is kept as it is.
			expect(cargoEnv('/work/two', { PATH, RUSTC_WRAPPER: '' })).toEqual({
				CARGO_TARGET_DIR: join('/work/two', 'target'),
			});
			// Without sccache, cargo runs as it would alone, as in CI.
			expect(cargoEnv('/work/one', { PATH: join(folder, 'empty') })).toEqual({
				CARGO_TARGET_DIR: join('/work/one', 'target'),
			});
		});
	});
});

describe('pruneCache', () => {
	/** An entry of the given size, used `usedMs` ago. */
	function entry(folder: string, name: string, bytes: number, usedMs: number): string {
		const path = join(folder, name);
		mkdirSync(path, { recursive: true });
		writeFileSync(join(path, 'blob'), Buffer.alloc(bytes, 1));
		const when = new Date(usedMs);
		utimesSync(join(path, 'blob'), when, when);
		utimesSync(path, when, when);
		return path;
	}

	it('removes the least recently used entries while the cache holds more than its limit', () => {
		withFolder((folder) => {
			const old = Date.now() - 24 * 60 * 60 * 1000;
			const kept = entry(folder, 'new', 600, Date.now());
			const gone = entry(folder, 'old', 600, old);
			const removed = pruneCache(folder, 1024);
			expect(removed).toEqual(['old']);
			expect(existsSync(kept)).toBe(true);
			expect(existsSync(gone)).toBe(false);
		});
	});

	it('keeps an entry a build is still reading, and a lock that sits in the folder', () => {
		withFolder((folder) => {
			// A build of another checkout may be copying this entry right now, so it stays even while
			// the cache is over its limit: removing it costs that build its work.
			const inUse = entry(folder, 'in-use', 600, Date.now() - 60 * 1000);
			mkdirSync(join(folder, 'builder.lock'));
			expect(pruneCache(folder, 1)).toEqual([]);
			expect(existsSync(inUse)).toBe(true);
			expect(existsSync(join(folder, 'builder.lock'))).toBe(true);
		});
	});

	it('counts an entry as used again when a build touches it', () => {
		withFolder((folder) => {
			const old = Date.now() - 24 * 60 * 60 * 1000;
			const entry_ = entry(folder, 'reused', 600, old);
			touchCacheEntry(entry_);
			entry(folder, 'other', 600, old);
			// The touched entry is the newer one now, so the other goes first.
			expect(pruneCache(folder, 1024)).toEqual(['other']);
		});
	});
});

describe('acquireLock', () => {
	it('takes a free lock, releases it, and takes over a lock whose holder has stopped', () => {
		withFolder((folder) => {
			const lock = join(folder, 'build.lock');
			const release = acquireLock(lock);
			// The lock is a folder that names its holder, so exactly one process creates it.
			expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
			release();
			expect(existsSync(lock)).toBe(false);
			// A lock whose holder has stopped is broken rather than waited on.
			mkdirSync(lock);
			writeFileSync(join(lock, 'pid'), '999999999');
			const release2 = acquireLock(lock);
			expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
			release2();
		});
	});

	it('breaks a lock that names no process and is older than a minute', () => {
		withFolder((folder) => {
			const lock = join(folder, 'build.lock');
			mkdirSync(lock);
			const old = new Date(Date.now() - 5 * 60 * 1000);
			utimesSync(lock, old, old);
			const release = acquireLock(lock);
			expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
			release();
		});
	});

	it('waits for a lock that names no id and was taken a moment ago', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
		const lock = join(folder, 'build.lock');
		// A lock taken a moment ago by a process that has not written its id yet is live: breaking it
		// would let this process and that one work at the same time, which is what the old lock did
		// when it read an empty file as "nobody holds this".
		mkdirSync(lock);
		const module = join(import.meta.dir, 'build-cache.ts');
		const child = spawn(
			'bun',
			[
				'-e',
				`import { acquireLock } from ${JSON.stringify(module)}; acquireLock(${JSON.stringify(lock)}); console.log('acquired');`,
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		);
		let out = '';
		child.stdout.on('data', (chunk) => {
			out += chunk;
		});
		try {
			await Bun.sleep(700);
			expect(out).not.toContain('acquired');
			expect(existsSync(lock)).toBe(true);
		} finally {
			child.kill();
			rmSync(folder, { recursive: true, force: true });
		}
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
