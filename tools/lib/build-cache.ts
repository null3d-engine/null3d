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
import { execFileSync, type StdioOptions, spawn, spawnSync } from 'node:child_process';
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

/**
 * How a waiter watches a lock's holder: how often it reads the processor time that the holder's
 * processes have used, how often it says what it read, how much of that time counts as progress,
 * and how long a holder may go without progress. A page build at normal priority uses about a
 * minute of processor time per minute. On 25 October 2026 two holders at background priority held
 * the page-build lock for 46 and 54 minutes on 38 s and 4 s, while every other page build waited.
 * A sample every two seconds sees nearly all the time of a child that lives only a few seconds.
 */
export interface HolderWatch {
	readonly sampleMs: number;
	readonly reportMs: number;
	readonly progressSeconds: number;
	readonly stallMs: number;
}

/** The watch that a page build's wait for the machine's page-build lock keeps on its holder. */
export const HOLDER_WATCH: HolderWatch = {
	sampleMs: 2_000,
	reportMs: 120_000,
	progressSeconds: 30,
	stallMs: 10 * 60_000,
};

/**
 * What a waiter does about a holder that has gone `stalledMs` without progress: it waits, it ends a
 * holder at background priority, which no call can raise again and which would hold the lock for
 * hours, or it stops waiting and says why. A slow holder at any other priority is never ended.
 */
export function holderVerdict(
	stalledMs: number,
	priority: number | undefined,
	stallMs: number,
): 'wait' | 'end' | 'stop' {
	if (stalledMs < stallMs) return 'wait';
	return priority !== undefined && priority <= BACKGROUND_PRIORITY ? 'end' : 'stop';
}

/** Processor time as `ps` prints it, `[[dd-]hh:]mm:ss.ss` or macOS's `mm:ss.ss`, in seconds. */
export function cpuSeconds(text: string): number {
	const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
	const seconds = (clock ?? '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
	return Number(days) * 24 * 60 * 60 + seconds;
}

/** A process's id, its parent's id and the processor time that it has used, in seconds. */
type ProcessRow = [id: number, parent: number, seconds: number];

/** The clock ticks in a second, which Linux counts processor time in, read once. */
let clockTicks: number | undefined;
function ticksPerSecond(): number {
	if (clockTicks === undefined) {
		try {
			clockTicks =
				Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 10_000 })) || 100;
		} catch {
			clockTicks = 100;
		}
	}
	return clockTicks;
}

/**
 * The parent and the processor time, in seconds, of a process's record in Linux's `/proc/<id>/stat`,
 * whose times count clock ticks. The name in parentheses may hold spaces and parentheses, so the
 * fields count from its last closing parenthesis: the state, the parent, and the user and system
 * times further on.
 */
export function statTimes(stat: string, ticks: number): [parent: number, seconds: number] {
	const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
	return [Number(fields[1]), (Number(fields[11]) + Number(fields[12])) / ticks];
}

/**
 * Every process as the system lists it now. Linux's `ps` prints processor time in whole seconds,
 * which shows a child that runs for less than one as using none, so on Linux the times come from
 * each process's own record. Undefined when the listing fails.
 */
function processRows(): ProcessRow[] | undefined {
	if (process.platform === 'linux') {
		let names: string[];
		try {
			names = readdirSync('/proc');
		} catch {
			return undefined;
		}
		const ticks = ticksPerSecond();
		const rows: ProcessRow[] = [];
		for (const name of names) {
			if (!/^\d+$/.test(name)) continue;
			try {
				rows.push([Number(name), ...statTimes(readFileSync(`/proc/${name}/stat`, 'utf8'), ticks)]);
			} catch {
				// It has gone.
			}
		}
		return rows;
	}
	let listing: string;
	try {
		listing = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time='], {
			encoding: 'utf8',
			timeout: 10_000,
		});
	} catch {
		return undefined;
	}
	const rows: ProcessRow[] = [];
	for (const line of listing.split('\n')) {
		const [id, parent, used] = line.trim().split(/\s+/);
		if (id && parent && used) rows.push([Number(id), Number(parent), cpuSeconds(used)]);
	}
	return rows;
}

/**
 * A process and its descendants as the system lists them now: the processor time that each has
 * used, in seconds, by its id. Undefined when the listing fails or the process has gone.
 */
export function processTree(pid: number): Map<number, number> | undefined {
	const rows = processRows();
	if (rows === undefined) return undefined;
	const children = new Map<number, number[]>();
	const time = new Map<number, number>();
	for (const [id, parent, seconds] of rows) {
		time.set(id, seconds);
		children.set(parent, [...(children.get(parent) ?? []), id]);
	}
	if (!time.has(pid)) return undefined;
	const tree = new Map<number, number>();
	for (const next = [pid]; next.length > 0; ) {
		const id = next.pop() as number;
		tree.set(id, time.get(id) ?? 0);
		next.push(...(children.get(id) ?? []));
	}
	return tree;
}

/**
 * The processor time that a holder's processes have used in all, as far as the samples saw it. It
 * never falls: a child that has exited, or whose id a new process took, keeps the time that the
 * last sample saw it use.
 */
export class TreeTime {
	private readonly last = new Map<number, number>();
	private ended = 0;

	/** Takes in a sample of the tree, and returns the time used in all. */
	add(tree: ReadonlyMap<number, number>): number {
		for (const [id, seen] of this.last) {
			const now = tree.get(id);
			if (now === undefined || now < seen) this.ended += seen;
			if (now === undefined) this.last.delete(id);
		}
		for (const [id, now] of tree) this.last.set(id, now);
		let total = this.ended;
		for (const seen of this.last.values()) total += seen;
		return total;
	}
}

/** Ends the processes in `pids`, and those that ignore the request a few seconds later. */
function endProcesses(pids: readonly number[]): void {
	const signal = (id: number, name: NodeJS.Signals) => {
		try {
			process.kill(id, name);
		} catch {
			// It has gone already.
		}
	};
	for (const id of pids) signal(id, 'SIGTERM');
	for (let waited = 0; waited < 5_000 && pids.some(isRunning); waited += LOCK_POLL_MS)
		sleep(LOCK_POLL_MS);
	for (const id of pids) if (isRunning(id)) signal(id, 'SIGKILL');
}

/** What a waiter has read of one holder: when that holder last made progress, and what it had used then. */
interface HolderReading {
	readonly pid: number;
	readonly time: TreeTime;
	seconds: number;
	progressAt: number;
	sampledAt: number;
	reportedAt: number;
}

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

/** True when the lock at `path`, taken at `takenMs`, has no live holder: it was left by one that stopped. */
function lockStopped(path: string, takenMs: number): boolean {
	const holder = lockHolder(path);
	return holder > 0 ? !isRunning(holder) : Date.now() - takenMs > UNNAMED_LOCK_MS;
}

/**
 * The live process that holds the lock at `path`: its id, or 0 for a recent lock that names none.
 * Undefined when no live process holds it, so a caller that must not wait can tell whether it would.
 */
export function liveLockHolder(path: string): number | undefined {
	const takenMs = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
	if (takenMs === undefined || lockStopped(path, takenMs)) return undefined;
	return lockHolder(path);
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
 * Removes the lock at `path`, taken at `takenMs` by `holder`, after renaming it aside. The rename is
 * the decisive step: of two processes that find the same stale lock, exactly one renames it. The one
 * that renames then checks that it moved the lock it judged, by its holder and the time it was
 * taken. When another process broke that lock and took a new one in the meantime, it puts the new
 * one back instead of removing it.
 */
function breakLock(path: string, holder: number, takenMs: number): void {
	const aside = `${path}.stale-${process.pid}`;
	try {
		renameSync(path, aside);
	} catch {
		// Another process broke the lock first; it is gone, so the loop tries again.
		return;
	}
	if (lockHolder(aside) === holder && statSync(aside).mtimeMs === takenMs) {
		rmSync(aside, { recursive: true, force: true });
		return;
	}
	try {
		renameSync(aside, path);
	} catch {
		// A third process took the name in the moment between, so the moved lock's holder no longer
		// holds the path. Say so, since two holders may now run at once.
		console.error(
			`the lock at ${path} was taken twice while a stale one was broken; its holder ${lockHolder(aside)} lost it`,
		);
		rmSync(aside, { recursive: true, force: true });
	}
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
export function acquireLock(
	path: string,
	options: { freesSlot?: boolean; watch?: HolderWatch } = {},
): () => void {
	mkdirSync(dirname(path), { recursive: true });
	const started = performance.now();
	const slot = process.env[HEAVY_SLOT_ENV];
	const marker =
		options.freesSlot && slot && existsSync(slot)
			? join(slot, `waiting-${process.pid}`)
			: undefined;
	let waited: boolean;
	try {
		waited = waitForLock(path, marker, options.watch);
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
 * job's slot of the job queue counts as free while it waits. With `watch`, it keeps the watch on
 * the holder that `HolderWatch` describes.
 */
function waitForLock(path: string, marker: string | undefined, watch?: HolderWatch): boolean {
	let waited = false;
	let reading: HolderReading | undefined;
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
		if (lockStopped(path, takenMs)) {
			breakLock(path, holder, takenMs);
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
		if (watch && holder > 0) {
			reading = watchHolder(path, holder, takenMs, watch, reading);
			if (!reading) continue;
		}
		sleep(LOCK_POLL_MS);
	}
}

/**
 * One step of a waiter's watch on the lock's holder: reads what the holder's processes have used
 * when a sample is due, says so when a report is due, and acts on the verdict. Returns the reading
 * to keep, or undefined once it has ended the holder and broken its lock. Throws when it stops
 * waiting. A holder whose processes have used less than the progress threshold in all their life
 * has made no progress since it took the lock, so its stall counts from then.
 */
function watchHolder(
	path: string,
	holder: number,
	takenMs: number,
	watch: HolderWatch,
	reading: HolderReading | undefined,
): HolderReading | undefined {
	const now = Date.now();
	if (reading?.pid !== holder) {
		const time = new TreeTime();
		const seconds = time.add(processTree(holder) ?? new Map());
		const progressAt = seconds < watch.progressSeconds ? takenMs : now;
		return { pid: holder, time, seconds, progressAt, sampledAt: now, reportedAt: now };
	}
	if (now - reading.sampledAt < watch.sampleMs) return reading;
	reading.sampledAt = now;
	const tree = processTree(holder);
	if (!tree) return reading;
	const total = reading.time.add(tree);
	if (total - reading.seconds >= watch.progressSeconds) {
		reading.seconds = total;
		reading.progressAt = now;
	}
	const priority = processPriority(holder);
	const minutes = ((now - reading.progressAt) / 60_000).toFixed(1);
	const used = `${(total - reading.seconds).toFixed(1)} s of processor time in the last ${minutes} minutes`;
	const at = `pid ${holder}, at priority ${priority ?? 'unknown'}`;
	switch (holderVerdict(now - reading.progressAt, priority, watch.stallMs)) {
		case 'end':
			console.log(
				`ending the holder of the lock at ${path}: ${at}, which is macOS background priority, used ${used}. No call can raise it again, so it must start over at normal priority`,
			);
			endProcesses([...tree.keys()]);
			breakLock(path, holder, takenMs);
			return undefined;
		case 'stop':
			throw new Error(
				`stopped waiting for the lock at ${path}: its holder, ${at}, used ${used}, so it is making no progress. Find out what it waits on, or end it if it has hung`,
			);
		case 'wait':
			if (now - reading.reportedAt >= watch.reportMs) {
				reading.reportedAt = now;
				console.log(`still waiting for the lock at ${path}: its holder, ${at}, used ${used}`);
			}
			return reading;
	}
}

/** The scheduling priority that `ps` shows on macOS for a process at background priority. */
export const BACKGROUND_PRIORITY = 4;

/** A process's scheduling priority as `ps` shows it on macOS, or undefined elsewhere or when `ps` fails. */
export function processPriority(pid: number = process.pid): number | undefined {
	if (process.platform !== 'darwin') return undefined;
	try {
		const priority = Number(
			execFileSync('ps', ['-o', 'pri=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 }),
		);
		return Number.isFinite(priority) ? priority : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Why a page build at `priority` must not take the machine's page-build lock, or undefined when it
 * may. At macOS background priority its bundler inherits that priority, and on a loaded machine gets
 * almost no processor time while every other page build waits for the lock: on 25 October 2026 one
 * held it for 46 minutes, its bundler having used 38 s of processor time. No call lifts a process
 * out of background priority, so the build must start without it.
 */
export function pageBuildPriorityProblem(priority: number | undefined): string | undefined {
	if (priority === undefined || priority > BACKGROUND_PRIORITY) return undefined;
	return `this page build runs at macOS background priority (${priority}), where its bundler gets almost no processor time while it holds the machine's page-build lock, and every other page build waits for it. Start it at normal priority: through the job queue's CPU lane, or from a shell that no job run with \`taskpolicy -b\` started`;
}

/**
 * Takes the machine's lock of production page builds, which lets one run at a time: two at once
 * leave the bundler blocked in its own callback, gaining a tenth of a second of processor time a
 * minute, and neither finishes. Returns the function that releases it. A build at background
 * priority refuses to take it (pageBuildPriorityProblem), and a wait for it keeps the watch on its
 * holder that HOLDER_WATCH gives.
 */
export function acquirePageBuildLock(): () => void {
	const problem = pageBuildPriorityProblem(processPriority());
	if (problem) throw new Error(problem);
	return acquireLock(join(cacheRoot(), 'page-build.lock'), {
		freesSlot: true,
		watch: HOLDER_WATCH,
	});
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
