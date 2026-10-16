// A persistent cache of compiled shaders, so a project builds its shaders once. A shader compile
// takes the CPU for most of a second, and without the cache every `vite build` and `vite dev`
// compiles the same WGSL again from nothing. The plugin keeps each result in
// `node_modules/.cache/null3d-shaders`, as the asset tool keeps its own results in
// `node_modules/.cache/null3d-assets`. A cache entry is keyed by everything that decides the
// output: the WGSL, the path it came from, the variant spec that the compiler is given, and the
// compiler's version. The version is the engine's version with the shader build's own stamp, so
// an engine or compiler upgrade misses every entry. A changed source, spec or compiler therefore
// misses, and the plugin never serves a wrong shader. Set `NULL3D_NO_CACHE=1`, or run Vite with
// `--force`, to ignore the cache.
//
// A game project's cache is not one of the repository's own build caches: it lives in the project,
// not under `~/.cache/null3d`, and a project that installs this package cannot load repository
// tooling. So this module repeats the three rules that one module keeps for the repository's caches
// in `tools/lib/build-cache.ts` (D-177): a write is atomic, any change to an input misses, and there
// is one documented opt-out. The `hashOf` and `writeFileAtomic` helpers below mirror that module's,
// and the opt-out names match its list. It takes no build lock: each entry is one atomic file, and
// the compiler pool runs several compiles at once, so a lock would only serialize them. Its rules
// for game developers are in docs/getting-started/install.md.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
	type CompileResult,
	type EffectResult,
	type MaterialResult,
	type MaterialSource,
	SHADER_COMPILER_URL,
	type ShaderCompiler,
	type ShaderSource,
} from './shader-compiler.ts';

/** The cache's folder in a project, beside the asset tool's cache. */
export const SHADER_CACHE_FOLDER = 'null3d-shaders';

/** The canonical opt-out, the same name that turns off the repository's own build caches. */
export const NO_CACHE = 'NULL3D_NO_CACHE';

/** A second name that turns the cache off, as `NO_CACHE` does. */
export const NO_SHADER_CACHE = 'NULL3D_NO_SHADER_CACHE';

/** Every name that turns the cache off, as `tools/lib/build-cache.ts` lists them. */
const NO_CACHE_NAMES = [NO_CACHE, 'NULL3D_NO_BUILD_CACHE', NO_SHADER_CACHE];

/**
 * The shape of a cache entry. Bump it when the records of a compiled shader change, so an older
 * entry is never read with new meaning.
 */
const FORMAT = 1;

/** The folder of the compiled shaders' cache in a project. */
export function shaderCacheFolder(root: string): string {
	return join(root, 'node_modules/.cache', SHADER_CACHE_FOLDER);
}

/** True when the environment asks the build to ignore the cache. */
export function shaderCacheOff(): boolean {
	return NO_CACHE_NAMES.some((name) => process.env[name] === '1');
}

/** A SHA-256 of the given values, in order, as `tools/lib/build-cache.ts`'s `hashOf` does. */
function hashOf(...inputs: readonly (string | Buffer)[]): string {
	const hash = createHash('sha256');
	for (const input of inputs) {
		hash.update(input);
		hash.update('\0');
	}
	return hash.digest('hex');
}

/** The version of the installed engine, or `unknown` when the project does not install it. */
function engineVersion(root: string): string {
	try {
		const manifest = createRequire(join(root, 'package.json')).resolve(
			'@null3d/engine/package.json',
		);
		const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
		return version ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/** The shader build's own stamp: the bytes of the compiler module, hashed once. */
let stamp: string | undefined;
function shaderBuildStamp(): string {
	if (stamp === undefined) {
		try {
			stamp = hashOf(readFileSync(SHADER_COMPILER_URL));
		} catch {
			stamp = 'missing';
		}
	}
	return stamp;
}

/**
 * The version that keys the cache: the engine's, with the shader build's own stamp. Both change
 * when the engine or the compiler changes, so neither serves an old shader after an upgrade.
 */
export function shaderCompilerVersion(root: string): string {
	return `${engineVersion(root)}:${shaderBuildStamp()}`;
}

/** What a cache reads and writes: a compile's result, and its own record of whether it compiled. */
function isResult(value: unknown): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { ok?: unknown }).ok === 'boolean'
	);
}

/** The cached result of a key, or undefined when the cache holds none the plugin can trust. */
function readCached(file: string): unknown {
	if (!existsSync(file)) return undefined;
	try {
		const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
		return isResult(value) ? value : undefined;
	} catch {
		// An entry that does not parse is one this build wrote while it stopped, or one from
		// another cache format. Compile again; never fail the build over a cache.
		return undefined;
	}
}

/**
 * Writes an entry in one step, as `tools/lib/build-cache.ts`'s `writeFileAtomic` does, so a reader
 * sees the whole old entry or the whole new one. A cache that cannot be written is not a failure:
 * the compile's result still stands.
 */
function writeCached(file: string, result: unknown): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		const partial = `${file}.${process.pid}.partial`;
		writeFileSync(partial, JSON.stringify(result));
		renameSync(partial, file);
	} catch {
		// A read-only folder, a full disk: the build carries on without the cache.
	}
}

/** The options of a cache. */
export interface ShaderCacheOptions {
	/** The version stamp; the default is `shaderCompilerVersion(root)`. */
	version?: string;
	/** True to compile every request, ignoring the cache. */
	disabled?: () => boolean;
}

/**
 * Compiles through another compiler, and keeps each result in a project's cache. A request whose
 * key the cache holds gives the stored result and never touches the inner compiler, so no compiler
 * worker starts. Two requests with one key compile once, however they arrive.
 */
export class ShaderCache implements ShaderCompiler {
	/** Requests that are compiling now, by key, so a second one waits for the first. */
	private readonly running = new Map<string, Promise<unknown>>();
	private stamp: string | undefined;

	constructor(
		private readonly root: () => string,
		private readonly inner: ShaderCompiler,
		private readonly options: ShaderCacheOptions = {},
	) {}

	shader(shader: ShaderSource): Promise<CompileResult> {
		return this.run('shader', shader, () => this.inner.shader(shader));
	}

	material(material: MaterialSource): Promise<MaterialResult> {
		return this.run('material', material, () => this.inner.material(material));
	}

	effect(effect: MaterialSource): Promise<EffectResult> {
		return this.run('effect', effect, () => this.inner.effect(effect));
	}

	/**
	 * The key of a request: the cache format, the compiler's version, the kind of compile and the
	 * request itself, hashed as the repository's build caches hash their inputs.
	 */
	private key(kind: string, request: unknown): string {
		this.stamp ??= this.options.version ?? shaderCompilerVersion(this.root());
		return hashOf(String(FORMAT), this.stamp, kind, JSON.stringify(request));
	}

	private async run<T>(kind: string, request: unknown, compile: () => Promise<T>): Promise<T> {
		if (this.options.disabled?.()) return compile();
		const key = this.key(kind, request);
		const file = join(shaderCacheFolder(this.root()), `${key}.json`);
		const cached = readCached(file);
		if (cached !== undefined) return cached as T;
		const pending = this.running.get(key);
		if (pending) return pending as Promise<T>;
		const work = (async () => {
			const result = await compile();
			writeCached(file, result);
			return result;
		})();
		this.running.set(key, work);
		try {
			return await work;
		} finally {
			this.running.delete(key);
		}
	}
}
