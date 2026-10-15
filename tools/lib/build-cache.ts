// One root, and one set of mechanics, for the build caches under `tools/`. Each cache keeps its own
// key and layout; they share the root, the hashing, the atomic writes, the lock and the escape
// hatch. The caches sit outside git, as D-105's rule requires, so clearing the root is always safe:
// every entry is a pure function of its inputs, and a missing entry only costs the build time.
//
// The canonical root variable is `NULL3D_BUILD_CACHE`, defaulting to `~/.cache/null3d`, with one
// named subfolder per cache. The older per-cache variables (`NULL3D_SHADER_CACHE`,
// `NULL3D_WASM_ARTIFACTS`) still name one cache's own folder. The canonical escape hatch is
// `NULL3D_NO_CACHE=1`; `NULL3D_NO_BUILD_CACHE=1` and `NULL3D_NO_SHADER_CACHE=1` still work.
//
// The Rust build folder is not a cache under the root: each checkout keeps its own, because Cargo
// judges the engine's crates fresh by file times, and sccache, when installed, shares the compiled
// dependency crates instead (see cargoEnv).
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
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/** The one root of every build cache on this machine, `~/.cache/null3d` unless overridden. */
export const CACHE_ROOT = process.env.NULL3D_BUILD_CACHE ?? join(homedir(), '.cache', 'null3d');

/** The escape hatches that turn every cache off, canonical first and the older per-cache aliases. */
const NO_CACHE = ['NULL3D_NO_CACHE', 'NULL3D_NO_BUILD_CACHE', 'NULL3D_NO_SHADER_CACHE'];

/**
 * The folder of the named cache under the root. `override`, an older per-cache variable, names the
 * whole folder instead; the value `local` keeps it inside the checkout, under `target/<name>`.
 */
export function cacheDir(name: string, override?: string): string {
	if (override === 'local') return join(process.cwd(), 'target', name);
	return override ?? join(CACHE_ROOT, name);
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
 * The environment of a cargo run: sccache as the compiler wrapper when it is installed and the caller
 * names no wrapper, with its cache under the root. sccache keys each compile by the contents of its
 * sources, flags and dependencies, so the dependency crates compile once for every checkout while each
 * checkout keeps its own Rust build folder. Without sccache, cargo runs as it would alone; an empty
 * `RUSTC_WRAPPER` turns sccache off.
 */
export function cargoEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	if (env.RUSTC_WRAPPER !== undefined) return {};
	const sccache = onPath('sccache', env.PATH);
	if (!sccache) return {};
	return { RUSTC_WRAPPER: sccache, SCCACHE_DIR: env.SCCACHE_DIR ?? cacheDir('sccache') };
}

/** True when the environment asks every cache to be ignored, so each build runs again. */
export function cacheOff(): boolean {
	return NO_CACHE.some((name) => process.env[name] === '1');
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

/**
 * Takes the lock at `path` and returns the function that releases it. A process that finds the lock
 * waits for its holder, and takes over a lock whose holder has stopped. This one lock serves both
 * the shader build and the whole of a `bun run build`, including a size check's base build.
 */
export function acquireLock(path: string): () => void {
	mkdirSync(dirname(path), { recursive: true });
	const started = performance.now();
	let said = false;
	for (;;) {
		try {
			writeFileSync(path, String(process.pid), { flag: 'wx' });
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
		}
		const holder = Number.parseInt(readFileSync(path, 'utf8'), 10);
		if (Number.isInteger(holder) && isRunning(holder)) {
			if (!said) {
				// Every build on the machine holds this lock, and a size check holds it across its
				// whole base build, so a wait here can last many minutes. Say who holds it: without
				// this a build that waits prints nothing and looks hung. When the holder is an
				// orphaned build, or one whose work has already landed, kill it and the lock moves.
				console.log(`waiting for the lock at ${path}, held by pid ${holder}`);
				said = true;
			}
			sleep(LOCK_POLL_MS);
		} else rmSync(path, { force: true });
	}
	if (said)
		console.log(
			`took the lock at ${path} after ${Math.round((performance.now() - started) / 1000)} s`,
		);
	return () => rmSync(path, { force: true });
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
