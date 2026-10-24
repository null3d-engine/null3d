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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { copyInPlace } from './atomic-files';
import {
	acquireLock,
	cacheDir,
	cacheOff,
	cacheRoot,
	copyFolderAtomic,
	filesIn,
	hashFiles,
	hashOf,
	pruneCacheLocked,
	runCargo,
	touchCacheEntry,
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
 * cache's one root; `NULL3D_SHADER_CACHE` names this folder alone, as before. The folder is read from
 * the environment on each call, so a caller that moves the cache root moves this cache too.
 */
export const modulesCacheDir = (): string =>
	cacheDir('shader-modules', process.env.NULL3D_SHADER_CACHE);
/**
 * The folder of the per-entry shader cache, shared by every checkout on the machine, read from the
 * environment on each call. It holds each entry's compiled output under a folder named by the
 * compiler's stamp, so a change to one shader compiles only that shader and a change to a library
 * module compiles only the entries that import it. It is the `shader-cache` folder under the build
 * cache's one root.
 */
export const entryCacheDir = (): string => cacheDir('shader-cache');
interface ModuleRecord {
	inputs: string;
	modules: string;
	/** The module files of the set, so a run that must not build can name the files it lacks. */
	names?: readonly string[];
	/** The hash of each module file's name, size and time of change, as `moduleStats` gives it. */
	stats?: string;
}

/**
 * True for a file that the shader build writes: the main module, the module of feature names, the
 * module of each shader that loads on first use as a whole and each target's table of the modules
 * of builds that need several features, TypeScript, or a device module, plain JavaScript. Each kind
 * of device module has tables of shared paragraphs, one file for each target, each value of the
 * bits a device fixes and each feature family. A table is plain JavaScript too, and its name
 * carries no `shaders-` prefix, so that the list of a build's files for offline play reads it as
 * no feature of its own.
 */
export function isShaderModule(name: string): boolean {
	return (
		name === 'shaders.ts' ||
		name === 'shader-features.ts' ||
		/^shaders-[a-z0-9-]+-(wgsl|glsl)\.ts$/.test(name) ||
		// A target's table of builds that need several features, one file for each family and each
		// value of the half-precision bit: `shaders-wgsl-combos-bump` and
		// `shaders-wgsl-combos-bump-half`, and the same for GLSL. The family names the key's first
		// features, and a later feature adds another file.
		/^shaders-(wgsl|glsl)-combos(-[a-z0-9-]+)*\.ts$/.test(name) ||
		/^shader-paragraphs-(wgsl|glsl)(-[a-z0-9-]+)*\.js$/.test(name) ||
		/^shaders-[a-z0-9-]+\.js$/.test(name)
	);
}

/**
 * The modules that the main module `shaders.ts` in `folder` loads, from the relative names of its
 * imports and the device module files its loader tables name. A set that lacks one of them is not the
 * set a build wrote, so it must be a miss and never a silent "up to date".
 */
function requiredModules(folder: string): string[] {
	const file = join(folder, 'shaders.ts');
	if (!existsSync(file)) return [];
	const text = readFileSync(file, 'utf8');
	const names = new Set<string>();
	for (const match of text.matchAll(/\bfrom\s*'\.\/([A-Za-z0-9_.-]+)'/g)) names.add(match[1] ?? '');
	for (const match of text.matchAll(/\bimport\('\.\/([A-Za-z0-9_.-]+)'\)/g))
		names.add(match[1] ?? '');
	// A device module is named with its extension, as `new URL('./shaders-ao-glsl.js', import.meta.url)`.
	for (const match of text.matchAll(/'\.\/([A-Za-z0-9_.-]+\.[jt]s)'/g)) names.add(match[1] ?? '');
	return [...names].filter((name) => name !== '').sort();
}

/**
 * True when `folder` holds `shaders.ts` and every module it loads. A build writes one module for each
 * feature, each target and each value of the bits a device fixes, so a set that misses one is a
 * partial set that must never be used.
 */
export function folderIsComplete(folder: string): boolean {
	if (!existsSync(join(folder, 'shaders.ts'))) return false;
	for (const name of requiredModules(folder))
		if (
			!existsSync(join(folder, name)) &&
			!existsSync(join(folder, `${name}.ts`)) &&
			!existsSync(join(folder, `${name}.js`))
		)
			return false;
	return true;
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

/**
 * A hash of the modules on disk, or null when the set is incomplete: the main module is missing, or a
 * module that it loads is. A partial set is never fresh, so the build runs again rather than reporting
 * an incomplete set as up to date.
 */
export function moduleHash(root: string): string | null {
	const folder = join(root, MODULE_DIR);
	if (!folderIsComplete(folder)) return null;
	const names = readdirSync(folder).filter(isShaderModule).sort();
	return hashFiles(
		root,
		names.map((name) => `${MODULE_DIR}/${name}`),
	);
}

/** The record of a module set in the shared cache: the hash of each of its files, by name. */
const SET_RECORD = 'modules.json';

/**
 * True when the shared cache entry `cache` holds every module of a set and each file is the one its
 * record names. A set that misses a file, holds an extra one or holds a file with other bytes than
 * the record is incomplete, so it is a miss and the build writes the set again.
 */
export function setIsComplete(cache: string): boolean {
	if (!folderIsComplete(cache)) return false;
	let record: Record<string, string>;
	try {
		record = JSON.parse(readFileSync(join(cache, SET_RECORD), 'utf8')) as Record<string, string>;
	} catch {
		return false;
	}
	const names = filesIn(cache, isShaderModule);
	if (names.length !== Object.keys(record).length) return false;
	return names.every((name) => {
		try {
			return record[name] === hashOf(readFileSync(join(cache, name)));
		} catch {
			return false;
		}
	});
}

function readRecord(root: string): ModuleRecord | null {
	try {
		return JSON.parse(readFileSync(join(root, RECORD), 'utf8')) as ModuleRecord;
	} catch {
		return null;
	}
}

/**
 * A hash of each module file's name, size and time of change, to the second, which a copy that keeps
 * times, such as CI's archive, keeps too. Reading it takes a listing and a stat of each file, where
 * `moduleHash` reads every byte of the set, gigabytes of it.
 */
function moduleStats(root: string): string {
	const folder = join(root, MODULE_DIR);
	const names = existsSync(folder) ? readdirSync(folder).filter(isShaderModule).sort() : [];
	return hashOf(
		names
			.map((name) => {
				const stat = statSync(join(folder, name));
				return `${name}\t${stat.size}\t${Math.floor(stat.mtimeMs / 1000)}`;
			})
			.join('\n'),
	);
}

/**
 * True when the modules on disk are the ones the last build wrote from these inputs. When every
 * module file has the size and time of change that the record keeps, the set is the one the record
 * hashed, and no byte is read. Otherwise the bytes decide, and a set whose bytes still match keeps
 * its files' new sizes and times in the record, so the next check reads none.
 */
function isFresh(root: string, inputs: string): boolean {
	const record = readRecord(root);
	if (record?.inputs !== inputs) return false;
	const stats = moduleStats(root);
	if (record.stats === stats) return true;
	if (record.modules !== moduleHash(root)) return false;
	writeRecord(root, record);
	return true;
}

/**
 * True when the environment says that this run takes the modules from the build job. CI's jobs that
 * download the build job's artifact set it, so that a set which does not match its record stops the
 * job at once. The check otherwise builds the set again, which costs minutes in every such job and
 * hides the fault: a file that the build job wrote and the artifact missed.
 */
function freshShadersRequired(): boolean {
	return process.env.NULL3D_REQUIRE_FRESH_SHADERS === '1';
}

/** The names in `names`, at most four of them, then the count of the rest. */
function nameList(names: readonly string[]): string {
	const shown = names.slice(0, 4).join(', ');
	return names.length > 4 ? `${shown}, and ${names.length - 4} more` : shown;
}

/**
 * The message for a set that does not match its record, in a run that takes the modules from the
 * build job. It names the files that the record holds and this tree lacks, or the files that this
 * tree holds and the record does not name, because either is how an artifact that missed a kind of
 * file shows up.
 */
function staleSetMessage(root: string): string {
	const names = readRecord(root)?.names;
	const here = moduleNames(root);
	const missing = names ? names.filter((name) => !here.includes(name)) : [];
	const extra = names ? here.filter((name) => !names.includes(name)) : [];
	const faults = [
		missing.length > 0 ? `it lacks ${nameList(missing)}` : '',
		extra.length > 0 ? `it holds ${nameList(extra)}, which the record does not name` : '',
	].filter((fault) => fault !== '');
	return (
		`the shader modules in ${MODULE_DIR} are not the set that ${RECORD} records` +
		(faults.length > 0 ? `: ${faults.join('; ')}` : '') +
		`. This run takes the modules from the build job, because NULL3D_REQUIRE_FRESH_SHADERS is set, so it never builds them. A file that the shader build writes is missing from the artifact that carried them: add its path to the page-wasm artifact in .github/workflows/ci.yml.`
	);
}

/**
 * Runs the work while this process holds the lock. A process that finds the lock waits for its
 * holder, and takes over a lock whose holder has stopped. The lock lives in the shared cache, not
 * in the checkout, because two shader builds from two checkouts at once leave each of them at about
 * zero processor time and neither finishes.
 */
function withLock(work: () => void): void {
	const release = acquireLock(join(cacheRoot(), 'shader-modules.lock'));
	try {
		work();
	} finally {
		release();
	}
}

/**
 * Says that this build compiles every shader, so the minutes it takes do not look like a hang. The
 * notice appears only when the entries folder of this compiler holds nothing, which is the first
 * build of a checkout; a build that reuses most entries is quick and says nothing.
 */
export function announceColdBuild(entries: string): void {
	if (entryFiles(entries).length > 0) return;
	console.error(
		`The shader modules are not built in this checkout yet. The first build compiles every shader and can take a few minutes; it shows how far it has got. Later builds use the cache in ${entryCacheDir()}, and a change to one shader rebuilds only that shader.`,
	);
}

/**
 * The folder of this checkout's compiler in the per-entry cache. A stamp from another compiler
 * changes the folder, so no entry is read with a new meaning.
 */
function entryFolder(root: string, stamp = compilerStamp(root)): string {
	return join(entryCacheDir(), stamp);
}

/** The program that writes the modules, as cargo names it on this system. */
const PROGRAM = process.platform === 'win32' ? 'shader-build.exe' : 'shader-build';

/** The folder of a compiler's per-entry cache that keeps the program of that compiler. */
const PROGRAM_FOLDER = 'program';

/** Where the per-entry cache folder `entries` keeps the program of its compiler. */
function keptProgram(entries: string): string {
	return join(entries, PROGRAM_FOLDER, PROGRAM);
}

/**
 * The program that writes the modules. With the per-entry cache on, the program that the
 * compiler's folder of that cache keeps serves, and a program that cargo builds goes there. The
 * compiler's stamp covers every source of the program, so a kept program is the one that cargo
 * would build, and every checkout and CI job of the same compiler skips the compile. The shader
 * profile builds the crate's own parsing and validation code optimized, which the development
 * profile leaves unoptimized.
 */
function shaderProgram(root: string, entries?: string): string {
	const kept = entries === undefined ? undefined : keptProgram(entries);
	if (kept !== undefined && existsSync(kept)) return kept;
	// runCargo names the checkout's own target folder, so this build never writes another's.
	const { status, error } = runCargo(
		root,
		['build', '--quiet', '--profile', 'shader', '-p', 'null3d-shaders', '--bin', 'shader-build'],
		{ stdio: ['ignore', 2, 2] },
	);
	if (error)
		throw new Error(
			`could not run cargo (${error.message}). The shader modules are not in git, and building them needs the Rust toolchain that rust-toolchain.toml names.`,
		);
	if (status !== 0) throw new Error('the shader build did not compile; its output is above');
	const built = join(root, 'target', 'shader', PROGRAM);
	if (kept !== undefined) copyInPlace(built, kept);
	return built;
}

/**
 * Runs the shader build with `extra` arguments, with its output on standard error so that callers
 * keep a clean output.
 */
function runShaderBuild(root: string, extra: readonly string[] = []): void {
	const buildArgs = ['--root', root, ...extra];
	let entries: string | undefined;
	if (shaderCacheOff()) {
		buildArgs.push('--no-cache');
	} else {
		const stamp = compilerStamp(root);
		entries = entryFolder(root, stamp);
		buildArgs.push('--cache', entries, '--stamp', stamp);
		announceColdBuild(entries);
	}
	const program = shaderProgram(root, entries);
	const { status, error } = spawnSync(program, buildArgs, { cwd: root, stdio: ['ignore', 2, 2] });
	if (error) throw new Error(`could not run the shader build ${program} (${error.message})`);
	if (status !== 0) throw new Error('the shader build failed; its output is above');
}

/** The entry files in a folder of the per-entry cache, in order: none when it does not exist. */
function entryFiles(folder: string): string[] {
	return filesIn(folder, (name) => name.endsWith('.json'));
}

/**
 * Compiles shard `shard` of the manifest's entries, written `i/n` with `i` from 0, into the
 * per-entry cache, under the same folder and compiler stamp that a normal build reads, and writes
 * no module. The split cuts an entry that costs more than an even share into parts, which the cache
 * keeps beside the entry's key, so a later build joins a complete set of them into the entry, and
 * compiles none of the entries that the shards stored. The entries that the cache
 * already held are reused, not compiled. When `out` names a folder, the entries that this run
 * stored are copied there, and none that the cache held before, so a CI job can upload only its
 * new entries. The first shard also copies the program of its compiler there. Returns the entries'
 * file names.
 */
export function buildEntriesShard(root: string, shard: string, out?: string): string[] {
	if (shaderCacheOff())
		throw new Error(
			'--entries-shard fills the per-entry shader cache, so it cannot run while NULL3D_NO_CACHE, NULL3D_NO_BUILD_CACHE or NULL3D_NO_SHADER_CACHE turns the caches off',
		);
	const folder = entryFolder(root);
	const before = new Set(entryFiles(folder));
	runShaderBuild(root, ['--entries-shard', shard]);
	const stored = entryFiles(folder).filter((name) => !before.has(name));
	if (out !== undefined) {
		mkdirSync(out, { recursive: true });
		for (const name of stored) copyInPlace(join(folder, name), join(out, name));
		// The first shard also hands over the program, so the job that joins the entries runs it
		// without compiling it again.
		if (shard.startsWith('0/')) copyInPlace(keptProgram(folder), keptProgram(out));
	}
	return stored;
}

/** The names of the shader modules on disk, in order. */
function moduleNames(root: string): string[] {
	const folder = join(root, MODULE_DIR);
	return existsSync(folder) ? readdirSync(folder).filter(isShaderModule).sort() : [];
}

/** Writes the record of a build, in place. */
/** Writes the record of the modules on disk, with their files' sizes and times as they are now. */
function writeRecord(root: string, record: ModuleRecord): void {
	const kept = { ...record, stats: moduleStats(root) };
	writeFileAtomic(join(root, RECORD), `${JSON.stringify(kept, null, '\t')}\n`);
}

/**
 * Copies the modules of these inputs from the shared cache, when it holds them, so a checkout with
 * none builds nothing. Returns true when it copied them.
 */
function restoreFromCache(root: string, inputs: string): boolean {
	const dir = modulesCacheDir();
	const cache = join(dir, inputs);
	// A partial entry is a miss, and so is one whose record does not match its files: an entry that a
	// stopped or two racing builds left half written must never be handed back as a built set.
	if (!setIsComplete(cache)) return false;
	const names = filesIn(cache, isShaderModule);
	const folder = join(root, MODULE_DIR);
	mkdirSync(folder, { recursive: true });
	const wanted = new Set(names);
	for (const name of moduleNames(root))
		if (!wanted.has(name)) rmSync(join(folder, name), { force: true });
	try {
		// Each module takes its place whole, so a reader sees either the old file or the new one.
		for (const name of names) copyInPlace(join(cache, name), join(folder, name));
	} catch {
		// A copy that fails is a miss; the build then writes the whole set itself.
		return false;
	}
	const modules = moduleHash(root);
	if (modules === null) return false;
	writeRecord(root, { inputs, modules, names: moduleNames(root) });
	touchCacheEntry(cache);
	console.error(`the shader modules came from the shared cache (${dir})`);
	return true;
}

/**
 * Copies the modules on disk into the shared cache, so another checkout need not build them, with a
 * record of each file's bytes. The record is what makes a half-copied set, or one whose files were
 * truncated, a miss for the next checkout instead of a set that looks complete.
 */
function saveToCache(root: string, inputs: string): void {
	const folder = join(root, MODULE_DIR);
	// Only a complete set is stored: a partial set, from a build that wrote less than it declared,
	// would otherwise be handed to every checkout.
	if (!folderIsComplete(folder)) return;
	const names = moduleNames(root);
	const record: Record<string, string> = {};
	const sources = names.map((name) => {
		const path = join(folder, name);
		record[name] = hashOf(readFileSync(path));
		return [name, path] as const;
	});
	const cache = join(modulesCacheDir(), inputs);
	if (!copyFolderAtomic(cache, sources)) return;
	writeFileAtomic(join(cache, SET_RECORD), `${JSON.stringify(record, null, '\t')}\n`);
	touchCacheEntry(cache);
}

/**
 * Removes the least recently used entries of the module cache and of the per-entry cache, so a
 * machine that builds all day does not fill its disk. One module set is about 850 MB and the entry
 * cache holds one folder per compiler stamp, so without a limit the two grew past 30 GB in a day.
 */
function pruneCaches(): void {
	for (const folder of [modulesCacheDir(), entryCacheDir()]) {
		const removed = pruneCacheLocked(folder);
		if (removed.length > 0)
			console.error(`removed ${removed.length} least recently used entries of ${folder}`);
	}
}

/**
 * Builds the shader modules unless the record shows that they match their inputs. It copies them
 * from the shared cache of every checkout when that holds them, so a fresh worktree builds nothing.
 * Returns true when it ran the build.
 */
export function ensureShaderModules(root: string): boolean {
	const inputs = inputHash(root);
	if (isFresh(root, inputs)) return false;
	if (freshShadersRequired()) throw new Error(staleSetMessage(root));
	// A set that the shared cache holds needs no build, so it is copied without the lock, which
	// keeps two builds from running at once: a checkout whose set is cached never waits for
	// another checkout's build. Each module takes its place whole, and a set that lacks its record
	// is a miss, so a copy beside a build that stores the same set reads the whole set or nothing.
	if (restoreFromCache(root, inputs)) return false;
	let built = false;
	withLock(() => {
		// Another process may have built them, or another checkout may hold them, while this one waited.
		if (isFresh(root, inputs)) return;
		if (restoreFromCache(root, inputs)) return;
		runShaderBuild(root);
		const modules = moduleHash(root);
		if (modules === null)
			throw new Error(
				'the shader build wrote an incomplete set: a module that shaders.ts loads is missing',
			);
		// The inputs were hashed before the build read them. If a WGSL file changed while it ran, this
		// set is not the one `inputs` names, and its modules may hold a mix of the two versions. It is
		// never recorded and never stored, because a record would hand the output of the edited file
		// to every checkout whose sources match `inputs`. The caller is told to run again: a set that
		// the build read from two versions of its sources is not a set to build a page from.
		if (inputHash(root) !== inputs)
			throw new Error(
				'the shader sources changed while the build ran, so the modules are not the ones this build started from; run the command again',
			);
		writeRecord(root, { inputs, modules, names: moduleNames(root) });
		built = true;
		saveToCache(root, inputs);
		pruneCaches();
	});
	return built;
}
