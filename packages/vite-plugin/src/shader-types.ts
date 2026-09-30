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
	/** WGSL for WebGPU, or null when the variant does not target WebGPU. */
	readonly wgsl: WgslShader<Pipeline> | null;
	/** GLSL programs for WebGL2 by pipeline, or null when the variant does not target WebGL2. */
	readonly glsl: Readonly<Record<Pipeline, GlslProgram>> | null;
}

/**
 * WGSL from a project's modules, compiled by the null3D Vite plugin: a `.wgsl` file that a module
 * imports, or a template literal that a `wgsl` block comment tags. The shader has one render
 * pipeline for each `@fragment` entry point, named after it, with the shader's `@vertex` entry
 * point.
 */
export interface CompiledShader {
	/** The shader for WebGPU, with every `#import null3d::...` resolved. */
	readonly webgpu: ShaderVariant;
	/**
	 * The shader for WebGL2, compiled with the shader def `WEBGL2`: one GLSL ES 3.00 program for
	 * each render pipeline. Null when the shader has only compute entry points.
	 */
	readonly webgl2: ShaderVariant | null;
}
