// Environment maps made on WebGL2 (D-19), which the thread that draws loads with the first
// generator that a sketch asks for: the built-in room, a map of the scene's sky, or a panorama from
// an HDR file. Each step of environment-steps.ts draws a level's six faces, side by side, into an
// RGBA8 texture, as shared-exponent texels packed into its bytes. A pixel
// pack buffer then takes the bytes, and the same buffer unpacks each face's part into its face of
// the level of an RGB9_E5 cube texture: WebGL2 renders into no shared-exponent format, and the copy
// stays on the GPU. This path needs no float render target, so every device takes it (D-66). One
// call runs every step, before the frame's passes, so the map is whole before any frame reads it.
// Each step waits for the GPU between the pack and the unpack: Firefox on the Mac fills the pixel
// pack buffer late, and an unpack that does not wait reads the bytes that the buffer held before.
// The GL objects of a map go at the end of the call; the programs and the sampler stay for the
// next map in the context.
//
// A sky map runs in stages, which the engine core spreads over frames (D-118), each a few faces of
// its draws, as `skyStages` plans them. Its texels wait in two pixel pack buffers: the chain's
// levels, which the first stage that filters unpacks into the chain, and the map's finished
// levels, which the last stage unpacks into the map. A stage that unpacks first
// asks a fence whether the GPU has filled the buffer, which it has after a frame, and waits for
// the GPU only when it has not, as in the first fill, whose stages all run in one frame. The map
// keeps its GL objects between stages and refreshes, so a refresh allocates only its fences, one
// for each stage that packs.
//
// A map of the physical sky names the engine's panorama of it, a 2D texture of 16-bit floats. Its
// stages that draw the sky then read the panorama with the panorama's program, as a file's
// panorama is read, over the same directions of each texel.

import type { ShaderVariant } from '../../generated/shaders';
import type { GeneratorSource } from '../../shared/images';
import {
	CAPTURE_FACE,
	CAPTURE_TEXELS,
	chainLevels,
	environmentSteps,
	LAYER_BYTES,
	LAYER_VALUES,
	LAYER_WORD,
	LIGHT_BUFFER_WORD,
	levelOffsets,
	SKY_BYTES,
	SKY_FILTER,
	type SkyFilter,
	type SkyPart,
	STEP_BYTES,
	type Step,
	type StepSource,
	type StepTexture,
	skyRows,
	skyStages,
	skySteps,
} from '../environment-steps';
import type { GpuMemory } from '../memory';
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
	/**
	 * Runs a stage of the sky map in an RGB9_E5 cube texture, `size` texels wide with `levels`
	 * levels, as the draw list's `SkyMapStep` command at `at` of `words` (and of `floats`, the same
	 * memory) names it, as `skyStages` plans them: the first ones draw the sky of stage 0's
	 * settings into the chain, the next ones filter the map's levels, and the last unpacks every
	 * level into the map. The map's first stage makes what it keeps between stages, and counts its
	 * bytes in `memory`. It changes the bindings that `run` changes, and the pack row length. A map
	 * of the physical sky reads `panorama` in place of the analytic sky's settings.
	 */
	skyStage(
		host: ProgramHost,
		target: WebGLTexture,
		size: number,
		levels: number,
		words: Uint32Array,
		floats: Float32Array,
		at: number,
		memory: GpuMemory,
		panorama: WebGLTexture | null,
		layer: ShaderVariant<Pipeline> | undefined,
		readback: WebGLBuffer | undefined,
	): void;
	/**
	 * Deletes what the sky map in `target` keeps between its stages, if it is one, and takes its
	 * bytes out of `memory`.
	 */
	release(gl: WebGL2RenderingContext, target: WebGLTexture, memory: GpuMemory): void;
}

/**
 * What a context keeps between maps: the programs, and the samplers of the cube textures and of
 * the panorama.
 */
interface Kept {
	programs: Record<Pipeline, WebGLProgram>;
	/** The layer's own programs, by the shader that the page sent. */
	layers: Map<ShaderVariant<Pipeline>, LayerPrograms>;
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

export interface Units {
	cube: number;
	panorama: number;
}

/** The programs that a page's sky layer builds: its draws and the capture of the map's light. */
export interface LayerPrograms {
	sky: WebGLProgram;
	panorama: WebGLProgram;
	feedback: WebGLProgram;
	units: Units;
}

/** The texture units from which the programs read the cube source and the panorama. */
function unitsOf(host: ProgramHost, programs: Record<Pipeline, WebGLProgram>): Units {
	return { cube: host.unit(programs.blur, 0, 1), panorama: host.unit(programs.panorama, 0, 3) };
}

/**
 * A page's sky layer programs, and the texture units they read. A unit comes from the program that
 * samples the texture, since a stage that samples none of it drops its uniform: the capture of the
 * map's light sums the cube, and a draw samples the panorama in place of the analytic sky. A layer's
 * own draw of the sky samples no cube, so the cube's unit is the capture's.
 */
export function buildLayer(host: ProgramHost, layer: ShaderVariant<Pipeline>): LayerPrograms {
	const shader = { webgl2: layer };
	const sky = host.program({ shader, pipeline: 'sky' });
	const panorama = host.program({ shader, pipeline: 'panorama' });
	const feedback = host.program({ shader, pipeline: 'feedback' });
	return {
		sky,
		panorama,
		feedback,
		units: { cube: host.unit(feedback, 0, 1), panorama: host.unit(panorama, 0, 3) },
	};
}

/** The generator of environment maps, from the environment shader's GLSL build. */
export function environmentGenerator(
	shader: ShaderVariant<Pipeline>,
	skyFilter: SkyFilter = SKY_FILTER,
): CubeGenerator {
	const variants = { webgl2: shader };
	const kept = new WeakMap<WebGL2RenderingContext, Kept>();
	const preparing = new WeakMap<WebGL2RenderingContext, Promise<void>>();
	const pipelines: Pipeline[] = ['trace', 'blur', 'half', 'prefilter', 'panorama', 'sky'];
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
		made = {
			programs,
			layers: new Map(),
			samplers: makeSamplers(gl),
			units: unitsOf(host, programs),
		};
		kept.set(gl, made);
		return made;
	};
	/**
	 * The programs of a page's sky layer, compiled at a map's first fill with it: its draws of the
	 * sky's texels with itself over them, and the capture that sums the map's light.
	 */
	const layerPrograms = (
		host: ProgramHost,
		kept: Kept,
		layer: ShaderVariant<Pipeline>,
	): LayerPrograms => {
		let made = kept.layers.get(layer);
		if (!made) {
			made = buildLayer(host, layer);
			kept.layers.set(layer, made);
		}
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
						layers: new Map(),
						samplers: makeSamplers(gl),
						units: unitsOf(host, programs),
					});
			});
			preparing.set(gl, ready);
		}
		return ready;
	};
	const run: CubeGenerator['run'] = (host, target, size, levels, source, read) => {
		// The engine core fills a sky map in stages, with the sky's settings, and runs each probe's
		// filter on its own.
		if (source === 'sky' || source === 'probes') return;
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
	const skyMaps = new Map<WebGLTexture, SkyMap>();
	const skyStage: CubeGenerator['skyStage'] = (
		host,
		target,
		size,
		levels,
		words,
		floats,
		at,
		memory,
		panorama,
		layer,
		readback,
	) => {
		let map = skyMaps.get(target);
		if (!map) {
			map = makeSkyMap(host, keep(host), target, size, levels, skyFilter);
			skyMaps.set(target, map);
			memory.addTextures(map.textureBytes);
			memory.addBuffers(map.bufferBytes);
		}
		const builds =
			layer && words[at + LAYER_WORD] !== 0 ? layerPrograms(host, keep(host), layer) : undefined;
		map.stage({
			stage: words[at + 2] as number,
			settings: floats,
			at: at + 4,
			panorama,
			layer: builds,
			values: floats,
			valuesAt: at + LAYER_VALUES,
			readback: words[at + LIGHT_BUFFER_WORD] === 0 ? undefined : readback,
		});
	};
	const release: CubeGenerator['release'] = (gl, target, memory) => {
		const map = skyMaps.get(target);
		if (!map) return;
		map.destroy(gl);
		skyMaps.delete(target);
		memory.addTextures(-map.textureBytes);
		memory.addBuffers(-map.bufferBytes);
	};
	return { prepare, run, skyStage, release };
}

/** What one stage of a sky map draws, as the draw list's command names it. */
interface SkyStage {
	readonly stage: number;
	readonly settings: Float32Array;
	readonly at: number;
	readonly panorama: WebGLTexture | null;
	readonly layer: LayerPrograms | undefined;
	readonly values: Float32Array;
	readonly valuesAt: number;
	/** The buffer that this stage sums the map's light into, when it draws a layer's light. */
	readonly readback: WebGLBuffer | undefined;
}

/** What a sky map keeps between its stages, and how it runs each. */
interface SkyMap {
	/** The GPU bytes of the textures and of the buffers that the map keeps. */
	readonly textureBytes: number;
	readonly bufferBytes: number;
	stage(stage: SkyStage): void;
	destroy(gl: WebGL2RenderingContext): void;
}

/** The bytes of a row of a level's six faces in a pixel pack buffer, faces `size` texels wide. */
function packedRow(size: number): number {
	return 6 * size * 4;
}

/**
 * Makes the chain, the texture that each step draws into, and the buffers that the sky map in
 * `target` keeps, once.
 */
function makeSkyMap(
	host: ProgramHost,
	kept: Kept,
	target: WebGLTexture,
	size: number,
	levels: number,
	filter: SkyFilter,
): SkyMap {
	const { gl } = host;
	const { programs, samplers, units } = kept;
	const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
	const stride = Math.ceil(STEP_BYTES / alignment) * alignment;
	const [steps, values] = skySteps(size, levels, stride, filter);
	const stages = skyStages(size, levels);
	const chained = chainLevels(size);
	const stepBinding = host.slot(0, 0);
	const skyBinding = host.slot(0, 5);
	const texture = (kind: number, storage: (kind: number) => void) => {
		const t = gl.createTexture();
		if (!t) throw new Error('WebGL2 could not create a texture');
		gl.bindTexture(kind, t);
		storage(kind);
		gl.bindTexture(kind, null);
		return t;
	};
	gl.activeTexture(gl.TEXTURE0 + units.cube);
	const chain = texture(gl.TEXTURE_CUBE_MAP, (t) =>
		gl.texStorage2D(t, chained, gl.RGB9_E5, size, size),
	);
	const staging = texture(gl.TEXTURE_2D, (t) =>
		gl.texStorage2D(t, 1, gl.RGBA8, 6 * size, skyRows(size)),
	);
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const buffer = (kind: number, data: number | ArrayBuffer, usage: number) => {
		const b = gl.createBuffer();
		gl.bindBuffer(kind, b);
		if (typeof data === 'number') gl.bufferData(kind, data, usage);
		else gl.bufferData(kind, data, usage);
		gl.bindBuffer(kind, null);
		return b;
	};
	const chainOffsets = levelOffsets(size, chained, packedRow);
	const finishedOffsets = levelOffsets(size, levels, packedRow);
	const pack = gl.PIXEL_PACK_BUFFER;
	const chainTexels = buffer(pack, chainOffsets[chained] as number, gl.STREAM_COPY);
	const finishedTexels = buffer(pack, finishedOffsets[levels] as number, gl.STREAM_COPY);
	const uniforms = buffer(gl.UNIFORM_BUFFER, values, gl.STATIC_DRAW);
	const sky = buffer(gl.UNIFORM_BUFFER, SKY_BYTES, gl.DYNAMIC_DRAW);
	const layerValues = buffer(gl.UNIFORM_BUFFER, LAYER_BYTES, gl.DYNAMIC_DRAW);
	const layerBinding = host.slot(0, 6);
	// The step that the capture draws with: the level of the chain that it reads.
	const captureStep = buffer(gl.UNIFORM_BUFFER, STEP_BYTES, gl.STATIC_DRAW);
	{
		const step = new Float32Array(STEP_BYTES / 4);
		step[4] = Math.max(0, Math.round(Math.log2(size / CAPTURE_FACE)));
		gl.bindBuffer(gl.UNIFORM_BUFFER, captureStep);
		gl.bufferSubData(gl.UNIFORM_BUFFER, 0, step);
	}
	// The target that a capture sums the map's light into, and the pass that reads the chain into
	// it: a row of 32-bit words, which GL fills from its bottom row, one row high.
	let capture: WebGLTexture | null = null;
	let captureFramebuffer: WebGLFramebuffer | null = null;
	/**
	 * The fence after the last stage's packs, which signals once the GPU has run every pack before
	 * it, and whether the chain's levels still wait in their buffer.
	 */
	let packed: WebGLSync | null = null;
	let chainWaits = false;
	/** Waits for the GPU only when it has not run the packs so far yet. */
	const settle = () => {
		if (packed && gl.getSyncParameter(packed, gl.SYNC_STATUS) !== gl.SIGNALED) gl.finish();
	};
	/** Unpacks the first `count` levels of `from`, at `offsets`, into cube texture `into`. */
	const unpack = (
		from: WebGLBuffer | null,
		offsets: readonly number[],
		count: number,
		into: WebGLTexture,
	) => {
		gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, from);
		gl.activeTexture(gl.TEXTURE0 + units.cube);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, into);
		for (let level = 0; level < count; level++) {
			const side = size >> level;
			const start = offsets[level] as number;
			// Each face's part of a row starts its face's size of texels after the one before.
			gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 6 * side);
			for (let face = 0; face < 6; face++) {
				const plane = gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
				const type = gl.UNSIGNED_INT_5_9_9_9_REV;
				gl.texSubImage2D(plane, level, 0, 0, side, side, gl.RGB, type, start + face * side * 4);
			}
		}
		gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
	};
	/**
	 * Draws a part into the staging texture, and packs its texels into its buffers. A part that
	 * draws the sky reads `panorama` where it is given.
	 */
	const draw = (
		{ step: k, first, faces }: SkyPart,
		panorama: WebGLTexture | null,
		layer: LayerPrograms | undefined,
	) => {
		const step = steps[k] as Step;
		const side = step.size;
		const x = first * side;
		const reads = step.source === 'chain';
		const reread = panorama !== null && step.source === 'sky';
		// A layer draws the sky's own texels with itself over them, both of the analytic sky and of
		// the panorama that the physical sky draws.
		const drawn = layer !== undefined && step.source === 'sky';
		const used = drawn ? (layer as LayerPrograms).units : units;
		gl.useProgram(
			drawn
				? ((reread ? layer.panorama : layer.sky) as WebGLProgram)
				: programs[reread ? 'panorama' : step.pipeline],
		);
		if (reread) {
			gl.activeTexture(gl.TEXTURE0 + used.panorama);
			gl.bindTexture(gl.TEXTURE_2D, panorama);
			gl.bindSampler(used.panorama, samplers.panorama);
		}
		gl.bindBufferRange(gl.UNIFORM_BUFFER, stepBinding, uniforms, k * stride, STEP_BYTES);
		if (drawn) gl.bindBufferBase(gl.UNIFORM_BUFFER, layerBinding, layerValues);
		if (reads) {
			gl.activeTexture(gl.TEXTURE0 + used.cube);
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, chain);
			gl.bindSampler(used.cube, samplers.cube);
		}
		gl.viewport(x, step.row, faces * side, side);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		if (reads) {
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
			gl.bindSampler(used.cube, null);
			gl.activeTexture(gl.TEXTURE0 + units.cube);
		}
		if (reread) {
			gl.activeTexture(gl.TEXTURE0 + used.panorama);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.bindSampler(used.panorama, null);
			gl.activeTexture(gl.TEXTURE0 + units.panorama);
		}
		// Each face's texels lie at the same place in the buffer's rows as in the drawn rows.
		gl.pixelStorei(gl.PACK_ROW_LENGTH, 6 * side);
		for (let i = 0; i < step.into.length; i++) {
			const chaining = step.into[i] === 'chain';
			gl.bindBuffer(pack, chaining ? chainTexels : finishedTexels);
			const start = ((chaining ? chainOffsets : finishedOffsets)[step.level] as number) + x * 4;
			gl.readPixels(x, step.row, faces * side, side, gl.RGBA, gl.UNSIGNED_BYTE, start);
		}
		gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
		gl.bindBuffer(pack, null);
	};
	/**
	 * Draws the chain's light onto the nine coefficients of the map's diffuse light, and packs them
	 * into the readback buffer, which the engine reads back into its memory over the next frames.
	 */
	const captureLight = (layer: LayerPrograms, readback: WebGLBuffer) => {
		if (!capture) {
			capture = gl.createTexture();
			gl.activeTexture(gl.TEXTURE0 + units.cube);
			gl.bindTexture(gl.TEXTURE_2D, capture);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, CAPTURE_TEXELS, 1);
			gl.bindTexture(gl.TEXTURE_2D, null);
			captureFramebuffer = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, captureFramebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, capture, 0);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, captureFramebuffer);
		gl.bindVertexArray(null);
		gl.useProgram(layer.feedback);
		// The capture reads the chain's finest level of a face of `CAPTURE_FACE` texels, which
		// holds the sky's broad light in more directions than the nine coefficients need.
		gl.bindBuffer(gl.UNIFORM_BUFFER, captureStep);
		gl.bindBufferBase(gl.UNIFORM_BUFFER, stepBinding, captureStep);
		gl.activeTexture(gl.TEXTURE0 + layer.units.cube);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, chain);
		gl.bindSampler(layer.units.cube, samplers.cube);
		gl.viewport(0, 0, CAPTURE_TEXELS, 1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindSampler(layer.units.cube, null);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readback);
		gl.readPixels(0, 0, CAPTURE_TEXELS, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	};
	let texels = 0;
	for (let level = 0; level < chained; level++) texels += 6 * (size >> level) ** 2;
	return {
		textureBytes: 4 * (texels + 6 * size * skyRows(size)),
		bufferBytes:
			(chainOffsets[chained] as number) +
			(finishedOffsets[levels] as number) +
			values.byteLength +
			SKY_BYTES +
			LAYER_BYTES +
			STEP_BYTES,
		stage({ stage, settings, at, panorama, layer, values, valuesAt, readback }) {
			const parts = stages[stage] as readonly SkyPart[];
			if (parts.length === 0) {
				settle();
				unpack(finishedTexels, finishedOffsets, levels, target);
				// The last stage finds the map's light in the chain that it has just drawn, which
				// waits in its buffer until a stage that reads it unpacks it.
				if (layer && readback) {
					if (chainWaits) {
						unpack(chainTexels, chainOffsets, chained, chain);
						chainWaits = false;
					}
					captureLight(layer, readback);
				}
				return;
			}
			const drawsSky = steps[(parts[0] as SkyPart).step]?.source === 'sky';
			if (stage === 0) {
				gl.bindBuffer(gl.UNIFORM_BUFFER, sky);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, settings, at, SKY_BYTES / 4);
				if (layer) {
					// The layer's four cloud values, the share of the sun that it hides, its opacity
					// and its clock, which its shader reads as `SkyLayerValues`.
					gl.bindBuffer(gl.UNIFORM_BUFFER, layerValues);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, values, valuesAt, (LAYER_BYTES - 4) / 4);
				}
			}
			if (drawsSky) gl.bindBufferBase(gl.UNIFORM_BUFFER, skyBinding, sky);
			else if (chainWaits) {
				settle();
				unpack(chainTexels, chainOffsets, chained, chain);
				chainWaits = false;
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.bindVertexArray(null);
			for (let p = 0; p < parts.length; p++) draw(parts[p] as SkyPart, panorama, layer);
			if (drawsSky) chainWaits = true;
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			if (packed) gl.deleteSync(packed);
			packed = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		},
		destroy(gl) {
			if (packed) gl.deleteSync(packed);
			gl.deleteFramebuffer(framebuffer);
			if (captureFramebuffer) gl.deleteFramebuffer(captureFramebuffer);
			for (const t of [chain, staging, capture]) if (t) gl.deleteTexture(t);
			for (const b of [chainTexels, finishedTexels, uniforms, sky, layerValues, captureStep])
				gl.deleteBuffer(b);
		},
	};
}
