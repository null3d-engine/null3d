// A persistent cache of compiled shaders, so a project builds its shaders once. A shader compile
// takes the CPU for most of a second, and every `vite build` and `vite dev` used to compile the
// same WGSL again from nothing. The plugin keeps each result in `node_modules/.cache/null3d-shaders`
// as the asset tool keeps its own results in `node_modules/.cache/null3d-assets`. A cache entry is
// keyed by everything that decides the output: the WGSL, the variant spec that the compiler is
// given, and the compiler's version. The version is the engine's version with the shader build's
// own stamp, so an engine or compiler upgrade misses every entry. A changed source, spec or
// compiler therefore misses, and the plugin never serves a wrong shader. Set
// `NULL3D_NO_SHADER_CACHE=1`, or run Vite with `--force`, to ignore the cache.
//
// A game project's cache is not one of the repository's own build caches: it lives in the project,
// not under `~/.cache/null3d`, and loads no repository tooling. It follows the same three rules, kept
// in one place for the repository's caches in `tools/lib/build-cache.ts`: a write is atomic, any
// change to an input misses, and there is one documented opt-out. Its rules for game developers are
// in docs/getting-started/install.md.
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

/** The environment variable that turns the cache off, so a build compiles every shader again. */
export const NO_SHADER_CACHE = 'NULL3D_NO_SHADER_CACHE';

/**
 * The shape of a cache entry. Bump it when the records of a compiled shader change, so an older
 * entry is never read with new meaning.
 */
const FORMAT = 1;

/** Hex digits of a key: enough that two of a project's shaders never share one. */
const KEY_DIGITS = 32;

/** The folder of the compiled shaders' cache in a project. */
export function shaderCacheFolder(root: string): string {
	return join(root, 'node_modules/.cache', SHADER_CACHE_FOLDER);
}

/** True when the environment asks the build to ignore the cache. */
export function shaderCacheOff(): boolean {
	return process.env[NO_SHADER_CACHE] === '1';
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
			stamp = createHash('sha256').update(readFileSync(SHADER_COMPILER_URL)).digest('hex');
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
	return `${FORMAT}:${engineVersion(root)}:${shaderBuildStamp()}`;
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
 * Writes a result under its key, whole or not at all, so a stopped build leaves no half entry. A
 * cache that cannot be written is not a failure: the compile's result still stands.
 */
function writeCached(file: string, result: unknown): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		const staging = `${file}.${process.pid}.tmp`;
		writeFileSync(staging, JSON.stringify(result));
		renameSync(staging, file);
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

	/** The key of a request: its kind and JSON, under the version that the compiler is. */
	private key(kind: string, request: unknown): string {
		this.stamp ??= this.options.version ?? shaderCompilerVersion(this.root());
		return createHash('sha256')
			.update(`${this.stamp}\n${kind}\n${JSON.stringify(request)}`)
			.digest('hex')
			.slice(0, KEY_DIGITS);
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
