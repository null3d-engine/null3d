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
// `runCargo` or `runCargoAsync`, which share one setup, so that rule holds at each of them.
import { type StdioOptions, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	accessSync,
	constants,
	copyFileSync,
	existsSync,
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

/** Takes each whole line of a command's output as it arrives; `stderr` is true for the error output. */
export type LineSink = (line: string, stderr: boolean) => void;

/** What one cargo call adds to the shared setup: its own variables, and its own build folder. */
interface CargoOptions {
	env?: Record<string, string>;
	targetDir?: string;
}

/**
 * The arguments and environment of a cargo run in `checkout`, which both cargo runners use, so that
 * every cargo call of the repository sets its build folder the same way: `targetDir`, when given,
 * names the folder of this call, and cargoEnv's own folder applies without it. `env` adds what one
 * call needs, such as a build's flags.
 */
function cargoCall(
	checkout: string,
	args: readonly string[],
	{ env = {}, targetDir }: CargoOptions,
) {
	return {
		args: targetDir ? [...args, '--target-dir', targetDir] : [...args],
		env: { ...process.env, ...cargoEnv(checkout), ...env },
	};
}

/**
 * Runs cargo with `args` in `checkout` and waits for it, with the setup of cargoCall. `stdio` picks
 * where its output goes. The caller reports its own failure.
 */
export function runCargo(
	checkout: string,
	args: readonly string[],
	options: CargoOptions & { stdio?: StdioOptions } = {},
): CargoRun {
	const call = cargoCall(checkout, args, options);
	const result = spawnSync('cargo', call.args, {
		cwd: checkout,
		stdio: options.stdio ?? 'inherit',
		env: call.env,
	});
	return { status: result.status, error: result.error ?? undefined };
}

/**
 * Runs cargo as runCargo does, without blocking, and hands each whole line of its output to
 * `onLine`, so that builds which run at the same time can each print theirs as it comes. The caller
 * reports its own failure.
 */
export function runCargoAsync(
	checkout: string,
	args: readonly string[],
	options: CargoOptions & { onLine: LineSink },
): Promise<CargoRun> {
	const call = cargoCall(checkout, args, options);
	return runByLine('cargo', call.args, { cwd: checkout, env: call.env, onLine: options.onLine });
}

/**
 * Splits one stream's text into whole lines for `take`. A chunk can end inside a line, so the last
 * part waits for its newline, or for the end of the stream.
 */
function wholeLines(take: (line: string) => void) {
	let partial = '';
	return {
		add(text: string) {
			const parts = (partial + text).split('\n');
			partial = parts.pop() ?? '';
			for (const part of parts) take(part);
		},
		end() {
			if (partial) take(partial);
			partial = '';
		},
	};
}

/**
 * Runs a command without blocking and hands each whole line that it writes to its output or its
 * error output to `onLine`, as the line arrives. It never rejects: a command that cannot start ends
 * with its error.
 */
export function runByLine(
	command: string,
	args: readonly string[],
	options: { cwd: string; env?: NodeJS.ProcessEnv; onLine: LineSink },
): Promise<CargoRun> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const out = wholeLines((line) => options.onLine(line, false));
		const err = wholeLines((line) => options.onLine(line, true));
		child.stdout.setEncoding('utf8').on('data', out.add);
		child.stderr.setEncoding('utf8').on('data', err.add);
		// A command that cannot start reports an error, and may close after it: the first ends the run.
		child.once('error', (error) => resolve({ status: null, error }));
		child.once('close', (status) => {
			out.end();
			err.end();
			resolve({ status });
		});
	});
}

/** Whole seconds since `started`, a reading of `performance.now()`, for a step's report. */
export const secondsSince = (started: number): number =>
	Math.round((performance.now() - started) / 1000);

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

/** The variable through which the Mac's job queue (`heavy.sh`) names the slot that runs a job. */
export const HEAVY_SLOT_ENV = 'NULL3D_HEAVY_SLOT';

/**
 * Takes the lock at `path` and returns the function that releases it. The lock is a folder that holds
 * the holder's process id, so exactly one process creates it: `mkdir` either creates the folder or
 * fails, never both. A process that finds the lock waits for its holder, and breaks a lock whose
 * holder has stopped, or one that names no process and is older than a minute: the rename in
 * breakLock makes two breakers safe. The shader build, the build and the size checks all take this
 * lock, each in a path of its own.
 *
 * With `freesSlot`, a wait gives back the slot of the Mac's job queue (`heavy.sh`) that runs this
 * process, named by `NULL3D_HEAVY_SLOT`: the process writes `waiting-<pid>` into the slot while it
 * waits, and the queue opens another slot for each slot so marked. Only a lock that its caller takes
 * while the job does nothing else frees the slot. On 24 October 2026 six jobs held slots for up to
 * 49 minutes with almost no processor time, and were killed by hand as hung.
 */
export function acquireLock(path: string, options: { freesSlot?: boolean } = {}): () => void {
	mkdirSync(dirname(path), { recursive: true });
	const started = performance.now();
	const slot = process.env[HEAVY_SLOT_ENV];
	const marker =
		options.freesSlot && slot && existsSync(slot)
			? join(slot, `waiting-${process.pid}`)
			: undefined;
	let waited: boolean;
	try {
		waited = waitForLock(path, marker);
	} finally {
		if (marker) rmSync(marker, { force: true });
	}
	if (waited) console.log(`took the lock at ${path} after ${secondsSince(started)} s`);
	return () => {
		// Only the holder removes the lock: a lock that another process broke and took must stay.
		if (lockHolder(path) === process.pid) rmSync(path, { recursive: true, force: true });
	};
}

/**
 * Creates the lock folder at `path` once no live process holds it, and returns true when it had to
 * wait. At its first wait it says who holds the lock, and writes `marker` when it has one, so the
 * job's slot of the job queue counts as free while it waits.
 */
function waitForLock(path: string, marker: string | undefined): boolean {
	let waited = false;
	for (;;) {
		try {
			mkdirSync(path);
			writeFileSync(join(path, 'pid'), String(process.pid));
			return waited;
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
		if (!waited) {
			waited = true;
			if (marker) writeFileSync(marker, `${path}\n`);
			// A size check holds its lock across a whole base build, so a wait here can last many
			// minutes. Say who holds it: without this a build that waits prints nothing and looks
			// hung. When the holder is an orphaned build, or one whose work has already landed, kill
			// it and the lock moves.
			const who = holder > 0 ? `held by pid ${holder}` : 'taken by a process that named no id';
			const free = marker ? "; this job's slot of the job queue counts as free while it waits" : '';
			console.log(`waiting for the lock at ${path}, ${who}${free}`);
		}
		sleep(LOCK_POLL_MS);
	}
}

/**
 * Takes the machine's lock of production page builds, which lets one run at a time: two at once
 * leave the bundler blocked in its own callback, gaining a tenth of a second of processor time a
 * minute, and neither finishes. Returns the function that releases it.
 */
export function acquirePageBuildLock(): () => void {
	return acquireLock(join(cacheRoot(), 'page-build.lock'), { freesSlot: true });
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
