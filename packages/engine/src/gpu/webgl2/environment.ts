// Environment maps made on WebGL2 (D-19), which the thread that draws loads with the first
// generator that a sketch asks for. Each band of environment-steps.ts draws rows of a level's six
// faces, side by side, into an RGBA8 texture, as shared-exponent texels packed into its bytes. A
// pixel pack buffer then takes the bytes, and the same buffer unpacks each face's part into its face
// of the level of an RGB9_E5 cube texture: WebGL2 renders into no shared-exponent format, and the
// copy stays on the GPU. The
// textures and buffers of a map last from its first slice to its last. The programs and the
// sampler stay for the next map in the context.

import type { ShaderVariant } from '../../generated/shaders';
import {
	type Band,
	roomSteps,
	STEP_BYTES,
	type Step,
	type StepTexture,
	sliceBands,
} from '../environment-steps';
import type { ProgramHost } from './programs';

/** The environment shader's render pipelines. */
type Pipeline = Step['pipeline'];

/**
 * Hears each band of rows of the map's own levels once its texels are in the pixel pack buffer,
 * which is bound then, before they go into the cube: for tests, which read the bytes back. Each
 * row holds the six faces' rows side by side, `size` texels each.
 */
export type BandRead = (level: number, y: number, rows: number, size: number) => void;

/** A generator that fills every level of every face of a cube texture on the GPU. */
export interface CubeGenerator {
	/**
	 * Compiles the context's programs in the background where the context can, so that the first
	 * slice waits for no compile. A slice in a context that has none compiles them at once.
	 */
	prepare(host: ProgramHost): Promise<void>;
	/**
	 * Runs slice `slice` of `slices` of the work that fills an RGB9_E5 cube texture, `size` texels
	 * wide with `levels` levels. Slice 0 starts the map. A slice that comes before the slices ahead
	 * of it ran runs them first, and a slice of a map that is done does nothing. A slice changes the
	 * context's bindings, which the caller sets again: the program, the active texture unit with its
	 * texture and sampler, uniform block binding 0, the framebuffer, the pixel pack and unpack
	 * buffers, and the viewport. It leaves no vertex array, framebuffer, pixel buffer, texture or
	 * sampler bound.
	 */
	run(
		host: ProgramHost,
		target: WebGLTexture,
		size: number,
		levels: number,
		slice: number,
		slices: number,
		read?: BandRead,
	): void;
}

/** What a context keeps between maps: the programs and the sampler. */
interface Kept {
	programs: Record<Pipeline, WebGLProgram>;
	sampler: WebGLSampler;
	/** The texture unit of the source. Each program reads only the source, so all share it. */
	unit: number;
}

/** A map on its way: its steps, the slices' bands, its own GL objects, and the next slice. */
interface Making {
	steps: Step[];
	plan: Band[][];
	stride: number;
	textures: Record<StepTexture, WebGLTexture>;
	framebuffer: WebGLFramebuffer | null;
	texels: WebGLBuffer | null;
	uniforms: WebGLBuffer | null;
	/** The textures that the map made, which go with its last slice. */
	made: WebGLTexture[];
	next: number;
}

/** The generator of the built-in room, from the environment shader's GLSL build. */
export function roomGenerator(shader: ShaderVariant<Pipeline>): CubeGenerator {
	const variants = { webgl2: shader };
	const kept = new WeakMap<WebGL2RenderingContext, Kept>();
	const making = new WeakMap<WebGLTexture, Making>();
	const done = new WeakSet<WebGLTexture>();
	const preparing = new WeakMap<WebGL2RenderingContext, Promise<void>>();
	const pipelines: Pipeline[] = ['trace', 'blur', 'half', 'prefilter'];
	const makeSampler = (gl: WebGL2RenderingContext) => {
		const sampler = gl.createSampler();
		if (!sampler) throw new Error('WebGL2 could not create a sampler');
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
			gl.samplerParameteri(sampler, wrap, gl.CLAMP_TO_EDGE);
		return sampler;
	};
	const keep = (host: ProgramHost): Kept => {
		const { gl } = host;
		let made = kept.get(gl);
		if (made) return made;
		const programs = {} as Record<Pipeline, WebGLProgram>;
		for (const pipeline of pipelines)
			programs[pipeline] = host.program({ shader: variants, pipeline });
		made = { programs, sampler: makeSampler(gl), unit: host.unit(programs.trace, 0, 1) };
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
					kept.set(gl, {
						programs,
						sampler: makeSampler(gl),
						unit: host.unit(programs.trace, 0, 1),
					});
			});
			preparing.set(gl, ready);
		}
		return ready;
	};
	/** Makes the GL objects of a map, and uploads every step's uniform values. */
	const start = (
		gl: WebGL2RenderingContext,
		target: WebGLTexture,
		size: number,
		levels: number,
		slices: number,
	): Making => {
		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const stride = Math.ceil(STEP_BYTES / alignment) * alignment;
		const [steps, values] = roomSteps(size, levels, stride);
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
		const traced = cube(1);
		const chain = cube(Math.log2(size) + 1);
		const staging = texture(gl.TEXTURE_2D, (t) => gl.texStorage2D(t, 1, gl.RGBA8, 6 * size, size));
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
		const texels = gl.createBuffer();
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
		gl.bufferData(gl.PIXEL_PACK_BUFFER, 6 * size * size * 4, gl.STREAM_COPY);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		const uniforms = gl.createBuffer();
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, values, gl.STATIC_DRAW);
		return {
			steps,
			plan: sliceBands(steps, slices),
			stride,
			textures: { traced, chain, target },
			framebuffer,
			texels,
			uniforms,
			made,
			next: 0,
		};
	};
	/** Draws and copies one slice's bands. */
	const run = (host: ProgramHost, map: Making, slice: number, read?: BandRead) => {
		const { gl } = host;
		const { programs, sampler, unit } = keep(host);
		// The step values' uniform block binding, as the shader binds it.
		const binding = host.slot(0, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, map.framebuffer);
		gl.bindVertexArray(null);
		gl.bindSampler(unit, sampler);
		for (const { step: k, y, rows } of map.plan[slice] ?? []) {
			const step = map.steps[k] as Step;
			gl.useProgram(programs[step.pipeline]);
			gl.bindBufferRange(gl.UNIFORM_BUFFER, binding, map.uniforms, k * map.stride, STEP_BYTES);
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, map.textures[step.source]);
			// Fragments keep their place in the whole level, so the band's rows read as the faces'. GL
			// counts rows from the bottom, where the faces' first rows lie.
			const width = 6 * step.size;
			gl.viewport(0, y, width, rows);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, map.texels);
			gl.readPixels(0, y, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, 0);
			if (read && step.into.includes('target')) read(step.level, y, rows, step.size);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, map.texels);
			// Each face's part of a row starts its face's size of texels after the one before.
			gl.pixelStorei(gl.UNPACK_ROW_LENGTH, width);
			const type = gl.UNSIGNED_INT_5_9_9_9_REV;
			for (const into of step.into) {
				gl.bindTexture(gl.TEXTURE_CUBE_MAP, map.textures[into]);
				for (let face = 0; face < 6; face++) {
					const plane = gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
					const at = face * step.size * 4;
					gl.texSubImage2D(plane, step.level, 0, y, step.size, rows, gl.RGB, type, at);
				}
			}
			gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
		}
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindSampler(unit, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	};
	const end = (gl: WebGL2RenderingContext, map: Making) => {
		gl.deleteFramebuffer(map.framebuffer);
		gl.deleteBuffer(map.texels);
		gl.deleteBuffer(map.uniforms);
		for (const t of map.made) gl.deleteTexture(t);
	};
	const runSlice: CubeGenerator['run'] = (host, target, size, levels, slice, slices, read) => {
		const { gl } = host;
		// Every texture binds on the source's unit, the only one that the generator changes.
		gl.activeTexture(gl.TEXTURE0 + keep(host).unit);
		let map = making.get(target);
		if (slice === 0) {
			if (map) end(gl, map);
			done.delete(target);
			map = start(gl, target, size, levels, slices);
			making.set(target, map);
		} else if (!map) {
			// A list that a capture replays again can name a slice of a map that is done.
			if (done.has(target)) return;
			map = start(gl, target, size, levels, slices);
			making.set(target, map);
		}
		for (; map.next <= slice; map.next++) run(host, map, map.next, read);
		if (slice < slices - 1) return;
		end(gl, map);
		making.delete(target);
		done.add(target);
	};
	return { prepare, run: runSlice };
}
