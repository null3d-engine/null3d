// The shader compiler: the engine's shader build as a WebAssembly module, for build tools. It
// composes WGSL with the engine's shader library (`#import null3d::math` and the rest), checks it
// against the portable WGSL rules, and writes WGSL for WebGPU and GLSL ES 3.00 for WebGL2, with
// the reflection that the WebGL2 backend binds by. It runs in Node and Bun while a project builds,
// so pages never download a shader translator. `bun run build` builds the module from the
// `null3d-shaders-wasm` crate into this package's dist folder.
//
// The module takes and gives JSON: a call writes its request into the module's memory, runs an
// export, and reads the response. The first call loads the module; later calls reuse it, and the
// library modules it composed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where `bun run build` writes the module. */
export const SHADER_COMPILER_URL = new URL('../dist/shader-compiler.wasm', import.meta.url);

/** A language that a shader variant builds for: WGSL for WebGPU, or GLSL ES 3.00 for WebGL2. */
export type ShaderTarget = 'wgsl' | 'glsl';

/** The WGSL entry points of one render pipeline. */
export interface WgslPipeline {
	readonly vertex: string;
	readonly fragment: string;
}

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

// The records below are the ones that the engine's generated shader module declares, so the
// engine takes the compiler's output as it is.

/** The WGSL bind group and binding of a resource. */
export interface ShaderBinding {
	readonly group: number;
	readonly binding: number;
}

/** A uniform block of one GLSL shader, and the WGSL uniform buffer it stands for. */
export interface GlslUniformBlock extends ShaderBinding {
	/** The block name, for `getUniformBlockIndex`. */
	readonly name: string;
}

/** A texture uniform of one GLSL shader, which joins a WGSL texture and its sampler. */
export interface GlslTexture extends ShaderBinding {
	/** The uniform name, for `getUniformLocation`. */
	readonly name: string;
	/** The sampler that the shader samples the texture with, or null when it only loads texels. */
	readonly sampler: ShaderBinding | null;
}

/** One GLSL ES 3.00 shader, and the names that its resources have in it. */
export interface GlslStage {
	readonly source: string;
	readonly uniformBlocks: readonly GlslUniformBlock[];
	readonly textures: readonly GlslTexture[];
}

/** The shaders of one render pipeline, to link into one WebGL2 program. */
export interface GlslProgram {
	readonly vertex: GlslStage;
	readonly fragment: GlslStage;
}

/** One WGSL module for WebGPU, and the entry points of its render pipelines. */
export interface WgslShader<Pipeline extends string = string> {
	readonly source: string;
	readonly pipelines: Readonly<Record<Pipeline, WgslPipeline>>;
}

/** One variant of a shader, with its output for each backend it targets. */
export interface ShaderVariant<Pipeline extends string = string> {
	/**
	 * The permutation bits that the variant was built with, as a render pipeline's permutation
	 * word holds them: 0 for a variant without permutation bits.
	 */
	readonly permutation: number;
	/** WGSL for WebGPU, or null when the variant does not target WebGPU. */
	readonly wgsl: WgslShader<Pipeline> | null;
	/** GLSL programs for WebGL2 by pipeline, or null when the variant does not target WebGL2. */
	readonly glsl: Readonly<Record<Pipeline, GlslProgram>> | null;
}

/** The result of a compile: each variant by name, or the problems that stopped it. */
export type CompileResult =
	| { readonly ok: true; readonly variants: Readonly<Record<string, ShaderVariant>> }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

/**
 * Compiles every variant of a shader with the engine's shader library. The same problem in
 * several variants comes once, with each variant's name.
 */
export function compileShader(shader: ShaderSource): CompileResult {
	const response = call<Record<string, ShaderVariant>>('compile', shader);
	return response.ok ? { ok: true, variants: response.output } : response;
}

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

/** The module's exports. */
interface Exports {
	readonly memory: WebAssembly.Memory;
	request(length: number): number;
	compile(): void;
	build(): void;
	response(): number;
	response_length(): number;
}

type Response<T> =
	| { readonly ok: true; readonly output: T }
	| { readonly ok: false; readonly problems: readonly ShaderProblem[] };

let compiled: WebAssembly.Module | undefined;
let instance: Exports | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function loadModule(): WebAssembly.Module {
	let bytes: Buffer;
	try {
		bytes = readFileSync(SHADER_COMPILER_URL);
	} catch {
		throw new Error(
			`null3D: the shader compiler is missing from ${fileURLToPath(SHADER_COMPILER_URL)}. Reinstall @null3d/vite-plugin; in a copy of the engine's source, run bun run build first.`,
		);
	}
	return new WebAssembly.Module(bytes);
}

/** Runs one export on a request. The first call compiles the module. */
function call<T>(name: 'compile' | 'build', request: unknown): Response<T> {
	compiled ??= loadModule();
	instance ??= new WebAssembly.Instance(compiled).exports as unknown as Exports;
	const wasm = instance;
	const bytes = encoder.encode(JSON.stringify(request));
	// Making room can grow the memory, which replaces its buffer, so the view comes after.
	const at = wasm.request(bytes.length);
	new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
	let stopped: unknown;
	try {
		wasm[name]();
	} catch (error) {
		// A call that stops part way can leave the instance in any state, so the next call makes a
		// new instance. A panic has written its own response first.
		instance = undefined;
		stopped = error;
	}
	const length = wasm.response_length();
	if (length === 0) {
		const problem: ShaderProblem = {
			file: null,
			line: null,
			column: null,
			feature: null,
			message: `the shader compiler stopped on an internal error, which is a bug in null3D: ${String(stopped)}. Report it with the shader that caused it.`,
			variants: [],
		};
		return { ok: false, problems: [problem] };
	}
	return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.response(), length)));
}
