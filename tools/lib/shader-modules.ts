// Builds the shader modules when they are missing or out of date. Git does not keep them, so every
// command that reads them calls this first: the build, the type check and the unit tests through
// `bun tools/shaders.ts`, and the Vite and Playwright configs directly. Playwright loads this file
// as a CommonJS module, so it takes the repository's root from its caller.
//
// The record holds a hash of the inputs, which are the shader crate and the crates it depends on
// (sources, manifest and WGSL) and the workspace's Cargo files, and a hash of the modules the build
// wrote. A check only reads and hashes files, so it costs far less than the build. A lock file makes
// processes that start together, such as Playwright's web servers, run one build between them.
//
// The build itself keeps each entry's compiled output in a per-entry cache, keyed by the entry's
// source, its manifest table and the library modules it imports. A change to one shader compiles
// only that shader, and a change to a library module compiles only the entries that import it. The
// cache is shared by every checkout and reused across a change of any WGSL file.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	acquireLock,
	cacheDir,
	cacheOff,
	copyFolderAtomic,
	filesIn,
	hashFiles,
	writeFileAtomic,
} from './build-cache';

/** The folder that the shader build writes its modules into. */
export const MODULE_DIR = 'packages/engine/src/generated';
/** The crate whose `shader-build` command writes the modules. */
const SHADER_CRATE = 'crates/null3d-shaders';
/** The folder of the entry shaders and the library modules, which decide one entry each. */
const SHADER_FOLDER = `${SHADER_CRATE}/wgsl`;
/** The manifest, whose tables decide one entry each. */
const MANIFEST = `${SHADER_CRATE}/shaders.toml`;
/** Workspace files that change how Cargo builds the command. */
const WORKSPACE_FILES = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
/** Crate folders that hold no input of the command. */
const SKIPPED_FOLDERS = new Set(['tests', 'benches', 'examples', 'target']);
/** The record of the inputs and modules of the last build. Cleaning `target` forces a new build. */
export const RECORD = 'target/shader-modules.json';
/**
 * The folder that holds the modules of a build, keyed by the hash of its inputs, shared by every
 * checkout on the machine. A checkout whose inputs match a folder there copies its modules instead of
 * building them, which a fresh worktree needs. It is the `shader-modules` cache under the build
 * cache's one root; `NULL3D_SHADER_CACHE` names this folder alone, as before.
 */
export const CACHE_DIR = cacheDir('shader-modules', process.env.NULL3D_SHADER_CACHE);
/**
 * The folder of the per-entry shader cache, shared by every checkout on the machine. It holds each
 * entry's compiled output under a folder named by the compiler's stamp, so a change to one shader
 * compiles only that shader and a change to a library module compiles only the entries that import
 * it. It is the `shader-cache` folder under the build cache's one root.
 */
export const ENTRY_CACHE_DIR = cacheDir('shader-cache');
/** The lock file, which holds the process ID of the process that builds. */
const LOCK = 'target/shader-modules.lock';

interface ModuleRecord {
	inputs: string;
	modules: string;
}

/**
 * True for a file that the shader build writes: the main module, the module of feature names, the
 * module of each shader that loads on first use as a whole and each target's table of the modules
 * of builds that need several features, TypeScript, or a device module, plain JavaScript.
 */
export function isShaderModule(name: string): boolean {
	return (
		name === 'shaders.ts' ||
		name === 'shader-features.ts' ||
		/^shaders-[a-z0-9-]+-(wgsl|glsl)\.ts$/.test(name) ||
		/^shaders-(wgsl|glsl)-combos\.ts$/.test(name) ||
		/^shaders-[a-z0-9-]+\.js$/.test(name)
	);
}

/**
 * The crate folders that the build of `crate` compiles: its own and its path dependencies. The
 * shader build's by default.
 */
export function crateFolders(root: string, crate = SHADER_CRATE): string[] {
	const folders = new Set<string>();
	const visit = (folder: string) => {
		if (folders.has(folder)) return;
		folders.add(folder);
		const manifest = readFileSync(join(root, folder, 'Cargo.toml'), 'utf8');
		for (const [, path = ''] of manifest.matchAll(/\bpath\s*=\s*"([^"]+)"/g))
			visit(join(folder, path));
	};
	visit(crate);
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

/**
 * Every input of the build of `crate`, in order: the files of it and its path dependencies, and the
 * workspace's Cargo files. The shader build's inputs by default.
 */
export function inputFiles(root: string, crate = SHADER_CRATE): string[] {
	const files = [...WORKSPACE_FILES];
	for (const folder of crateFolders(root, crate)) filesBelow(root, folder, files);
	return files.sort();
}

/** A hash of every input of the build of `crate`, the shader build's by default. */
export function inputHash(root: string, crate = SHADER_CRATE): string {
	return hashFiles(root, inputFiles(root, crate));
}

/**
 * True when the environment asks the build to ignore its per-entry shader cache, so every entry
 * compiles again.
 */
export function shaderCacheOff(): boolean {
	return cacheOff();
}

/**
 * The files whose contents decide how every entry compiles: the compiler's own sources and the
 * workspace's Cargo files, without the entry shaders, the library modules and the manifest, which
 * decide one entry each and which the build keys per entry.
 */
export function compilerFiles(root: string): string[] {
	return inputFiles(root).filter(
		(file) => file !== MANIFEST && !file.startsWith(`${SHADER_FOLDER}/`),
	);
}

/** The stamp of the compiler: a hash of every file that changes how it compiles, for every entry. */
export function compilerStamp(root: string): string {
	return hashFiles(root, compilerFiles(root));
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

/**
 * Runs the work while this process holds the lock. A process that finds the lock waits for its
 * holder, and takes over a lock whose holder has stopped.
 */
function withLock(root: string, work: () => void): void {
	const release = acquireLock(join(root, LOCK));
	try {
		work();
	} finally {
		release();
	}
}

/** Runs the shader build, with its output on standard error so that callers keep a clean output. */
function runShaderBuild(root: string): void {
	const args = ['run', '--quiet', '-p', 'null3d-shaders', '--bin', 'shader-build', '--'];
	const buildArgs = ['--root', root];
	if (shaderCacheOff()) {
		buildArgs.push('--no-cache');
	} else {
		// A stamp from another compiler changes the folder, so no entry is read with a new meaning.
		const stamp = compilerStamp(root);
		buildArgs.push('--cache', join(ENTRY_CACHE_DIR, stamp), '--stamp', stamp);
	}
	const result = spawnSync('cargo', [...args, ...buildArgs], {
		cwd: root,
		stdio: ['ignore', 2, 2],
	});
	if (result.error)
		throw new Error(
			`could not run cargo (${result.error.message}). The shader modules are not in git, and building them needs the Rust toolchain that rust-toolchain.toml names.`,
		);
	if (result.status !== 0) throw new Error('the shader build failed; its output is above');
}

/** The names of the shader modules on disk, in order. */
function moduleNames(root: string): string[] {
	const folder = join(root, MODULE_DIR);
	return existsSync(folder) ? readdirSync(folder).filter(isShaderModule).sort() : [];
}

/** Writes the record of a build, in place. */
function writeRecord(root: string, record: ModuleRecord): void {
	writeFileAtomic(join(root, RECORD), `${JSON.stringify(record, null, '\t')}\n`);
}

/**
 * Copies the modules of these inputs from the shared cache, when it holds them, so a checkout with
 * none builds nothing. Returns true when it copied them.
 */
function restoreFromCache(root: string, inputs: string): boolean {
	const cache = join(CACHE_DIR, inputs);
	const names = filesIn(cache, isShaderModule);
	if (!names.includes('shaders.ts')) return false;
	const folder = join(root, MODULE_DIR);
	mkdirSync(folder, { recursive: true });
	const wanted = new Set(names);
	for (const name of moduleNames(root))
		if (!wanted.has(name)) rmSync(join(folder, name), { force: true });
	for (const name of names) copyFileSync(join(cache, name), join(folder, name));
	writeRecord(root, { inputs, modules: moduleHash(root) ?? '' });
	console.error(`the shader modules came from the shared cache (${CACHE_DIR})`);
	return true;
}

/** Copies the modules on disk into the shared cache, so another checkout need not build them. */
function saveToCache(root: string, inputs: string): void {
	copyFolderAtomic(
		join(CACHE_DIR, inputs),
		moduleNames(root).map((name) => [name, join(root, MODULE_DIR, name)] as const),
	);
}

/**
 * Builds the shader modules unless the record shows that they match their inputs. It copies them
 * from the shared cache of every checkout when that holds them, so a fresh worktree builds nothing.
 * Returns true when it ran the build.
 */
export function ensureShaderModules(root: string): boolean {
	const inputs = inputHash(root);
	if (isFresh(root, inputs)) return false;
	let built = false;
	withLock(root, () => {
		// Another process may have built them, or another checkout may hold them, while this one waited.
		if (isFresh(root, inputs)) return;
		if (restoreFromCache(root, inputs)) return;
		runShaderBuild(root);
		writeRecord(root, { inputs, modules: moduleHash(root) ?? '' });
		saveToCache(root, inputs);
		built = true;
	});
	return built;
}
