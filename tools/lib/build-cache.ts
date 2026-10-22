// One root, and one set of mechanics, for the build caches under `tools/`. Each cache keeps its own
// key and layout; they share the root, the hashing, the atomic writes, the lock, the least recently
// used pruning and the escape hatch. The caches sit outside git, as D-105's rule requires, so
// clearing the root is always safe: every entry is a pure function of its inputs, and a missing
// entry only costs the build time.
//
// The canonical root variable is `NULL3D_BUILD_CACHE`, defaulting to `null3d` under
// `XDG_CACHE_HOME`, or `~/.cache/null3d` when that is unset, with one named subfolder per cache. The
// older per-cache variables (`NULL3D_SHADER_CACHE`, `NULL3D_WASM_ARTIFACTS`) still name one cache's
// own folder. The canonical escape hatch is `NULL3D_NO_CACHE=1`; `NULL3D_NO_BUILD_CACHE=1` and
// `NULL3D_NO_SHADER_CACHE=1` still work.
//
// The Rust build folder is not a cache under the root: each checkout keeps its own, because Cargo
// judges the engine's crates fresh by file times, and sccache, when installed, shares the compiled
// dependency crates instead (see cargoEnv). Every cargo run of the repository goes through
// `runCargo`, so that rule holds at each of them.
import { type StdioOptions, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	accessSync,
	constants,
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/**
 * The one root of every build cache on this machine: `NULL3D_BUILD_CACHE` when set, else
 * `null3d` under `XDG_CACHE_HOME`, else `~/.cache/null3d`. One value for every cache keeps a test or
 * a job able to move them all at once.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
	const base = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache');
	return env.NULL3D_BUILD_CACHE ?? join(base, 'null3d');
}

/** The root of the build caches of this process. */
export const CACHE_ROOT = cacheRoot();

/** The escape hatches that turn every cache off, canonical first and the older per-cache aliases. */
const NO_CACHE = ['NULL3D_NO_CACHE', 'NULL3D_NO_BUILD_CACHE', 'NULL3D_NO_SHADER_CACHE'];

/**
 * The folder of the named cache under the root, which it reads from the environment on each call,
 * so a caller that moves the root, such as a test, moves every cache with it. `override`, an older
 * per-cache variable, names the whole folder instead; the value `local` keeps it inside the
 * checkout, under `target/<name>`.
 */
export function cacheDir(name: string, override?: string): string {
	if (override === 'local') return join(process.cwd(), 'target', name);
	return override ?? join(cacheRoot(), name);
}

/** The path of the named program in the folders of `path`, or null when none holds it. */
export function onPath(name: string, path = ''): string | null {
	for (const folder of path.split(delimiter)) {
		if (!folder) continue;
		const file = join(folder, name);
		try {
			accessSync(file, constants.X_OK);
			return file;
		} catch {
			// Not in this folder; look in the next.
		}
	}
	return null;
}

/**
 * The environment of a cargo run in `checkout`: the checkout's own Rust build folder, and sccache as
 * the compiler wrapper when it is installed and the caller names no wrapper, with its cache under the
 * root. Every cargo run of a checkout goes through this, so none of them writes another checkout's
 * build folder: Cargo judges a workspace crate fresh by comparing file times with the build's record,
 * and two checkouts hold the same crates at the same relative paths, so a shared folder links one
 * checkout's crates into another's build. sccache keys each compile by the contents of its sources,
 * flags and dependencies, so the dependency crates compile once for every checkout. Without sccache,
 * cargo runs as it would alone; an empty `RUSTC_WRAPPER` turns sccache off.
 */
export function cargoEnv(
	checkout: string,
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const vars: Record<string, string> = { CARGO_TARGET_DIR: join(checkout, 'target') };
	if (env.RUSTC_WRAPPER !== undefined) return vars;
	const sccache = onPath('sccache', env.PATH);
	if (sccache) {
		vars.RUSTC_WRAPPER = sccache;
		vars.SCCACHE_DIR = env.SCCACHE_DIR ?? cacheDir('sccache');
	}
	return vars;
}

/** True when the environment asks every cache to be ignored, so each build runs again. */
export function cacheOff(): boolean {
	return NO_CACHE.some((name) => process.env[name] === '1');
}

/** How a cargo run ended: its status, or the error that kept it from starting. */
export interface CargoRun {
	status: number | null;
	error?: Error;
}

/**
 * Runs cargo with `args` in `checkout`, through one helper so that every cargo call of the
 * repository sets its build folder the same way: `targetDir`, when given, names the folder of this
 * call, and cargoEnv's own folder applies without it. `env` adds what one call needs, such as a
 * build's flags, and `stdio` picks where its output goes. The caller reports its own failure.
 */
export function runCargo(
	checkout: string,
	args: readonly string[],
	options: { env?: Record<string, string>; targetDir?: string; stdio?: StdioOptions } = {},
): CargoRun {
	const { env = {}, targetDir, stdio = 'inherit' } = options;
	const full = targetDir ? [...args, '--target-dir', targetDir] : [...args];
	const result = spawnSync('cargo', full, {
		cwd: checkout,
		stdio,
		env: { ...process.env, ...cargoEnv(checkout), ...env },
	});
	return { status: result.status, error: result.error ?? undefined };
}

/** A SHA-256 of the given values, in order, for a cache key. */
export function hashOf(...inputs: readonly (string | Buffer)[]): string {
	const hash = createHash('sha256');
	for (const input of inputs) {
		hash.update(input);
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** A SHA-256 of each named file's path and contents, in order, for a cache key. */
export function hashFiles(root: string, files: readonly string[]): string {
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(`${file}\0`);
		hash.update(readFileSync(join(root, file)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** Writes data to path in one step, so a reader sees the whole old file or the whole new one. */
export function writeFileAtomic(path: string, data: string | Buffer): void {
	mkdirSync(dirname(path), { recursive: true });
	const partial = `${path}.${process.pid}.partial`;
	writeFileSync(partial, data);
	renameSync(partial, path);
}

/**
 * Fills a staging folder beside `folder` with `fill`, then renames it into place, so a reader never
 * sees part of an entry. A write that fails leaves the old entry and returns false; the caller then
 * keeps the files it already put in place. The name may become any part of the state, which the
 * caller writes with `writeFileAtomic`.
 */
export function writeFolderAtomic(folder: string, fill: (staging: string) => void): boolean {
	const staging = `${folder}.${process.pid}.partial`;
	try {
		rmSync(staging, { recursive: true, force: true });
		mkdirSync(staging, { recursive: true });
		fill(staging);
		mkdirSync(dirname(folder), { recursive: true });
		rmSync(folder, { recursive: true, force: true });
		renameSync(staging, folder);
		return true;
	} catch {
		try {
			rmSync(staging, { recursive: true, force: true });
		} catch {
			// The staging path may not be removable; cleaning up is best effort.
		}
		return false;
	}
}

/** The file names of a folder that `keep` accepts, in order, or none when it does not exist. */
export function filesIn(folder: string, keep: (name: string) => boolean): string[] {
	try {
		return readdirSync(folder)
			.filter((name) => keep(name) && statSync(join(folder, name)).isFile())
			.sort();
	} catch {
		return [];
	}
}

/** How often a process that waits for a lock checks it, in milliseconds. */
const LOCK_POLL_MS = 200;

/** A lock that names no process this long after it was taken was left by one that stopped. */
const UNNAMED_LOCK_MS = 60_000;

function sleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** The process that holds the lock at `path`, or 0 when it names none. */
function lockHolder(path: string): number {
	try {
		return Number.parseInt(readFileSync(join(path, 'pid'), 'utf8'), 10) || 0;
	} catch {
		return 0;
	}
}

/**
 * Removes the lock at `path` after renaming it aside. The rename is the decisive step: of two
 * processes that find the same stale lock, exactly one renames it, so neither can remove a lock that
 * another process took in the meantime. Cargo's own lock and this one are safe to remove by name; the
 * rename is what makes a takeover safe.
 */
function breakLock(path: string): void {
	const aside = `${path}.stale-${process.pid}`;
	try {
		renameSync(path, aside);
	} catch {
		// Another process broke the lock first; it is gone, so the loop tries again.
		return;
	}
	rmSync(aside, { recursive: true, force: true });
}

/**
 * Takes the lock at `path` and returns the function that releases it. The lock is a folder that holds
 * the holder's process id, so exactly one process creates it: `mkdir` either creates the folder or
 * fails, never both. A process that finds the lock waits for its holder, and breaks a lock whose
 * holder has stopped, or one that names no process and is older than a minute: the rename in
 * breakLock makes two breakers safe. The shader build, the build and the size checks all take this
 * lock, each in a path of its own.
 */
export function acquireLock(path: string): () => void {
	mkdirSync(dirname(path), { recursive: true });
	const started = performance.now();
	let said = false;
	for (;;) {
		try {
			mkdirSync(path);
			writeFileSync(join(path, 'pid'), String(process.pid));
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
		}
		const takenMs = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
		// The lock went away between the two calls, so this process is next in line.
		if (takenMs === undefined) continue;
		const holder = lockHolder(path);
		const stopped = holder > 0 ? !isRunning(holder) : Date.now() - takenMs > UNNAMED_LOCK_MS;
		if (stopped) {
			breakLock(path);
			continue;
		}
		if (!said) {
			// A size check holds its lock across a whole base build, so a wait here can last many
			// minutes. Say who holds it: without this a build that waits prints nothing and looks
			// hung. When the holder is an orphaned build, or one whose work has already landed, kill
			// it and the lock moves.
			console.log(
				holder > 0
					? `waiting for the lock at ${path}, held by pid ${holder}`
					: `waiting for the lock at ${path}, taken by a process that named no id`,
			);
			said = true;
		}
		sleep(LOCK_POLL_MS);
	}
	if (said)
		console.log(
			`took the lock at ${path} after ${Math.round((performance.now() - started) / 1000)} s`,
		);
	return () => {
		// Only the holder removes the lock: a lock that another process broke and took must stay.
		if (lockHolder(path) === process.pid) rmSync(path, { recursive: true, force: true });
	};
}

/**
 * How many bytes a cache under the root may keep before its least recently used entries go. The
 * figure bounds runaway growth rather than a working set, so a tighter limit evicts sets and entries
 * that the next build would then rebuild.
 *
 * It was 24 GB until 22 October 2026. That day the module cache held four sets in 23 GB, so one set
 * is about 5.8 GB rather than the 850 MB this note claimed: the shader set grew with every feature
 * that added a family. A worktree that merged the milestone branch found its set evicted and rebuilt
 * the whole thing, which takes a minute on an idle machine and over an hour through the queue. The
 * disk held 1.6 TB free, so the limit now holds about eleven sets.
 */
export const CACHE_LIMIT_BYTES = 64 * 1024 * 1024 * 1024;

/** An entry used within this long stays, because a build of another checkout may still read it. */
const IN_USE_MS = 2 * 60 * 60 * 1000;

/** The bytes an entry holds and when it was last used, from one walk of it. */
function entryUse(path: string): { bytes: number; usedMs: number } {
	const stats = statSync(path, { throwIfNoEntry: false });
	if (!stats) return { bytes: 0, usedMs: 0 };
	if (!stats.isDirectory()) return { bytes: stats.size, usedMs: stats.mtimeMs };
	let bytes = 0;
	let usedMs = stats.mtimeMs;
	for (const name of readdirSync(path, { recursive: true, encoding: 'utf8' })) {
		const child = statSync(join(path, name), { throwIfNoEntry: false });
		if (!child?.isFile()) continue;
		bytes += child.size;
		usedMs = Math.max(usedMs, child.mtimeMs);
	}
	return { bytes, usedMs };
}

/**
 * Marks the cache entry `folder` as used now, so pruning keeps it while it is being read. A cache
 * that cannot be touched still reads: the entry is then pruned as if it were unused.
 */
export function touchCacheEntry(folder: string): void {
	const now = new Date();
	try {
		utimesSync(folder, now, now);
	} catch {
		// A read-only cache still reads.
	}
}

/**
 * Removes the least recently used entries of `folder` until it holds at most `limit` bytes, and
 * returns the names it removed. An entry used within the last while stays: a build of another
 * checkout may still be reading it, and removing it costs that build its work. A folder that cannot
 * be listed is left alone. Every cache under the root prunes through this, so one rule bounds them
 * all; the baseline cache and the shader cache each grew past 10 GB in a day without one.
 */
export function pruneCache(folder: string, limit = CACHE_LIMIT_BYTES): string[] {
	let names: string[];
	try {
		names = readdirSync(folder);
	} catch {
		return [];
	}
	const entries = names.map((name) => ({
		name,
		path: join(folder, name),
		...entryUse(join(folder, name)),
	}));
	let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
	const removed: string[] = [];
	for (const entry of [...entries].sort((one, two) => one.usedMs - two.usedMs)) {
		if (total <= limit) break;
		// A lock of our own, or an entry another build is reading, is never pruned.
		if (entry.name.endsWith('.lock') || Date.now() - entry.usedMs <= IN_USE_MS) continue;
		rmSync(entry.path, { recursive: true, force: true });
		total -= entry.bytes;
		removed.push(entry.name);
	}
	return removed;
}

/**
 * Prunes `folder` while this process holds a lock beside it, so two builds never prune at once and a
 * prune never removes an entry that the other just wrote. Returns the names it removed.
 */
export function pruneCacheLocked(folder: string, limit = CACHE_LIMIT_BYTES): string[] {
	const release = acquireLock(`${folder}.prune.lock`);
	try {
		return pruneCache(folder, limit);
	} finally {
		release();
	}
}

/** Copies each named source into `folder` in one step, shared by the caches that store a folder. */
export function copyFolderAtomic(
	folder: string,
	sources: readonly (readonly [string, string])[],
): boolean {
	return writeFolderAtomic(folder, (staging) => {
		for (const [name, source] of sources) copyFileSync(source, join(staging, name));
	});
}
