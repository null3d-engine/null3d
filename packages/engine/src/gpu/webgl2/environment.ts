// Environment maps made on WebGL2 (D-19), which the thread that draws loads with the first
// generator that a sketch asks for: the built-in room, or a panorama from an HDR file. Each step of environment-steps.ts draws a level's six faces,
// side by side, into an RGBA8 texture, as shared-exponent texels packed into its bytes. A pixel
// pack buffer then takes the bytes, and the same buffer unpacks each face's part into its face of
// the level of an RGB9_E5 cube texture: WebGL2 renders into no shared-exponent format, and the copy
// stays on the GPU. This path needs no float render target, so every device takes it (D-66). One
// call runs every step, before the frame's passes, so the map is whole before any frame reads it.
// Each step waits for the GPU between the pack and the unpack: Firefox on the Mac fills the pixel
// pack buffer late, and an unpack that does not wait reads the bytes that the buffer held before.
// The GL objects of a map go at the end of the call; the programs and the sampler stay for the
// next map in the context.

import type { ShaderVariant } from '../../generated/shaders';
import type { GeneratorSource } from '../../shared/images';
import {
	chainLevels,
	environmentSteps,
	STEP_BYTES,
	type Step,
	type StepSource,
	type StepTexture,
} from '../environment-steps';
import type { ProgramHost } from './programs';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/**
 * Hears each of the map's own levels once its texels are in the pixel pack buffer, which is bound
 * then, before they go into the cube: for tests, which read the bytes back. Each row holds the six
 * faces' rows side by side, `size` texels each.
 */
export type LevelRead = (level: number, size: number) => void;

/** A generator that fills every level of every face of a cube texture on the GPU. */
export interface CubeGenerator {
	/**
	 * Compiles the context's programs in the background where the context can, so that the map
	 * waits for no compile. A map in a context that has none compiles them at once.
	 */
	prepare(host: ProgramHost): Promise<void>;
	/**
	 * Fills every level of every face of an RGB9_E5 cube texture, `size` texels wide with `levels`
	 * levels, from `source`. It changes the context's bindings, which the caller sets again: the
	 * program, the active texture unit with its texture and sampler, the panorama's unit and its
	 * sampler, uniform block binding 0, the framebuffer, the pixel pack and unpack buffers, and the
	 * viewport. It leaves no vertex array, framebuffer, pixel buffer, texture or sampler bound.
	 */
	run(
		host: ProgramHost,
		target: WebGLTexture,
		size: number,
		levels: number,
		source: GeneratorSource,
		read?: LevelRead,
	): void;
}

/**
 * What a context keeps between maps: the programs, and the samplers of the cube textures and of
 * the panorama.
 */
interface Kept {
	programs: Record<Pipeline, WebGLProgram>;
	samplers: Samplers;
	/**
	 * The texture units that the programs read: the cube source's, which every program that reads
	 * a cube shares (the trace reads none), and the panorama's, which can be the same unit.
	 */
	units: Units;
}

interface Samplers {
	cube: WebGLSampler;
	panorama: WebGLSampler;
}

interface Units {
	cube: number;
	panorama: number;
}

/** The texture units from which the programs read the cube source and the panorama. */
function unitsOf(host: ProgramHost, programs: Record<Pipeline, WebGLProgram>): Units {
	return { cube: host.unit(programs.blur, 0, 1), panorama: host.unit(programs.panorama, 0, 3) };
}

/** The generator of environment maps, from the environment shader's GLSL build. */
export function environmentGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
	const variants = { webgl2: shader };
	const kept = new WeakMap<WebGL2RenderingContext, Kept>();
	const preparing = new WeakMap<WebGL2RenderingContext, Promise<void>>();
	const pipelines: Pipeline[] = ['trace', 'blur', 'half', 'prefilter', 'panorama'];
	const makeSamplers = (gl: WebGL2RenderingContext): Samplers => {
		const make = (min: number, wrapS: number) => {
			const sampler = gl.createSampler();
			if (!sampler) throw new Error('WebGL2 could not create a sampler');
			gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, min);
			gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
				gl.samplerParameteri(sampler, wrap, gl.CLAMP_TO_EDGE);
			gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrapS);
			return sampler;
		};
		return {
			cube: make(gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE),
			// The panorama wraps around across its width and stops at its top and bottom rows.
			panorama: make(gl.LINEAR, gl.REPEAT),
		};
	};
	const keep = (host: ProgramHost): Kept => {
		const { gl } = host;
		let made = kept.get(gl);
		if (made) return made;
		const programs = {} as Record<Pipeline, WebGLProgram>;
		for (const pipeline of pipelines)
			programs[pipeline] = host.program({ shader: variants, pipeline });
		made = { programs, samplers: makeSamplers(gl), units: unitsOf(host, programs) };
		kept.set(gl, made);
		return made;
	};
	const prepare = (host: ProgramHost): Promise<void> => {
		const { gl } = host;
		let ready = preparing.get(gl);
		if (!ready) {
			const programs = {} as Record<Pipeline, WebGLProgram>;
			const built = pipelines.map(async (pipeline) => {
				programs[pipeline] = await host.programLater({ shader: variants, pipeline });
			});
			ready = Promise.all(built).then(() => {
				if (!kept.has(gl))
					kept.set(gl, { programs, samplers: makeSamplers(gl), units: unitsOf(host, programs) });
			});
			preparing.set(gl, ready);
		}
		return ready;
	};
	const run: CubeGenerator['run'] = (host, target, size, levels, source, read) => {
		const { gl } = host;
		const { programs, samplers, units } = keep(host);
		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const stride = Math.ceil(STEP_BYTES / alignment) * alignment;
		const [steps, values] = environmentSteps(source, size, levels, stride);
		// The step values' uniform block binding, as the shader binds it. Each step binds its source
		// and the source's sampler on its program's unit before it draws, since the panorama's unit
		// can be the cubes' unit. The generator changes no other unit.
		const binding = host.slot(0, 0);
		const made: WebGLTexture[] = [];
		const texture = (kind: number, storage: (kind: number) => void) => {
			const t = gl.createTexture();
			if (!t) throw new Error('WebGL2 could not create a texture');
			gl.bindTexture(kind, t);
			storage(kind);
			made.push(t);
			return t;
		};
		const cube = (count: number) =>
			texture(gl.TEXTURE_CUBE_MAP, (t) => gl.texStorage2D(t, count, gl.RGB9_E5, size, size));
		let panorama: WebGLTexture | null = null;
		if (source !== 'room') {
			const { width, height, texels } = source;
			gl.activeTexture(gl.TEXTURE0 + units.panorama);
			panorama = texture(gl.TEXTURE_2D, (t) => {
				gl.texStorage2D(t, 1, gl.RGB9_E5, width, height);
				gl.texSubImage2D(t, 0, 0, 0, width, height, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, texels);
			});
		}
		gl.activeTexture(gl.TEXTURE0 + units.cube);
		const textures: Partial<Record<StepTexture, WebGLTexture>> = {
			chain: cube(chainLevels(size)),
			target,
		};
		if (source === 'room') textures.traced = cube(1);
		const sources: Partial<Record<StepSource, WebGLTexture>> = textures;
		const staging = texture(gl.TEXTURE_2D, (t) => gl.texStorage2D(t, 1, gl.RGBA8, 6 * size, size));
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
		const texels = gl.createBuffer();
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
		gl.bufferData(gl.PIXEL_PACK_BUFFER, 6 * size * size * 4, gl.STREAM_COPY);
		const uniforms = gl.createBuffer();
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, values, gl.STATIC_DRAW);
		gl.bindVertexArray(null);
		steps.forEach((step, k) => {
			gl.useProgram(programs[step.pipeline]);
			gl.bindBufferRange(gl.UNIFORM_BUFFER, binding, uniforms, k * stride, STEP_BYTES);
			if (step.source === 'panorama') {
				gl.activeTexture(gl.TEXTURE0 + units.panorama);
				gl.bindTexture(gl.TEXTURE_2D, panorama);
				gl.bindSampler(units.panorama, samplers.panorama);
			} else {
				gl.bindSampler(units.cube, samplers.cube);
				gl.bindTexture(gl.TEXTURE_CUBE_MAP, sources[step.source] as WebGLTexture);
			}
			const width = 6 * step.size;
			gl.viewport(0, 0, width, step.size);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			if (step.source === 'panorama') {
				gl.bindTexture(gl.TEXTURE_2D, null);
				gl.bindSampler(units.panorama, null);
				gl.activeTexture(gl.TEXTURE0 + units.cube);
			}
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
			gl.readPixels(0, 0, width, step.size, gl.RGBA, gl.UNSIGNED_BYTE, 0);
			gl.finish();
			if (read && step.into.includes('target')) read(step.level, step.size);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, texels);
			// Each face's part of a row starts its face's size of texels after the one before.
			gl.pixelStorei(gl.UNPACK_ROW_LENGTH, width);
			const type = gl.UNSIGNED_INT_5_9_9_9_REV;
			for (const into of step.into) {
				gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[into] as WebGLTexture);
				for (let face = 0; face < 6; face++) {
					const plane = gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
					const at = face * step.size * 4;
					gl.texSubImage2D(plane, step.level, 0, 0, step.size, step.size, gl.RGB, type, at);
				}
			}
			gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
		});
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindSampler(units.cube, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteBuffer(texels);
		gl.deleteBuffer(uniforms);
		for (const t of made) gl.deleteTexture(t);
	};
	return { prepare, run };
}
