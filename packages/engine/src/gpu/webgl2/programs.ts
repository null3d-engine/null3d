// Programs of the WebGL2 backend. Each render pipeline is a GLSL program that the shader build
// translated from WGSL. A program compiles when its pipeline is created, and its link result is
// read only when it is first drawn with, so the driver can compile a frame's programs in parallel.

import {
	FORMAT_NONE,
	PERMUTATION_DRAW_INDEX,
	STATE_CULL_NONE,
	TEMPLATE_INSTANCED_LIT,
	TEMPLATE_INSTANCED_UNLIT,
} from '../../generated/gpu';
import { type GlslProgram, type GlslStage, SHADERS } from '../../generated/shaders';

/** Texture units and uniform block binding points of each bind group: one per binding. */
export const SLOTS_PER_GROUP = 4;

/** A linked, or linking, program and the fixed-function state its pipeline asks for. */
export interface Program {
	readonly program: WebGLProgram;
	readonly source: GlslProgram;
	readonly shaders: readonly WebGLShader[];
	readonly cullNone: boolean;
	readonly depth: boolean;
	/** The location of naga's first-instance uniform, when the vertex shader has one. */
	firstInstance: WebGLUniformLocation | null;
	firstInstanceValue: number;
	/** True once the link result was checked and the blocks and textures were bound. */
	ready: boolean;
}

/** The GLSL of a pipeline template, in the variant its permutation bits pick. */
function glslOf(template: number, permutation: number): GlslProgram {
	const variant =
		permutation & PERMUTATION_DRAW_INDEX ? SHADERS.mesh.webgl2_multi_draw : SHADERS.mesh.webgl2;
	if (!variant.glsl) throw new Error('the mesh shader has no WebGL2 build');
	if (template === TEMPLATE_INSTANCED_LIT) return variant.glsl.lit;
	if (template === TEMPLATE_INSTANCED_UNLIT) return variant.glsl.unlit;
	throw new Error(`the WebGL2 backend has no render pipeline template ${template}`);
}

function compile(gl: WebGL2RenderingContext, type: number, stage: GlslStage): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('WebGL2 could not create a shader');
	gl.shaderSource(shader, stage.source);
	gl.compileShader(shader);
	return shader;
}

/** Starts compiling and linking the program of a pipeline, without waiting for the result. */
export function createProgram(
	gl: WebGL2RenderingContext,
	template: number,
	permutation: number,
	depthFormat: number,
	stateFlags: number,
): Program {
	const source = glslOf(template, permutation);
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
		cullNone: (stateFlags & STATE_CULL_NONE) !== 0,
		depth: depthFormat !== FORMAT_NONE,
		firstInstance: null,
		firstInstanceValue: 0,
		ready: false,
	};
}

/**
 * Checks the program's link result and binds its uniform blocks and textures to the slots of their
 * WGSL groups and bindings, once, at its first use. The program is in use afterwards.
 */
export function prepareProgram(gl: WebGL2RenderingContext, p: Program): void {
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
	for (const stage of [p.source.vertex, p.source.fragment]) {
		for (const block of stage.uniformBlocks) {
			const index = gl.getUniformBlockIndex(p.program, block.name);
			if (index !== gl.INVALID_INDEX)
				gl.uniformBlockBinding(p.program, index, block.group * SLOTS_PER_GROUP + block.binding);
		}
		for (const texture of stage.textures) {
			const location = gl.getUniformLocation(p.program, texture.name);
			if (location) gl.uniform1i(location, texture.group * SLOTS_PER_GROUP + texture.binding);
		}
	}
	p.firstInstance = gl.getUniformLocation(p.program, 'naga_vs_first_instance');
	p.ready = true;
}
