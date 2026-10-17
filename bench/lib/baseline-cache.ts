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
import { join } from 'node:path';
import { buildBenchPages } from '../../tests/lib/load-server.ts';
import { acquireLock, cacheDir } from '../../tools/lib/build-cache.ts';

/**
 * The cache's folder, which NULL3D_BASELINE_CACHE can move. By default it is a folder under the
 * build cache's one root, so one variable moves every cache on the machine.
 */
export const BASELINE_CACHE = process.env.NULL3D_BASELINE_CACHE || cacheDir('gpu-check-baselines');

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
export function run(cwd: string, command: string, ...args: string[]): void {
	const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
}

/** Git without the repository's hooks, which would write the generated files after each checkout. */
const git = (cwd: string, ...args: string[]) =>
	run(cwd, 'git', '-c', 'core.hooksPath=/dev/null', ...args);

/**
 * Runs `work` while this process holds the cache's lock, so one baseline build runs at a time. The
 * lock is the build caches' own (see tools/lib/build-cache.ts): its holder names itself, a lock whose
 * holder has stopped is broken, and the break renames the lock first, so two checks that find the same
 * stale lock never remove a live one.
 */
async function withLock<T>(cache: string, work: () => Promise<T>): Promise<T> {
	mkdirSync(cache, { recursive: true });
	const release = acquireLock(join(cache, 'builder.lock'));
	try {
		return await work();
	} finally {
		release();
	}
}

/**
 * The switches that the comparison code of the checkout at `root` gives its pages, or none when its
 * comparison had none.
 */
export async function switchesOf(root: string): Promise<readonly string[]> {
	try {
		const code = (await import(join(root, 'bench/lib/compare.ts'))) as {
			ALL_COMPARISON_SWITCHES?: readonly string[];
		};
		return code.ALL_COMPARISON_SWITCHES ?? [];
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
