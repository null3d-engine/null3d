// The records of a compiled shader. The engine's generated shader module declares the same
// records, so the engine takes the shader compiler's output as it is. This file imports nothing,
// so the types of `.wgsl` imports in `client.d.ts` hold in projects for browsers too.

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

/** The WGSL entry points of one render pipeline. */
export interface WgslPipeline {
	readonly vertex: string;
	readonly fragment: string;
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

/**
 * WGSL from a project's modules, compiled by the null3D Vite plugin: a `.wgsl` file that a module
 * imports, or a template literal that a `wgsl` block comment tags. WGSL with entry points is a
 * whole shader. WGSL without entry points holds the functions of a custom material, the function
 * of a custom effect, or a custom tone curve.
 */
export type CompiledWgsl = CompiledShader | CompiledMaterial | CompiledEffect | CompiledToneCurve;

/**
 * A whole shader from a project's modules. It has one render pipeline for each `@fragment` entry
 * point, named after it, with the shader's `@vertex` entry point.
 */
export interface CompiledShader {
	/** Marks a whole shader. */
	readonly kind: 'shader';
	/** The shader for WebGPU, with every `#import null3d::...` resolved. */
	readonly webgpu: ShaderVariant;
	/**
	 * The shader for WebGL2, compiled with the shader def `WEBGL2`: one GLSL ES 3.00 program for
	 * each render pipeline. Null when the shader has only compute entry points.
	 */
	readonly webgl2: ShaderVariant | null;
}

/** A type that a uniform of a custom material can have, as a field of its `struct Uniforms`. */
export type UniformType = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'vec4f';

/** A uniform of a custom material, and where the engine writes its value. */
export interface CompiledUniform<
	Name extends string = string,
	Type extends UniformType = UniformType,
> {
	/** The field's name, which `set()` and the `uniforms` option take. */
	readonly name: Name;
	/** The field's type. */
	readonly type: Type;
	/** The float of the material's row of custom values where the uniform starts. */
	readonly offset: number;
}

/** A texture of a custom material, and where the engine writes its layer. */
export interface CompiledTexture<Name extends string = string> {
	/** The variable's name, which the `textures` option takes. */
	readonly name: Name;
	/** The float of the material's row of custom values that holds the texture's layer. */
	readonly offset: number;
}

/**
 * A custom material from a project's modules, which `materials.shader` draws with: functions such
 * as `fn surface`, built into every variant of the engine's standard material, or a full shader,
 * whose `@vertex` entry point takes an `InstanceIn` from `null3d::mesh`. `Uniforms` gives each
 * uniform's type by name, and `Textures` the names of its textures, as the declaration that the
 * plugin writes beside a `.wgsl` file does, so that `materials.shader` checks the names and values
 * of its `uniforms` and `textures` options and of `set()`.
 */
export interface CompiledMaterial<
	Uniforms extends Readonly<Record<string, UniformType>> = Readonly<Record<string, UniformType>>,
	Textures extends string = string,
> {
	/** Marks the WGSL of a custom material. */
	readonly kind: 'material';
	/** The functions that the WGSL declares for the engine to call, such as `surface`. */
	readonly functions: readonly string[];
	/** The fields of the WGSL's `struct Uniforms`, in order. */
	readonly uniforms: readonly {
		readonly [Name in keyof Uniforms & string]: CompiledUniform<Name, Uniforms[Name]>;
	}[keyof Uniforms & string][];
	/** The textures that the WGSL declares as `var name: texture_2d<f32>;`, in order. */
	readonly textures: readonly CompiledTexture<Textures>[];
	/** The standard material's variants with the WGSL's functions, or a full shader's, by name. */
	readonly variants: Readonly<Record<string, ShaderVariant>>;
	/** The vertex shader locations that the vertex stage reads from a mesh's vertices. */
	readonly locations: readonly number[];
	/** The optional vertex attributes that those locations read, as the engine's format bits. */
	readonly attributes: number;
	/** True when the shader reads the material's base color and opacity, as the template does. */
	readonly baseColor: boolean;
}

/**
 * A custom effect from a project's modules, which `post.addEffect` draws with: WGSL that declares
 * `fn effect(input: EffectInput) -> vec4f`, built into every variant of the engine's effect
 * template. `Uniforms` gives each uniform's type by name, as the declaration that the plugin writes
 * beside a `.wgsl` file does, so that `post.addEffect` and `post.setEffectUniform` check the names
 * and values of the uniforms.
 */
export interface CompiledEffect<
	Uniforms extends Readonly<Record<string, UniformType>> = Readonly<Record<string, UniformType>>,
> {
	/** Marks the WGSL of a custom effect. */
	readonly kind: 'effect';
	/** The fields of the WGSL's `struct Uniforms`, in order. */
	readonly uniforms: readonly {
		readonly [Name in keyof Uniforms & string]: CompiledUniform<Name, Uniforms[Name]>;
	}[keyof Uniforms & string][];
	/** True when the effect reads the scene's depth. */
	readonly depth: boolean;
	/** The effect template's variants with the WGSL, by name. */
	readonly variants: Readonly<Record<string, ShaderVariant>>;
}

/**
 * A custom tone curve from a project's modules, which `post.set({ toneMapping })` takes: WGSL that
 * declares `fn toneCurve(color: vec3f) -> vec3f`, built into every variant of the engine's final
 * pass.
 */
export interface CompiledToneCurve {
	/** Marks the WGSL of a custom tone curve. */
	readonly kind: 'toneCurve';
	/** The final pass's variants with the WGSL, by name. */
	readonly variants: Readonly<Record<string, ShaderVariant>>;
}
