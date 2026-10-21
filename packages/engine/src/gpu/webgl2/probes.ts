// Reflection probes' maps made on WebGL2 (D-149), ahead of the frame's passes. A filter copies each
// capture view's image into its layer of the chain, has GL's own mip filter make the chain's
// smaller levels, then fills each level of the probe's layer of the probes' array, each draw
// straight into its level through a framebuffer: the textures hold half floats, which the
// contexts that draw probes render into. The draws' uniform values never change for a pair of
// textures, so a filter writes them once, and keeps its framebuffer and buffer with the textures.

import type { ShaderVariant } from '../../generated/shaders';
import type { GpuMemory } from '../memory';
import { PROBE_STEP_BYTES, type ProbeSteps, probeSteps } from '../probe-steps';
import type { CubeGenerator } from './environment';
import type { ProgramHost } from './programs';

/** The probe shader's render pipelines. WebGL2 makes the chain's levels with `generateMipmap`. */
type Pipeline = 'gather' | 'half' | 'prefilter';

/** The size, the levels and the layers of a texture that a filter reads or draws into. */
export interface ProbeTexture {
	readonly texture: WebGLTexture | null;
	readonly target: number;
	readonly width: number;
	readonly mips: number;
}

/**
 * The generators' code that the thread that draws loads with the first generator: environment maps,
 * and reflection probes' filters.
 */
export interface Generators {
	readonly environment: CubeGenerator;
	readonly probes: ProbeFilter;
}

/** Runs reflection probes' filters in a context. */
export interface ProbeFilter {
	/** Compiles the context's programs in the background where the context can. */
	prepare(host: ProgramHost): Promise<void>;
	/**
	 * Makes layer `layer` of `probes` from `faces`, the six capture views' images, through `chain`,
	 * as the draw list's `ProbeFilter` command says. It changes the context's bindings, which the
	 * caller sets again: the program, the active texture unit with its texture and sampler, uniform
	 * block binding 0, the framebuffer and the viewport. It leaves no framebuffer, texture or
	 * sampler bound. The first filter on a pair of textures counts the bytes of its buffer in
	 * `memory`.
	 */
	run(
		host: ProgramHost,
		probes: ProbeTexture,
		chain: ProbeTexture,
		layer: number,
		faces: readonly ProbeTexture[],
		memory: GpuMemory,
	): void;
}

/** What a context keeps: the programs, the sampler and the texture unit the programs read. */
interface Kept {
	programs: Record<'gather' | 'prefilter', WebGLProgram>;
	sampler: WebGLSampler;
	unit: number;
}

/** What a filter on one pair of textures keeps. */
interface Pair {
	chain: WebGLTexture | null;
	steps: ProbeSteps;
	stride: number;
	uniforms: WebGLBuffer;
	framebuffer: WebGLFramebuffer;
}

/**
 * Draws level `level` of layer `layer` of `target` through the pair's framebuffer, which is bound,
 * with the uniform values of slot `place` at uniform block binding `binding`.
 */
function draw(
	gl: WebGL2RenderingContext,
	binding: number,
	pair: Pair,
	target: ProbeTexture,
	layer: number,
	level: number,
	place: number,
): void {
	gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, target.texture, level, layer);
	const size = Math.max(target.width >> level, 1);
	gl.viewport(0, 0, size, size);
	gl.bindBufferRange(
		gl.UNIFORM_BUFFER,
		binding,
		pair.uniforms,
		place * pair.stride,
		PROBE_STEP_BYTES,
	);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** The filter of reflection probes, from the probe shader's GLSL build. */
export function probeFilter(shader: ShaderVariant<Pipeline>): ProbeFilter {
	const variants = { webgl2: shader };
	const kept = new WeakMap<WebGL2RenderingContext, Kept>();
	const preparing = new WeakMap<WebGL2RenderingContext, Promise<void>>();
	const pairs = new WeakMap<WebGLTexture, Pair>();
	const pipelines = ['gather', 'prefilter'] as const;
	const makeSampler = (gl: WebGL2RenderingContext): WebGLSampler => {
		const sampler = gl.createSampler();
		if (!sampler) throw new Error('WebGL2 could not create a sampler');
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
			gl.samplerParameteri(sampler, wrap, gl.CLAMP_TO_EDGE);
		return sampler;
	};
	const made = (host: ProgramHost, programs: Kept['programs']): Kept => ({
		programs,
		sampler: makeSampler(host.gl),
		unit: host.unit(programs.prefilter, 0, 1),
	});
	const keep = (host: ProgramHost): Kept => {
		let known = kept.get(host.gl);
		if (known) return known;
		const programs = {} as Kept['programs'];
		for (const pipeline of pipelines)
			programs[pipeline] = host.program({ shader: variants, pipeline });
		known = made(host, programs);
		kept.set(host.gl, known);
		return known;
	};
	const prepare = (host: ProgramHost): Promise<void> => {
		const { gl } = host;
		let ready = preparing.get(gl);
		if (!ready) {
			const programs = {} as Kept['programs'];
			const built = pipelines.map(async (pipeline) => {
				programs[pipeline] = await host.programLater({ shader: variants, pipeline });
			});
			ready = Promise.all(built).then(() => {
				if (!kept.has(gl)) kept.set(gl, made(host, programs));
			});
			preparing.set(gl, ready);
		}
		return ready;
	};
	const pairOf = (
		gl: WebGL2RenderingContext,
		probes: ProbeTexture,
		chain: ProbeTexture,
		memory: GpuMemory,
	): Pair => {
		const key = probes.texture as WebGLTexture;
		const known = pairs.get(key);
		if (known && known.chain === chain.texture) return known;
		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const stride = Math.ceil(PROBE_STEP_BYTES / alignment) * alignment;
		const steps = probeSteps(probes.width, probes.mips, chain.width, stride);
		const uniforms = gl.createBuffer();
		const framebuffer = gl.createFramebuffer();
		if (!uniforms || !framebuffer) throw new Error('WebGL2 could not create a probe filter');
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, steps.values, gl.STATIC_DRAW);
		gl.bindBuffer(gl.UNIFORM_BUFFER, null);
		memory.addBuffers(steps.values.byteLength);
		const pair = { chain: chain.texture, steps, stride, uniforms, framebuffer };
		pairs.set(key, pair);
		return pair;
	};
	/** The first layer of the shared array that holds a probe's map: the light tables' layers
	 * (crate::light_tables) come first, so the probes follow them. */
	const PROBE_LAYER_BASE = 3;
	const run: ProbeFilter['run'] = (host, probes, chain, layer, faces, memory) => {
		const { gl } = host;
		const { programs, sampler, unit } = keep(host);
		const pair = pairOf(gl, probes, chain, memory);
		const binding = host.slot(0, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, pair.framebuffer);
		gl.bindVertexArray(null);
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindSampler(unit, sampler);
		gl.useProgram(programs.gather);
		for (let face = 0; face < 6; face++) {
			const image = faces[face] as ProbeTexture;
			gl.bindTexture(image.target, image.texture);
			draw(gl, binding, pair, chain, face, 0, pair.steps.gather);
		}
		gl.bindTexture(chain.target, chain.texture);
		gl.generateMipmap(chain.target);
		gl.useProgram(programs.prefilter);
		for (let level = 0; level < probes.mips; level++)
			draw(gl, binding, pair, probes, PROBE_LAYER_BASE + layer, level, pair.steps.prefilter(level));
		gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.bindTexture(chain.target, null);
		gl.bindSampler(unit, null);
	};
	return { prepare, run };
}
