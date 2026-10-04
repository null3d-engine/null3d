// Environment maps made on WebGL2 (D-19), which the thread that draws loads with the first
// generator that a sketch asks for. Each step of environment-steps.ts draws one face of one level
// into an RGBA8 texture, as shared-exponent texels packed into its bytes. A pixel pack buffer then
// takes the bytes, and the same buffer unpacks them into the face's level of an RGB9_E5 cube
// texture: WebGL2 renders into no shared-exponent format, and the copy stays on the GPU. The
// programs and the sampler stay for the next map in the context; everything else is deleted.

import type { ShaderVariant } from '../../generated/shaders';
import { roomSteps, STEP_BYTES, type Step, type StepTexture } from '../environment-steps';
import type { ProgramHost } from './programs';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/**
 * Hears each level of each face of the map once its texels are in the pixel pack buffer, which is
 * bound then, before they go into the cube: for tests, which read the bytes back.
 */
export type LevelRead = (face: number, level: number, size: number) => void;

/**
 * Fills every level of every face of an RGB9_E5 cube texture, `size` texels wide with `levels`
 * levels. It changes the context's bindings, which the caller sets again: the program, the active
 * texture unit with its texture and sampler, uniform block binding 0, the framebuffer, the pixel
 * pack and unpack buffers, and the viewport. It leaves no vertex array, framebuffer, pixel buffer,
 * texture or sampler bound.
 */
export type CubeGenerator = (
	host: ProgramHost,
	target: WebGLTexture,
	size: number,
	levels: number,
	read?: LevelRead,
) => void;

/** What a context keeps between maps: the programs and the sampler. */
interface Kept {
	programs: Record<Pipeline, WebGLProgram>;
	sampler: WebGLSampler;
}

/** The generator of the built-in room, from the environment shader's GLSL build. */
export function roomGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
	const variants = { webgl2: shader };
	const kept = new WeakMap<WebGL2RenderingContext, Kept>();
	const keep = (host: ProgramHost): Kept => {
		const { gl } = host;
		let made = kept.get(gl);
		if (made) return made;
		const program = (pipeline: Pipeline) => host.program({ shader: variants, pipeline });
		const programs = {
			trace: program('trace'),
			blur: program('blur'),
			half: program('half'),
			prefilter: program('prefilter'),
		};
		const sampler = gl.createSampler();
		if (!sampler) throw new Error('WebGL2 could not create a sampler');
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
			gl.samplerParameteri(sampler, wrap, gl.CLAMP_TO_EDGE);
		made = { programs, sampler };
		kept.set(gl, made);
		return made;
	};
	return (host, target, size, levels, read) => {
		const { gl } = host;
		const { programs, sampler } = keep(host);
		// The source's texture unit and the step values' uniform block binding, as the shader binds them.
		const unit = host.slot(0, 1);
		const binding = host.slot(0, 0);
		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const stride = Math.ceil(STEP_BYTES / alignment) * alignment;
		const [steps, values] = roomSteps(size, levels, stride);
		// Every texture binds on the source's unit, the only one that the generator changes.
		gl.activeTexture(gl.TEXTURE0 + unit);
		const made: WebGLTexture[] = [];
		const texture = (target: number, storage: (target: number) => void) => {
			const t = gl.createTexture();
			if (!t) throw new Error('WebGL2 could not create a texture');
			gl.bindTexture(target, t);
			storage(target);
			made.push(t);
			return t;
		};
		const cube = (levels: number) =>
			texture(gl.TEXTURE_CUBE_MAP, (t) => gl.texStorage2D(t, levels, gl.RGB9_E5, size, size));
		const traced = cube(1);
		const chain = cube(Math.log2(size) + 1);
		const textures: Record<StepTexture, WebGLTexture> = { traced, chain, target };
		const staging = texture(gl.TEXTURE_2D, (t) => gl.texStorage2D(t, 1, gl.RGBA8, size, size));
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
		const texels = gl.createBuffer();
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
		gl.bufferData(gl.PIXEL_PACK_BUFFER, size * size * 4, gl.STREAM_COPY);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		const uniforms = gl.createBuffer();
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, values, gl.STATIC_DRAW);
		gl.bindVertexArray(null);
		gl.bindSampler(unit, sampler);
		for (const [k, step] of steps.entries()) {
			const program = programs[step.pipeline];
			gl.useProgram(program);
			gl.bindBufferRange(gl.UNIFORM_BUFFER, binding, uniforms, k * stride, STEP_BYTES);
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[step.source]);
			gl.viewport(0, 0, step.size, step.size);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			// GL reads the bottom row first, which holds the face's first row of texels.
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
			gl.readPixels(0, 0, step.size, step.size, gl.RGBA, gl.UNSIGNED_BYTE, 0);
			if (read && step.into.includes('target')) read(step.face, step.level, step.size);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, texels);
			const face = gl.TEXTURE_CUBE_MAP_POSITIVE_X + step.face;
			for (const into of step.into) {
				gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[into]);
				gl.texSubImage2D(
					face,
					step.level,
					0,
					0,
					step.size,
					step.size,
					gl.RGB,
					gl.UNSIGNED_INT_5_9_9_9_REV,
					0,
				);
			}
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
		}
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindSampler(unit, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteBuffer(texels);
		gl.deleteBuffer(uniforms);
		for (const t of made) gl.deleteTexture(t);
	};
}
