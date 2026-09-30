// Programs of the WebGL2 backend. Each render pipeline draws with a GLSL program that the shader
// build translated from WGSL. A program compiles when the first pipeline of its template and
// permutation is created, and pipelines for other vertex formats share it, because WebGL2 keeps a
// mesh's vertex layout in its vertex array, not in the program. Its link result is read only when
// it is first drawn with, so the driver can compile a frame's programs in parallel. Only
// development builds define the template of the debug lines, so release builds hold none of it.

import {
	PERMUTATION_DRAW_INDEX,
	TEMPLATE_DEBUG_LINES,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_TEXCOORDS,
	TEMPLATE_INSTANCED_UNLIT,
} from '../../generated/gpu';
import {
	DEBUG_LINES_SHADER,
	DEPTH_MAPPING_UNIFORM,
	type GlslProgram,
	type GlslStage,
	MESH_SHADER,
} from '../../generated/shaders';
import { DEV } from '../dev';
import { LINE_VERTICES } from '../line-vertices';
import type { DepthSetup } from './depth';

/** Texture units and uniform block binding points of each bind group: one per binding. */
export const SLOTS_PER_GROUP = 4;
/** The sampler slot of a texture that a shader reads with `texelFetch`, which needs no sampler. */
export const NO_SAMPLER = -1;

/**
 * The GLSL programs of a render pipeline template: the plain one, and the one that reads the draw
 * index of `WEBGL_multi_draw` where the template has it.
 */
export interface GlslTemplate {
	readonly plain: GlslProgram;
	readonly multiDraw?: GlslProgram;
	/**
	 * For a template that draws from a vertex buffer of its own, not from a mesh: the layout of the
	 * buffer in slot 0, as WebGPU describes it.
	 */
	readonly vertices?: GPUVertexBufferLayout;
}

/** A linked, or linking, program, which every pipeline of its template and permutation shares. */
export interface Program {
	readonly program: WebGLProgram;
	readonly source: GlslProgram;
	readonly shaders: readonly WebGLShader[];
	/** The location of naga's first-instance uniform, when the vertex shader has one. */
	firstInstance: WebGLUniformLocation | null;
	firstInstanceValue: number;
	/**
	 * Pairs of a texture unit that the program reads and the slot of the sampler it reads that
	 * unit with, or `NO_SAMPLER`. GLSL joins each texture with its sampler, so the backend binds
	 * the sampler of each pair to the pair's unit.
	 */
	samplerUnits: readonly number[];
	/** True once the link result was checked and the blocks and textures were bound. */
	ready: boolean;
}

/** A render pipeline: its program, and the fixed-function state and vertex format it asks for. */
export interface Pipeline {
	readonly program: Program;
	readonly cullNone: boolean;
	readonly depth: boolean;
	/** The vertex format of the meshes it draws, which places their attributes in vertex arrays. */
	readonly vertexFormat: number;
	/** The primitive that its draws make: GL's `TRIANGLES`, or `LINES`. */
	readonly mode: number;
	/** The layout of its template's own vertex buffer, for a template that draws no mesh. */
	readonly vertices: GPUVertexBufferLayout | undefined;
}

/** The mesh template of one pipeline of the mesh shader, plain and for multi-draw. */
function meshTemplate(pipeline: 'lit' | 'unlit' | 'texcoords'): GlslTemplate {
	const plain = MESH_SHADER.webgl2.glsl;
	const multiDraw = MESH_SHADER.webgl2_multi_draw.glsl;
	if (!plain || !multiDraw) throw new Error('the mesh shader has no WebGL2 build');
	return { plain: plain[pipeline], multiDraw: multiDraw[pipeline] };
}

/** The debug lines' template: one program, which reads its vertices from the lines' own buffer. */
function linesTemplate(): GlslTemplate {
	const glsl = DEBUG_LINES_SHADER.webgl2.glsl;
	if (!glsl) throw new Error('the debug lines shader has no WebGL2 build');
	return { plain: glsl.main, vertices: LINE_VERTICES };
}

/** The engine's render pipeline templates, by template id. */
export function engineTemplates(): (GlslTemplate | undefined)[] {
	const templates: (GlslTemplate | undefined)[] = [];
	templates[TEMPLATE_INSTANCED_LIT] = meshTemplate('lit');
	templates[TEMPLATE_INSTANCED_UNLIT] = meshTemplate('unlit');
	templates[TEMPLATE_INSTANCED_TEXCOORDS] = meshTemplate('texcoords');
	if (DEV) templates[TEMPLATE_DEBUG_LINES] = linesTemplate();
	return templates;
}

function compile(gl: WebGL2RenderingContext, type: number, stage: GlslStage): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('WebGL2 could not create a shader');
	gl.shaderSource(shader, stage.source);
	gl.compileShader(shader);
	return shader;
}

/** Starts compiling and linking a template's program, without waiting for the result. */
export function createProgram(
	gl: WebGL2RenderingContext,
	template: GlslTemplate,
	permutation: number,
): Program {
	const source = permutation & PERMUTATION_DRAW_INDEX ? template.multiDraw : template.plain;
	if (!source) throw new Error('this render pipeline template has no multi-draw variant');
	const program = gl.createProgram();
	if (!program) throw new Error('WebGL2 could not create a program');
	const shaders = [
		compile(gl, gl.VERTEX_SHADER, source.vertex),
		compile(gl, gl.FRAGMENT_SHADER, source.fragment),
	];
	for (const shader of shaders) gl.attachShader(program, shader);
	gl.linkProgram(program);
	return {
		program,
		source,
		shaders,
		firstInstance: null,
		firstInstanceValue: 0,
		samplerUnits: [],
		ready: false,
	};
}

/**
 * Checks the program's link result, binds its uniform blocks and textures to the slots of their
 * WGSL groups and bindings, and sets its vertex shader's depth mapping for the backend's depth mode,
 * once, at its first use. The program is in use afterwards.
 */
export function prepareProgram(gl: WebGL2RenderingContext, p: Program, depth: DepthSetup): void {
	if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) {
		const logs = p.shaders
			.map((shader) => gl.getShaderInfoLog(shader))
			.filter((log) => log)
			.join('\n');
		throw new Error(`a WebGL2 program failed to link: ${gl.getProgramInfoLog(p.program)}\n${logs}`);
	}
	for (const shader of p.shaders) {
		gl.detachShader(p.program, shader);
		gl.deleteShader(shader);
	}
	gl.useProgram(p.program);
	const samplerUnits: number[] = [];
	for (const stage of [p.source.vertex, p.source.fragment]) {
		for (const block of stage.uniformBlocks) {
			const index = gl.getUniformBlockIndex(p.program, block.name);
			if (index !== gl.INVALID_INDEX)
				gl.uniformBlockBinding(p.program, index, block.group * SLOTS_PER_GROUP + block.binding);
		}
		for (const texture of stage.textures) {
			const unit = texture.group * SLOTS_PER_GROUP + texture.binding;
			const location = gl.getUniformLocation(p.program, texture.name);
			if (location) gl.uniform1i(location, unit);
			const sampler = texture.sampler;
			const slot = sampler ? sampler.group * SLOTS_PER_GROUP + sampler.binding : NO_SAMPLER;
			let known = -1;
			for (let k = 0; k < samplerUnits.length; k += 2) if (samplerUnits[k] === unit) known = k;
			if (known < 0) {
				samplerUnits.push(unit, slot);
			} else if (samplerUnits[known + 1] !== slot) {
				throw new Error('a WebGL2 program samples one texture with two samplers');
			}
		}
	}
	p.samplerUnits = samplerUnits;
	p.firstInstance = gl.getUniformLocation(p.program, 'naga_vs_first_instance');
	const mapping = gl.getUniformLocation(p.program, DEPTH_MAPPING_UNIFORM);
	if (mapping) gl.uniform2f(mapping, depth.scale, depth.offset);
	p.ready = true;
}
