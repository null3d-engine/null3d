// Builds the shader modules when they are missing or out of date. Git does not keep them, so every
// command that reads them calls this first: the build, the type check and the unit tests through
// `bun tools/shaders.ts`, and the Vite and Playwright configs directly. Playwright loads this file
// as a CommonJS module, so it takes the repository's root from its caller.
//
// The record holds a hash of the inputs, which are the shader crate and the crates it depends on
// (sources, manifest and WGSL) and the workspace's Cargo files, and a hash of the modules the build
// wrote. A check only reads and hashes files, so it costs far less than the build. A lock file makes
// processes that start together, such as Playwright's web servers, run one build between them.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** The folder that the shader build writes its modules into. */
export const MODULE_DIR = 'packages/engine/src/generated';
/** The crate whose `shader-build` command writes the modules. */
const SHADER_CRATE = 'crates/null3d-shaders';
/** Workspace files that change how Cargo builds the command. */
const WORKSPACE_FILES = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
/** Crate folders that hold no input of the command. */
const SKIPPED_FOLDERS = new Set(['tests', 'benches', 'examples', 'target']);
/** The record of the inputs and modules of the last build. Cleaning `target` forces a new build. */
export const RECORD = 'target/shader-modules.json';
/** The lock file, which holds the process ID of the process that builds. */
const LOCK = 'target/shader-modules.lock';
/** How often a process that waits for the lock checks it, in milliseconds. */
const LOCK_POLL_MS = 200;

interface ModuleRecord {
	inputs: string;
	modules: string;
}

/** True for a file that the shader build writes: the main module or a device module. */
export function isShaderModule(name: string): boolean {
	return /^shaders(-[a-z0-9-]+)?\.ts$/.test(name);
}

/** The crate folders that the shader build compiles: its own and its path dependencies. */
export function crateFolders(root: string): string[] {
	const folders = new Set<string>();
	const visit = (folder: string) => {
		if (folders.has(folder)) return;
		folders.add(folder);
		const manifest = readFileSync(join(root, folder, 'Cargo.toml'), 'utf8');
		for (const [, path = ''] of manifest.matchAll(/\bpath\s*=\s*"([^"]+)"/g))
			visit(join(folder, path));
	};
	visit(SHADER_CRATE);
	return [...folders].sort();
}

function filesBelow(root: string, folder: string, files: string[]): void {
	for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_FOLDERS.has(entry.name)) filesBelow(root, path, files);
		} else if (entry.isFile()) files.push(path);
	}
}

/** A hash of each file's path and contents, in the order given. */
function hashFiles(root: string, files: readonly string[]): string {
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(`${file}\0`);
		hash.update(readFileSync(join(root, file)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** A hash of every input of the shader build. */
export function inputHash(root: string): string {
	const files = [...WORKSPACE_FILES];
	for (const folder of crateFolders(root)) filesBelow(root, folder, files);
	return hashFiles(root, files.sort());
}

/** A hash of the modules on disk, or null when the main module is missing. */
export function moduleHash(root: string): string | null {
	const folder = join(root, MODULE_DIR);
	const names = existsSync(folder) ? readdirSync(folder).filter(isShaderModule).sort() : [];
	if (!names.includes('shaders.ts')) return null;
	return hashFiles(
		root,
		names.map((name) => `${MODULE_DIR}/${name}`),
	);
}

function readRecord(root: string): ModuleRecord | null {
	try {
		return JSON.parse(readFileSync(join(root, RECORD), 'utf8')) as ModuleRecord;
	} catch {
		return null;
	}
}

/** True when the modules on disk are the ones the last build wrote from these inputs. */
function isFresh(root: string, inputs: string): boolean {
	const record = readRecord(root);
	return record?.inputs === inputs && record.modules === moduleHash(root);
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

/**
 * Runs the work while this process holds the lock. A process that finds the lock waits for its
 * holder, and takes over a lock whose holder has stopped.
 */
function withLock(root: string, work: () => void): void {
	const lock = join(root, LOCK);
	mkdirSync(dirname(lock), { recursive: true });
	for (;;) {
		try {
			writeFileSync(lock, String(process.pid), { flag: 'wx' });
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
		}
		const holder = Number.parseInt(readFileSync(lock, 'utf8'), 10);
		if (Number.isInteger(holder) && isRunning(holder)) sleep(LOCK_POLL_MS);
		else rmSync(lock, { force: true });
	}
	try {
		work();
	} finally {
		rmSync(lock, { force: true });
	}
}

/** Runs the shader build, with its output on standard error so that callers keep a clean output. */
function runShaderBuild(root: string): void {
	const args = ['run', '--quiet', '-p', 'null3d-shaders', '--bin', 'shader-build'];
	const result = spawnSync('cargo', [...args, '--', '--root', root], {
		cwd: root,
		stdio: ['ignore', 2, 2],
	});
	if (result.error)
		throw new Error(
			`could not run cargo (${result.error.message}). The shader modules are not in git, and building them needs the Rust toolchain that rust-toolchain.toml names.`,
		);
	if (result.status !== 0) throw new Error('the shader build failed; its output is above');
}

/**
 * Builds the shader modules unless the record shows that they match their inputs. Returns true
 * when it ran the build.
 */
export function ensureShaderModules(root: string): boolean {
	const inputs = inputHash(root);
	if (isFresh(root, inputs)) return false;
	let built = false;
	withLock(root, () => {
		// Another process may have built them while this one waited for the lock.
		if (isFresh(root, inputs)) return;
		runShaderBuild(root);
		const record: ModuleRecord = { inputs, modules: moduleHash(root) ?? '' };
		const file = join(root, RECORD);
		writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(record, null, '\t')}\n`);
		renameSync(`${file}.${process.pid}`, file);
		built = true;
	});
	return built;
}
