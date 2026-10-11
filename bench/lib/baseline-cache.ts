// The shared cache of prepared baselines: production builds of the benchmark pages of main's
// commits, one folder per commit, which every copy of the repository on this computer reuses. The
// GPU check compares a branch with its merge base, so checks of branches on the same main share one
// build. One builder worktree in the cache checks out each commit in turn and builds it, so each
// build only redoes what changed since the last. A lock lets one build run at a time, and old
// folders go once the cache holds more than it keeps.
import { execFileSync, spawnSync } from 'node:child_process';
import {
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
import { join } from 'node:path';
import { buildBenchPages } from '../../tests/lib/load-server.ts';

/** The cache's folder, which NULL3D_BASELINE_CACHE can move. */
export const BASELINE_CACHE =
	process.env.NULL3D_BASELINE_CACHE || join(homedir(), '.cache/null3d/gpu-check-baselines');

/** The file that a complete prepared baseline holds, with what a comparison needs of its commit. */
const RECORD_FILE = 'baseline.json';

/** What a comparison needs of a prepared baseline's commit, besides its pages. */
export interface PreparedBaseline {
	commit: string;
	/** The commit's subject line. */
	subject: string;
	/** The switches that the commit's comparison code gives every page. */
	switches: readonly string[];
}

/** The prepared baseline in `dir`, or null when `dir` holds none. */
export function readPreparedBaseline(dir: string): PreparedBaseline | null {
	try {
		return JSON.parse(readFileSync(join(dir, RECORD_FILE), 'utf8')) as PreparedBaseline;
	} catch {
		return null;
	}
}

/** The folder of a prepared baseline's build of the pages. */
export const preparedPages = (dir: string) => join(dir, 'pages');

/** The number of prepared baselines that the cache keeps, the last used first. */
export const KEPT_BASELINES = 6;
/** A prepared baseline used this recently stays, because a check may still be reading it. */
export const IN_USE_MS = 2 * 60 * 60 * 1000;

/** The cache's folders to remove: those past the kept number, unless used within the last while. */
export function baselinesToPrune(
	entries: readonly { name: string; usedMs: number }[],
	nowMs: number,
): string[] {
	return [...entries]
		.sort((a, b) => b.usedMs - a.usedMs)
		.slice(KEPT_BASELINES)
		.filter((entry) => nowMs - entry.usedMs > IN_USE_MS)
		.map((entry) => entry.name);
}

/** The cache's prepared baseline of a commit, marked as used now, or null when it has none. */
export function cachedBaseline(commit: string, cache = BASELINE_CACHE): string | null {
	const dir = join(cache, commit);
	if (readPreparedBaseline(dir)?.commit !== commit) return null;
	const now = new Date();
	utimesSync(join(dir, RECORD_FILE), now, now);
	return dir;
}

/** Runs a command with its output on this terminal, and throws when it fails. */
function run(cwd: string, command: string, ...args: string[]): void {
	const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
}

/** Git without the repository's hooks, which would write the generated files after each checkout. */
const git = (cwd: string, ...args: string[]) =>
	run(cwd, 'git', '-c', 'core.hooksPath=/dev/null', ...args);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** True while the process exists. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** A lock that names no process this long after it was taken was left by one that stopped. */
const UNNAMED_LOCK_MS = 60_000;

/** The process that holds the lock, or 0 when the lock names none yet. */
function holderOf(lock: string): number {
	try {
		return Number(readFileSync(join(lock, 'pid'), 'utf8')) || 0;
	} catch {
		return 0;
	}
}

/** Runs `work` while this process holds the cache's lock; a lock whose process has gone is freed. */
async function withLock<T>(cache: string, work: () => Promise<T>): Promise<T> {
	const lock = join(cache, 'builder.lock');
	let told = false;
	for (;;) {
		try {
			mkdirSync(lock);
			writeFileSync(join(lock, 'pid'), String(process.pid));
			break;
		} catch {
			const holder = holderOf(lock);
			const takenMs = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
			if (takenMs === undefined) continue;
			if (holder > 0 ? !alive(holder) : Date.now() - takenMs > UNNAMED_LOCK_MS) {
				rmSync(lock, { recursive: true, force: true });
				continue;
			}
			if (!told) console.log(`waiting for another check's baseline build (process ${holder})`);
			told = true;
			await sleep(10_000);
		}
	}
	try {
		return await work();
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
}

/**
 * The switches that the comparison code of the checkout at `root` gives every page, or none when
 * its comparison had none.
 */
export async function switchesOf(root: string): Promise<readonly string[]> {
	try {
		const code = (await import(join(root, 'bench/lib/compare.ts'))) as {
			COMPARISON_SWITCHES?: readonly string[];
		};
		return code.COMPARISON_SWITCHES ?? [];
	} catch {
		return [];
	}
}

/** Removes the cache's folders past the kept number, and any build that stopped half way. */
function prune(cache: string): void {
	const entries = readdirSync(cache).flatMap((name) => {
		if (name.endsWith('.part')) {
			rmSync(join(cache, name), { recursive: true, force: true });
			return [];
		}
		const record = join(cache, name, RECORD_FILE);
		return existsSync(record) ? [{ name, usedMs: statSync(record).mtimeMs }] : [];
	});
	for (const name of baselinesToPrune(entries, Date.now())) {
		console.log(
			`removing the prepared baseline of ${name.slice(0, 9)}, which no check used lately`,
		);
		rmSync(join(cache, name), { recursive: true, force: true });
	}
}

/**
 * The prepared baseline of `commit`, which this builds into the cache when it lacks one: the
 * builder worktree of the repository at `repo` checks the commit out, installs, builds the engine
 * and builds the benchmark pages. The commit must be one that the repository holds.
 */
export async function prepareBaseline(
	repo: string,
	commit: string,
	cache = BASELINE_CACHE,
): Promise<string> {
	const cached = cachedBaseline(commit, cache);
	if (cached) return cached;
	mkdirSync(cache, { recursive: true });
	return withLock(cache, async () => {
		const ready = cachedBaseline(commit, cache);
		if (ready) return ready;
		const builder = join(cache, 'builder');
		if (existsSync(join(builder, '.git'))) {
			git(builder, 'checkout', '--quiet', '--detach', '--force', commit);
			git(builder, 'clean', '--quiet', '-d', '--force');
		} else {
			rmSync(builder, { recursive: true, force: true });
			git(repo, 'worktree', 'prune');
			git(repo, 'worktree', 'add', '--quiet', '--detach', builder, commit);
		}
		run(builder, 'bun', 'install');
		run(builder, 'bun', 'run', 'build');
		const part = join(cache, `${commit}.part`);
		rmSync(part, { recursive: true, force: true });
		buildBenchPages(builder, preparedPages(part));
		const subject = execFileSync('git', ['-C', builder, 'log', '-1', '--format=%s'], {
			encoding: 'utf8',
		}).trim();
		const record: PreparedBaseline = { commit, subject, switches: await switchesOf(builder) };
		writeFileSync(join(part, RECORD_FILE), `${JSON.stringify(record, null, '\t')}\n`);
		const dir = join(cache, commit);
		rmSync(dir, { recursive: true, force: true });
		renameSync(part, dir);
		prune(cache);
		return dir;
	});
}
