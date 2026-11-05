// The repository's own modules that hold WGSL: the `.wgsl` files and the scripts with tagged WGSL.
// The plugin's packing test compiles those of the test pages, the fixtures and the demos, and CI
// keys that test's pass on their contents, so a change that touches no shader passes it again. CI
// runs the test in parts, each with a share of the modules and a pass of its own.
//
// The dev server compiles a page's WGSL when the page first imports it, the add-on packages' as well
// as the sketches'. A custom material builds into every variant of the standard material, so a
// browser job that compiled the add-ons' materials itself spent minutes before the first page of
// them could start, past that page's limit. So CI's sketch-shaders jobs compile every module that
// the test pages serve into the plugin's cache, each a share of the compiles, with the requests
// that the dev server makes, and the jobs that serve the pages start with the joined cache.
//   bun tools/lib/wgsl-modules.ts                  print `hash=<sha-256>` of the packing test's modules
//   bun tools/lib/wgsl-modules.ts <k/n>            print the hash of part k of n's share
//   bun tools/lib/wgsl-modules.ts --served         print the cache key's parts for the served modules
//   bun tools/lib/wgsl-modules.ts --compile [k/n]  compile the served WGSL, or share k of n of it
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { CompilerPool } from '../../packages/vite-plugin/src/compile-pool';
import {
	SHADER_CACHE_FOLDER,
	ShaderCache,
	shaderCacheFolder,
	shaderCompilerVersion,
} from '../../packages/vite-plugin/src/shader-cache';
import type { ShaderCompiler } from '../../packages/vite-plugin/src/shader-compiler';
import {
	compileLiteral,
	compileWgslFile,
	findTaggedWgsl,
	WGSL_TAG,
} from '../../packages/vite-plugin/src/wgsl';
import { hashFiles, hashOf } from './build-cache';
import { filesBelow } from './walk';

/** The folders whose modules hold the repository's own WGSL: the test sketches and the demos. */
const WGSL_FOLDERS = ['tests/pages', 'tests/fixtures', 'examples'];

/**
 * The folders whose modules the test pages load from the dev server: the packing test's, the
 * benchmark pages', and the packages', whose add-ons hold the heaviest materials.
 */
const SERVED_FOLDERS = [...WGSL_FOLDERS, 'bench/pages', 'packages'];

/** Folders below those that no page loads its WGSL from: built copies and generated modules. */
const NOT_SERVED = ['dist', 'generated'];

/** A test of the repository's own, which no page loads. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Every module of `folders` with WGSL, as the plugin compiles it: scripts and `.wgsl` files, as
 * paths from `root`, in order. Test files are left out.
 */
function modulesBelow(root: string, folders: readonly string[]): string[] {
	const files: string[] = [];
	for (const folder of folders)
		for (const file of filesBelow(join(root, folder), NOT_SERVED)) {
			const path = join(folder, file);
			if (TEST_FILE.test(path)) continue;
			if (
				path.endsWith('.wgsl') ||
				(/\.[cm]?[jt]sx?$/.test(path) && WGSL_TAG.test(readFileSync(join(root, path), 'utf8')))
			)
				files.push(path);
		}
	return files.sort();
}

/** The packing test's modules: those of the test pages, the fixtures and the demos. */
export function wgslModules(root: string): string[] {
	return modulesBelow(root, WGSL_FOLDERS);
}

/** Every module whose WGSL the dev server compiles for the test pages. */
export function servedWgslModules(root: string): string[] {
	return modulesBelow(root, SERVED_FOLDERS);
}

/**
 * The items of part `k` of `n`, from a share written `k/n`: every n-th item from the k-th, so the
 * parts split the items evenly by count. Without a share, every item.
 */
export function moduleShare<T>(items: readonly T[], share?: string): T[] {
	if (!share) return [...items];
	const match = /^(\d+)\/(\d+)$/.exec(share);
	const part = Number(match?.[1]);
	const parts = Number(match?.[2]);
	if (!match || part < 1 || part > parts)
		throw new Error(
			`a share of the modules is k/n with k from 1 to n, such as 1/4, not '${share}'`,
		);
	return items.filter((_, i) => i % parts === part - 1);
}

/**
 * The two parts of the served modules' cache key: the compiler's version, which every entry's own
 * key holds, so a cache of another compiler serves nothing; and the modules' contents.
 */
export function servedKey(root: string): { compiler: string; modules: string } {
	return {
		compiler: hashOf(shaderCompilerVersion(root)).slice(0, 16),
		modules: hashFiles(root, servedWgslModules(root)).slice(0, 16),
	};
}

/** One compile of the served WGSL: a `.wgsl` file, or one tagged literal of a script. */
type Compile = (compiler: ShaderCompiler) => Promise<unknown>;

/**
 * Every compile that the dev server makes for the served modules, with its requests: the module's
 * path from the root names it, as the plugin names it. A material's compile takes about the same
 * time wherever it is, so a share of the compiles by count is a fair share of the time.
 */
export function servedCompiles(root: string): Compile[] {
	const compiles: Compile[] = [];
	for (const path of servedWgslModules(root)) {
		const file = join(root, path);
		const code = readFileSync(file, 'utf8');
		if (path.endsWith('.wgsl'))
			compiles.push((compiler) => compileWgslFile(path, file, code, compiler));
		else
			for (const literal of findTaggedWgsl(code, file))
				compiles.push((compiler) => compileLiteral(literal, code, file, path, compiler));
	}
	return compiles;
}

/**
 * Compiles the served WGSL, or a share of its compiles, into the plugin's cache, so that a page's
 * first import of a module reads the cache. Entries that the cache held before serve the compiles
 * that they match, and the rest are removed, so a cache that CI keeps from run to run holds only
 * the current entries. Returns the count of compiles and the time taken.
 */
export async function compileServed(
	root: string,
	share?: string,
	workers = availableParallelism(),
): Promise<{ compiles: number; ms: number }> {
	const start = performance.now();
	const folder = shaderCacheFolder(root);
	// The earlier entries move to a folder of their own, which an inner cache reads under the same
	// compiler version, and the outer cache writes each current entry back.
	const earlier = join(root, 'node_modules/.cache', `${SHADER_CACHE_FOLDER}-earlier`);
	rmSync(earlier, { recursive: true, force: true });
	if (existsSync(folder)) {
		mkdirSync(join(earlier, 'node_modules/.cache'), { recursive: true });
		renameSync(folder, join(earlier, 'node_modules/.cache', SHADER_CACHE_FOLDER));
	}
	const version = shaderCompilerVersion(root);
	const pool = new CompilerPool(workers);
	const compiler = new ShaderCache(() => root, new ShaderCache(() => earlier, pool, { version }), {
		version,
	});
	const compiles = moduleShare(servedCompiles(root), share);
	try {
		await Promise.all(compiles.map((compile) => compile(compiler)));
	} finally {
		await pool.close();
		rmSync(earlier, { recursive: true, force: true });
	}
	return { compiles: compiles.length, ms: performance.now() - start };
}

if (import.meta.main) {
	const root = join(import.meta.dirname, '../..');
	const [arg, share] = process.argv.slice(2);
	if (arg === '--served') {
		const { compiler, modules } = servedKey(root);
		console.log(`compiler=${compiler}\nmodules=${modules}`);
	} else if (arg === '--compile') {
		const { compiles, ms } = await compileServed(root, share);
		console.log(`ran ${compiles} compiles of the served WGSL in ${(ms / 1000).toFixed(1)} s`);
	} else console.log(`hash=${hashFiles(root, moduleShare(wgslModules(root), arg))}`);
}
