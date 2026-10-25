import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	acquireLock,
	BACKGROUND_PRIORITY,
	CACHE_ROOT,
	cacheDir,
	cacheOff,
	cacheRoot,
	cargoEnv,
	cpuSeconds,
	HEAVY_SLOT_ENV,
	type HolderWatch,
	hashFiles,
	hashOf,
	holderVerdict,
	liveLockHolder,
	pageBuildPriorityProblem,
	processPriority,
	processTree,
	pruneCache,
	runByLine,
	runCargo,
	runCargoAsync,
	statTimes,
	TreeTime,
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

describe('liveLockHolder', () => {
	it('names a live holder, and nobody for a free lock or one whose holder has stopped', () => {
		withFolder((folder) => {
			const lock = join(folder, 'build.lock');
			expect(liveLockHolder(lock)).toBeUndefined();
			const release = acquireLock(lock);
			expect(liveLockHolder(lock)).toBe(process.pid);
			release();
			mkdirSync(lock);
			writeFileSync(join(lock, 'pid'), '999999999');
			expect(liveLockHolder(lock)).toBeUndefined();
		});
	});

	it('counts a recent lock that names no process as held, and an old one as left', () => {
		withFolder((folder) => {
			const lock = join(folder, 'build.lock');
			mkdirSync(lock);
			expect(liveLockHolder(lock)).toBe(0);
			const old = new Date(Date.now() - 5 * 60 * 1000);
			utimesSync(lock, old, old);
			expect(liveLockHolder(lock)).toBeUndefined();
		});
	});
});

describe("a waiter's watch on a lock's holder", () => {
	/** A watch that judges a holder within a second, for the tests. */
	const QUICK_WATCH: HolderWatch = {
		sampleMs: 50,
		reportMs: 60_000,
		progressSeconds: 30,
		stallMs: 500,
	};

	/** A lock at `lock` held by a child that sleeps, started by `command`, once that child runs. */
	const heldBySleeper = async (lock: string, command: string[]) => {
		const [program, ...args] = command;
		const child = spawn(program as string, args, { stdio: 'ignore' });
		await new Promise((resolve) => setTimeout(resolve, 300));
		mkdirSync(lock);
		writeFileSync(join(lock, 'pid'), String(child.pid));
		return child;
	};

	it("reads ps's processor time in both of its forms", () => {
		expect(cpuSeconds('0:37.90')).toBeCloseTo(37.9);
		expect(cpuSeconds('147:22.29')).toBeCloseTo(147 * 60 + 22.29);
		expect(cpuSeconds('02:03:04')).toBe(2 * 3600 + 3 * 60 + 4);
		expect(cpuSeconds('1-02:03:04')).toBe(86_400 + 2 * 3600 + 3 * 60 + 4);
	});

	it("reads a Linux process record's parent and processor time, whatever its name holds", () => {
		const stat =
			'4242 (vite (worker) 2) S 17 4242 4242 0 -1 4194560 5 0 0 0 250 125 7 3 20 0 1 0 9';
		expect(statTimes(stat, 100)).toEqual([17, 3.75]);
	});

	it('waits on a holder that progresses, ends one at background priority, and stops for any other', () => {
		expect(holderVerdict(499, BACKGROUND_PRIORITY, 500)).toBe('wait');
		expect(holderVerdict(500, BACKGROUND_PRIORITY, 500)).toBe('end');
		expect(holderVerdict(500, 31, 500)).toBe('stop');
		expect(holderVerdict(500, undefined, 500)).toBe('stop');
	});

	it('refuses a page build at background priority, and lets one at any higher priority take the lock', () => {
		expect(pageBuildPriorityProblem(BACKGROUND_PRIORITY)).toContain(
			'macOS background priority (4)',
		);
		expect(pageBuildPriorityProblem(5)).toBeUndefined();
		expect(pageBuildPriorityProblem(31)).toBeUndefined();
		expect(pageBuildPriorityProblem(undefined)).toBeUndefined();
	});

	it("counts this process's own processor time in its tree", () => {
		const tree = processTree(process.pid);
		expect(tree?.get(process.pid)).toBeGreaterThan(0);
		expect(processTree(999_999_999)).toBeUndefined();
	});

	it('keeps the time of a child that exits, or whose id a new process takes', () => {
		const time = new TreeTime();
		expect(
			time.add(
				new Map([
					[1, 5],
					[2, 3],
				]),
			),
		).toBe(8);
		// Process 2 exits: its 3 s stay counted.
		expect(time.add(new Map([[1, 6]]))).toBe(9);
		expect(
			time.add(
				new Map([
					[1, 6],
					[3, 1],
				]),
			),
		).toBe(10);
		// A new process takes id 1 and process 3 exits: what both had used stays counted.
		expect(time.add(new Map([[1, 2]]))).toBe(12);
	});

	it('waits for a holder that works through short children one after another', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
		const lock = join(folder, 'build.lock');
		// The holder is a shell that uses no processor time of its own. Each child burns half a second
		// of processor time, however slowly the machine gives it, and exits. With the old count, which
		// fell when a child exited, the holder showed no progress after its first child, and the
		// waiter stopped while the rest still ran.
		const burn =
			'for (;;) { const used = process.cpuUsage(); if (used.user + used.system > 500_000) break; }';
		const script = `mkdir '${lock}' && echo $$ > '${join(lock, 'pid')}' &&
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do '${process.execPath}' -e '${burn}'; done
rm -rf '${lock}'`;
		const holder = spawn('sh', ['-c', script], { stdio: 'ignore' });
		try {
			for (let i = 0; i < 100 && !existsSync(join(lock, 'pid')); i++)
				await new Promise((resolve) => setTimeout(resolve, 50));
			const release = acquireLock(lock, {
				watch: { sampleMs: 100, reportMs: 60_000, progressSeconds: 0.1, stallMs: 3_000 },
			});
			expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
			release();
		} finally {
			holder.kill();
			rmSync(folder, { recursive: true, force: true });
		}
	}, 120_000);

	it('stops waiting for a holder at normal priority that makes no progress, and leaves it running', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
		const lock = join(folder, 'build.lock');
		const holder = await heldBySleeper(lock, ['sleep', '30']);
		try {
			expect(() => acquireLock(lock, { watch: QUICK_WATCH })).toThrow(
				`stopped waiting for the lock at ${lock}: its holder, pid ${holder.pid}`,
			);
			expect(holder.exitCode).toBeNull();
			expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(holder.pid));
		} finally {
			holder.kill();
			rmSync(folder, { recursive: true, force: true });
		}
	});

	// A process at background priority that only sleeps needs no processor time, so this test holds
	// at any load, unlike the ones that wait for such a process to print.
	it.skipIf(process.platform !== 'darwin')(
		'ends a holder at background priority that makes no progress, and takes its lock',
		async () => {
			const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
			const lock = join(folder, 'build.lock');
			const holder = await heldBySleeper(lock, ['taskpolicy', '-b', 'sleep', '30']);
			const ended = new Promise((resolve) => holder.on('exit', resolve));
			try {
				expect(processPriority(holder.pid)).toBe(BACKGROUND_PRIORITY);
				const release = acquireLock(lock, { watch: QUICK_WATCH });
				expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
				release();
				await ended;
			} finally {
				holder.kill();
				rmSync(folder, { recursive: true, force: true });
			}
		},
	);
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

	it("marks its job's queue slot while it waits, and only for a lock that frees the slot", async () => {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-lock-'));
		const lock = join(folder, 'page-build.lock');
		const slot = join(folder, 'c1');
		mkdirSync(slot);
		const module = join(import.meta.dir, 'build-cache.ts');
		const release = acquireLock(lock);
		const waiter = (options: string) =>
			spawn(
				'bun',
				[
					'-e',
					`import { acquireLock } from ${JSON.stringify(module)}; const r = acquireLock(${JSON.stringify(lock)}, ${options}); console.log('acquired'); r();`,
				],
				{ stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, [HEAVY_SLOT_ENV]: slot } },
			);
		const plain = waiter('{}');
		const freeing = waiter('{ freesSlot: true }');
		let out = '';
		freeing.stdout.on('data', (chunk) => {
			out += chunk;
		});
		/** Waits up to 10 s for `done`, which a loaded machine may take seconds to reach. */
		const until = async (done: () => boolean) => {
			for (let k = 0; k < 100 && !done(); k++) await Bun.sleep(100);
		};
		try {
			await until(() => out.includes('waiting for the lock'));
			// Only the waiter whose lock frees the slot marks it, by its own id, and says so.
			expect(readdirSync(slot)).toEqual([`waiting-${freeing.pid}`]);
			expect(readFileSync(join(slot, `waiting-${freeing.pid}`), 'utf8')).toBe(`${lock}\n`);
			expect(out).toContain('counts as free while it waits');
			release();
			await until(() => out.includes('acquired'));
			// Each took the lock in turn, and the mark went once its waiter held the lock.
			expect(out).toContain('acquired');
			expect(readdirSync(slot)).toEqual([]);
		} finally {
			plain.kill();
			freeing.kill();
			rmSync(folder, { recursive: true, force: true });
		}
	});
});

describe('runCargo', () => {
	/**
	 * A folder holding a stub `cargo` first on the PATH, which writes its arguments, its folder and
	 * its target folder's environment to a file. A test then reads what the cargo runners gave the
	 * toolchain, without running it.
	 */
	async function withStubCargo(
		run: (checkout: string, read: () => string) => void | Promise<void>,
	): Promise<void> {
		const folder = mkdtempSync(join(tmpdir(), 'null3d-cache-'));
		const bin = join(folder, 'bin');
		mkdirSync(bin, { recursive: true });
		const said = join(folder, 'said');
		const cargo = join(bin, 'cargo');
		writeFileSync(
			cargo,
			`#!/bin/sh\nprintf '%s\\n' "$PWD" "$CARGO_TARGET_DIR" "$RUSTC_WRAPPER" "$@" > ${said}\n`,
		);
		chmodSync(cargo, 0o755);
		const checkout = join(folder, 'checkout');
		mkdirSync(checkout);
		const before = { path: process.env.PATH, target: process.env.CARGO_TARGET_DIR };
		process.env.PATH = `${bin}:${before.path ?? ''}`;
		delete process.env.CARGO_TARGET_DIR;
		try {
			await run(checkout, () => readFileSync(said, 'utf8'));
		} finally {
			process.env.PATH = before.path;
			delete process.env.CARGO_TARGET_DIR;
			rmSync(folder, { recursive: true, force: true });
		}
	}

	it('runs in the checkout, with its own target folder and the call\u2019s own arguments', () =>
		withStubCargo((checkout, read) => {
			const run = runCargo(checkout, ['build', '-p', 'null3d-core'], {
				env: { RUSTFLAGS: '-Cstrip=symbols' },
			});
			expect(run.error).toBeUndefined();
			expect(run.status).toBe(0);
			const [cwd, target, wrapper, ...args] = read().trim().split('\n');
			// `/var` is a link to `/private/var` on macOS, so the shell's own directory is compared.
			expect(cwd).toBe(realpathSync(checkout));
			// No `--target-dir`, so the checkout's own folder applies.
			expect(target).toBe(join(checkout, 'target'));
			// sccache is a wrapper only when it is installed, and an empty value turns it off.
			expect(!wrapper || existsSync(wrapper)).toBe(true);
			expect(args).toEqual(['build', '-p', 'null3d-core']);
		}));

	it('builds into the target folder that the call names', () =>
		withStubCargo((checkout, read) => {
			const target = join(checkout, 'target', 'wasm-plain');
			runCargo(checkout, ['build', '-p', 'null3d-core'], { targetDir: target });
			expect(read().trim().split('\n').slice(3)).toEqual([
				'build',
				'-p',
				'null3d-core',
				'--target-dir',
				target,
			]);
		}));

	it('gives the asynchronous form the same folder, target folder and arguments', () =>
		withStubCargo(async (checkout, read) => {
			const target = join(checkout, 'target', 'wasm-plain');
			const lines: string[] = [];
			const run = await runCargoAsync(checkout, ['build', '-p', 'null3d-core'], {
				targetDir: target,
				onLine: (line) => lines.push(line),
			});
			expect(run).toEqual({ status: 0 });
			expect(lines).toEqual([]);
			const [cwd, folder, , ...args] = read().trim().split('\n');
			expect(cwd).toBe(realpathSync(checkout));
			expect(folder).toBe(join(checkout, 'target'));
			expect(args).toEqual(['build', '-p', 'null3d-core', '--target-dir', target]);
		}));
});

describe('runByLine', () => {
	/** Runs a shell command and returns how it ended, with each line it wrote and that line's stream. */
	async function lines(script: string) {
		const said: [string, boolean][] = [];
		const run = await runByLine('sh', ['-c', script], {
			cwd: tmpdir(),
			onLine: (line, stderr) => said.push([line, stderr]),
		});
		return { run, said };
	}

	it('hands on each whole line of both outputs, with its stream and the exit status', async () => {
		const { run, said } = await lines('echo built; echo warned >&2; exit 3');
		expect(run).toEqual({ status: 3 });
		// The two outputs arrive through two pipes, so only each one's own order is certain.
		expect(said.sort()).toEqual([
			['built', false],
			['warned', true],
		]);
	});

	it('joins a line that arrives in parts, and hands on a last line that has no newline', async () => {
		const { said } = await lines("printf 'com'; sleep 0.2; printf 'piled\\nlast'");
		expect(said).toEqual([
			['compiled', false],
			['last', false],
		]);
	});

	it('ends with the error of a command that cannot start, and never rejects', async () => {
		const run = await runByLine(join(tmpdir(), 'null3d-no-such-command'), [], {
			cwd: tmpdir(),
			onLine: () => {},
		});
		expect(run.status).toBeNull();
		expect(run.error).toBeInstanceOf(Error);
	});
});
