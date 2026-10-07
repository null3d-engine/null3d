// The shader compiler: the engine's shader build as a WebAssembly module, for build tools. It
// composes WGSL with the engine's shader library (`#import null3d::math` and the rest), checks it
// against the portable WGSL rules, and writes WGSL for WebGPU and GLSL ES 3.00 for WebGL2, with
// the reflection that the WebGL2 backend binds by. It runs in Node and Bun while a project builds,
// so pages never download a shader translator. `bun run build` builds the module from the
// `null3d-shaders-wasm` crate into this package's dist folder.
//
// The module takes and gives JSON, through `CompilerCalls`. The functions here run it on this
// thread: the first call loads the module, and later calls reuse it and the library modules it
// composed. The compiler pool runs the same calls on worker threads.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompilerCalls } from './compiler-calls.js';
import type {
	CompiledTexture,
	CompiledUniform,
	ShaderVariant,
	WgslPipeline,
} from './shader-types.ts';

/** Where `bun run build` writes the module. */
export const SHADER_COMPILER_URL = new URL('../dist/shader-compiler.wasm', import.meta.url);

/** A language that a shader variant builds for: WGSL for WebGPU, or GLSL ES 3.00 for WebGL2. */
export type ShaderTarget = 'wgsl' | 'glsl';

/** One variant of a shader: a build for each combination of its permutation bits. */
export interface ShaderVariantSpec {
	/** Shader defs that are true in every build of the variant, for `#ifdef NAME` lines. */
	readonly defs?: readonly string[];
	/**
	 * Permutation bits by name, such as `TONE_MAP`. The variant builds once for each combination
	 * of them, with the names of the bits it has as more shader defs. The build without any bit
	 * takes the variant's name, and each other build adds the names of its bits in lowercase.
	 */
	readonly permutations?: readonly string[];
	/**
	 * The languages to write. A variant whose only target is `glsl` may read
	 * `@builtin(draw_index)`: its vertex shader then reads `gl_DrawID` from `WEBGL_multi_draw`.
	 */
	readonly targets: readonly ShaderTarget[];
}

/** A shader to compile. */
export interface ShaderSource {
	/** The file that the WGSL comes from, as problems name it. */
	readonly path: string;
	/** The WGSL. It may import the engine's library modules, such as `#import null3d::math`. */
	readonly source: string;
	/**
	 * Render pipelines by name. WebGL2 gets one GLSL program for each pipeline, so a variant that
	 * targets `glsl` needs at least one.
	 */
	readonly pipelines?: Readonly<Record<string, WgslPipeline>>;
	/** Builds of the shader by name. */
	readonly variants: Readonly<Record<string, ShaderVariantSpec>>;
}

/** A problem that stopped a compile. */
export interface ShaderProblem {
	/** The file that the problem is in, or null when it belongs to none. */
	readonly file: string | null;
	/** The 1-based line, or null when the problem has no place in the file. */
	readonly line: number | null;
	/** The 1-based column in that line, counted in characters, or null. */
	readonly column: number | null;
	/** The WGSL language feature that the problem is about, or null. */
	readonly feature: string | null;
	/** What is wrong and how to fix it. */
	readonly message: string;
	/** The variants that have the problem. */
	readonly variants: readonly string[];
}

/**
 * The result of a compile: each variant by name, or the problems that stopped it. A compile that
 * succeeds also gives its warnings: calls that a target browser cannot compile.
 */
export type CompileResult =
	| {
			readonly ok: true;
			readonly variants: Readonly<Record<string, ShaderVariant>>;
			readonly warnings: readonly ShaderProblem[];
	  }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

/**
 * Compiles every variant of a shader with the engine's shader library. The same problem in
 * several variants comes once, with each variant's name.
 */
export function compileShader(shader: ShaderSource): CompileResult {
	return shaderResult(call<Record<string, ShaderVariant>>('compile', shader));
}

/** A shader compile's result from the module's response. */
export function shaderResult(response: Response<Record<string, ShaderVariant>>): CompileResult {
	return response.ok
		? { ok: true, variants: response.output, warnings: response.warnings ?? [] }
		: response;
}

/** The WGSL of a custom material: functions that the engine's standard material calls. */
export interface MaterialSource {
	/** The file that the WGSL comes from, as problems name it. */
	readonly path: string;
	/** The WGSL, which declares `fn surface`, `struct Uniforms`, and anything they use. */
	readonly source: string;
	/**
	 * The share of the material's builds to make, for one of `count` threads that build the
	 * material together, or every build without it. `joinShares` joins the shares' results.
	 */
	readonly share?: { readonly index: number; readonly count: number };
}

/** A custom material, built into every variant of the engine's standard material. */
export interface MaterialBuild {
	/** The functions that the WGSL declares for the engine to call, such as `surface`. */
	readonly functions: readonly string[];
	/** The fields of the WGSL's `struct Uniforms`, where the engine writes each. */
	readonly uniforms: readonly CompiledUniform[];
	/** The textures that the WGSL declares, where the engine writes the layer of each. */
	readonly textures: readonly CompiledTexture[];
	/** The standard material's variants with the WGSL's functions, or a full shader's, by name. */
	readonly variants: Readonly<Record<string, ShaderVariant>>;
	/** The vertex shader locations that the vertex stage reads from a mesh's vertices. */
	readonly locations: readonly number[];
	/** The optional vertex attributes that those locations read, as the engine's format bits. */
	readonly attributes: number;
	/** True when the shader reads the material's base color and opacity, as the template does. */
	readonly baseColor: boolean;
}

/** The result of a custom material's compile, with its warnings when it succeeds. */
export type MaterialResult =
	| {
			readonly ok: true;
			readonly material: MaterialBuild;
			readonly warnings: readonly ShaderProblem[];
	  }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

/**
 * Builds a custom material's WGSL into every variant of the engine's standard material, which
 * then calls its functions. Problems in the WGSL name its own lines.
 */
export function compileMaterial(material: MaterialSource): MaterialResult {
	return materialResult(call<MaterialBuild>('compile_material', material));
}

/** A custom material's result from the module's response. */
export function materialResult(response: Response<MaterialBuild>): MaterialResult {
	return response.ok
		? { ok: true, material: response.output, warnings: response.warnings ?? [] }
		: response;
}

/** A custom effect or tone curve, built into the engine's effect template or its final pass. */
export interface EffectBuild {
	/** The function that the WGSL declares: `effect` or `toneCurve`. */
	readonly function: 'effect' | 'toneCurve';
	/** The fields of the WGSL's `struct Uniforms`, where the engine writes each. */
	readonly uniforms: readonly CompiledUniform[];
	/** True when the effect reads the scene's depth. */
	readonly depth: boolean;
	/** The template's variants with the WGSL, by name. */
	readonly variants: Readonly<Record<string, ShaderVariant>>;
}

/** The result of a custom effect's or tone curve's compile, with its warnings when it succeeds. */
export type EffectResult =
	| {
			readonly ok: true;
			readonly effect: EffectBuild;
			readonly warnings: readonly ShaderProblem[];
	  }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

/**
 * Builds a custom effect's WGSL into every variant of the engine's effect template, or a custom
 * tone curve's into every variant of its final pass. Problems in the WGSL name its own lines.
 */
export function compileEffect(effect: MaterialSource): EffectResult {
	return effectResult(call<EffectBuild>('compile_effect', effect));
}

/** A custom effect's or tone curve's result from the module's response. */
export function effectResult(response: Response<EffectBuild>): EffectResult {
	return response.ok
		? { ok: true, effect: response.output, warnings: response.warnings ?? [] }
		: response;
}

/**
 * The result of a custom material from the results of its shares: every build, by name in the
 * order that the compiler gives them, with every warning, or every problem of every share. Each
 * problem and warning comes once, with every build that has it.
 */
export function joinShares(shares: readonly MaterialResult[]): MaterialResult {
	const problems = new Map<string, ShaderProblem>();
	const warnings = new Map<string, ShaderProblem>();
	const builds: MaterialBuild[] = [];
	for (const share of shares) {
		if (share.ok) {
			builds.push(share.material);
			addOnce(warnings, share.warnings);
		} else {
			addOnce(problems, share.problems);
		}
	}
	const [first] = builds;
	if (problems.size > 0 || !first) return { ok: false, problems: [...problems.values()] };
	const all = Object.assign({}, ...builds.map((build) => build.variants));
	const variants: Record<string, ShaderVariant> = {};
	// The compiler's builds come in the byte order of their names, as Rust's sorted map gives them.
	for (const name of Object.keys(all).sort()) variants[name] = all[name];
	return { ok: true, material: { ...first, variants }, warnings: [...warnings.values()] };
}

/** Adds problems to a map of them, each once with the builds of every copy, sorted. */
function addOnce(known: Map<string, ShaderProblem>, problems: readonly ShaderProblem[]): void {
	for (const problem of problems) {
		const { file, line, column, feature, message } = problem;
		const key = JSON.stringify([file, line, column, feature, message]);
		const before = known.get(key);
		const variants = before ? [...new Set([...before.variants, ...problem.variants])] : [];
		known.set(key, before ? { ...before, variants: variants.sort() } : problem);
	}
}

/**
 * Compiles shaders and custom materials: on this thread, which waits for each compile, or on worker
 * threads, while this thread goes on.
 */
export interface ShaderCompiler {
	shader(shader: ShaderSource): Promise<CompileResult>;
	material(material: MaterialSource): Promise<MaterialResult>;
	effect(effect: MaterialSource): Promise<EffectResult>;
}

/** Compiles on this thread. */
export const compileHere: ShaderCompiler = {
	shader: async (shader) => compileShader(shader),
	material: async (material) => compileMaterial(material),
	effect: async (effect) => compileEffect(effect),
};

/** A shader manifest and every WGSL file beside it, as `bun run shaders` reads them. */
export interface ShaderBuildInputs {
	/** The manifest's text. */
	readonly manifest: string;
	/** Each WGSL file by path in the shader folder. The library modules are the files in `lib/`. */
	readonly files: Readonly<Record<string, string>>;
}

/** Every variant of every shader in a manifest. */
export interface ShaderBuildOutput {
	/** Variants by shader name, then by variant name. */
	readonly shaders: Readonly<Record<string, Readonly<Record<string, ShaderVariant>>>>;
	/** Pipeline names by shader name, sorted. */
	readonly pipelines: Readonly<Record<string, readonly string[]>>;
}

/** The result of a manifest build. */
export type ShaderBuildResult =
	| { readonly ok: true; readonly output: ShaderBuildOutput }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

/** Builds every variant in a shader manifest, as the native `bun run shaders` does. */
export function buildShaders(inputs: ShaderBuildInputs): ShaderBuildResult {
	return call<ShaderBuildOutput>('build', inputs);
}

/**
 * The module's response to a call: its output, or the problems that stopped the call. The calls
 * that compile users' shaders add their warnings when they have any.
 */
export type Response<T> =
	| { readonly ok: true; readonly output: T; readonly warnings?: readonly ShaderProblem[] }
	| {
			readonly ok: false;
			readonly problems: readonly ShaderProblem[];
			readonly warnings?: readonly ShaderProblem[];
	  };

/** The name of one of the module's exports that takes a request. */
export type CallName = 'compile' | 'compile_material' | 'compile_effect' | 'build';

let compiled: WebAssembly.Module | undefined;
let calls: CompilerCalls | undefined;

/**
 * The compiled module, from the file that `bun run build` writes. The first call compiles it, and
 * throws when the file is missing.
 */
export function compilerModule(): WebAssembly.Module {
	if (compiled) return compiled;
	// A copy of the file's bytes, in memory of its own that WebAssembly accepts under every lib.
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		bytes = new Uint8Array(readFileSync(SHADER_COMPILER_URL));
	} catch {
		throw new Error(
			`null3D: the shader compiler is missing from ${fileURLToPath(SHADER_COMPILER_URL)}. Reinstall @null3d/vite-plugin; in a copy of the engine's source, run bun run build first.`,
		);
	}
	compiled = new WebAssembly.Module(bytes);
	return compiled;
}

/** Runs one export on a request on this thread. The first call compiles the module. */
function call<T>(name: CallName, request: unknown): Response<T> {
	calls ??= new CompilerCalls(compilerModule());
	return JSON.parse(calls.call(name, JSON.stringify(request)));
}
