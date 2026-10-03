// Makes the mip levels of one layer of a texture array on WebGL2 in several ways, reads every level
// back and reports what each way wrote. The engine's way goes through the engine's backend. The
// other ways use the same mip shader in plain WebGL2 calls: the engine's former steps, a spare
// texture to draw into, a spare copy of the level to read from, both spares, `generateMipmap`,
// and a blit from each level to the next. Level 0 of each layer holds two colors, one in each
// half, so every made level must hold the same two colors. A level that reads black, or that
// shows another layer's colors, names the step that fails on the device. The page then copies
// every level of each layer into an array of twice the layers, as the texture store grows an
// array: through the engine's backend, through the same calls in plain WebGL2, and through a
// buffer on the GPU. The page also reports the GL errors of each way and the framebuffer status
// of each level it reads.
import { type DeviceShaders, loadGlslShaders, WebGL2Backend } from '@null3d/engine/internal';
import * as G from '../../packages/engine/src/generated/gpu';
import { TestMemory } from './lib/drawlist';
import { progress, run } from './lib/result';

const SIZE = 64;
const MIPS = 7;
const LAYERS = 4;
/** Each made level must match its halves to this many steps of 255, after rounding. */
const TOLERANCE = 3;

type Color = readonly [number, number, number, number];

/** Each layer's left and right colors, as stored bytes. */
const HALVES: readonly (readonly [Color, Color])[] = [
	[
		[230, 30, 30, 255],
		[30, 200, 60, 255],
	],
	[
		[40, 60, 220, 255],
		[240, 240, 240, 255],
	],
	[
		[200, 40, 120, 255],
		[40, 180, 220, 255],
	],
	[
		[250, 200, 40, 255],
		[90, 90, 90, 255],
	],
];

type Format = 'srgb' | 'rgba8';

/** One level as read back. */
interface LevelResult {
	level: number;
	/** The read framebuffer's status, in hexadecimal. */
	status: string;
	/** The texel a quarter of the way across the middle row, and the one three quarters across. */
	left: number[];
	right: number[];
	/** Texels that differ from the color of their half. Levels one texel wide count none. */
	wrong: number;
}

/** What one way of making the levels wrote. */
interface WayResult {
	way: string;
	format: Format;
	layers: number;
	layer: number;
	levels: LevelResult[];
	errors: string[];
	ok: boolean;
	error?: string;
}

/** The texels of level 0 of `layers` layers: each layer's two colors, left and right. */
function levelZero(layers: number): Uint8Array {
	const out = new Uint8Array(SIZE * SIZE * layers * 4);
	for (let layer = 0; layer < layers; layer++)
		for (let y = 0; y < SIZE; y++)
			for (let x = 0; x < SIZE; x++)
				out.set(
					(HALVES[layer] as readonly [Color, Color])[x < SIZE / 2 ? 0 : 1],
					((layer * SIZE + y) * SIZE + x) * 4,
				);
	return out;
}

/** GL errors since the last call, by code. */
function glErrors(gl: WebGL2RenderingContext): string[] {
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`0x${error.toString(16)}`);
	return errors;
}

/** Reads one level of one layer through a read framebuffer and compares it with its halves. */
function readLevel(
	gl: WebGL2RenderingContext,
	framebuffer: WebGLFramebuffer,
	texture: WebGLTexture,
	level: number,
	layer: number,
): LevelResult {
	const size = Math.max(1, SIZE >> level);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
	gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, level, layer);
	const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
	const texels = new Uint8Array(size * size * 4);
	if (status === gl.FRAMEBUFFER_COMPLETE)
		gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, texels);
	gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
	const texel = (x: number) =>
		Array.from(texels.subarray(((size >> 1) * size + x) * 4).slice(0, 4));
	const halves = HALVES[layer] as readonly [Color, Color];
	let wrong = 0;
	if (size > 1)
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const want = halves[x < size / 2 ? 0 : 1];
				const at = (y * size + x) * 4;
				for (let c = 0; c < 4; c++)
					if (Math.abs((texels[at + c] as number) - (want[c] as number)) > TOLERANCE) {
						wrong++;
						break;
					}
			}
	return {
		level,
		status: `0x${status.toString(16)}`,
		left: texel(size >> 2),
		right: texel(Math.min(size - 1, (size * 3) >> 2)),
		wrong,
	};
}

/** Reads every level of a made layer back. */
function readWay(
	gl: WebGL2RenderingContext,
	framebuffer: WebGLFramebuffer,
	texture: WebGLTexture,
	way: Omit<WayResult, 'levels' | 'ok'>,
): WayResult {
	const levels: LevelResult[] = [];
	for (let level = 0; level < MIPS; level++)
		levels.push(readLevel(gl, framebuffer, texture, level, way.layer));
	const errors = [...way.errors, ...glErrors(gl)];
	const ok = !way.error && errors.length === 0 && levels.every(({ wrong }) => wrong === 0);
	return { ...way, levels, errors, ok };
}

/** A way's texture to read back, and the facts the result gives about it. */
interface Made {
	texture: WebGLTexture;
	way: Omit<WayResult, 'levels' | 'ok' | 'errors'>;
}

/** The engine's ways: each makes a texture through the backend and the levels of one layer. */
const ENGINE_WAYS: readonly { format: Format; layers: number; layer: number }[] = [
	{ format: 'srgb', layers: LAYERS, layer: 2 },
	{ format: 'rgba8', layers: LAYERS, layer: 2 },
	{ format: 'srgb', layers: LAYERS, layer: 0 },
	{ format: 'srgb', layers: 1, layer: 0 },
];

/**
 * The layers of a grown array that the page reads back. Layer 0 is left out, as a copy that reads
 * the wrong layer still gets it right.
 */
const COPIED_LAYERS = [1, 3];

const USAGE =
	G.TEXTURE_USAGE_TEXTURE_BINDING |
	G.TEXTURE_USAGE_COPY_DST |
	G.TEXTURE_USAGE_COPY_SRC |
	G.TEXTURE_USAGE_RENDER_ATTACHMENT;

/** Adds the commands that make a texture array with level 0 of every layer written. */
function pushArray(memory: TestMemory, id: number, format: Format, layers: number): void {
	const data = levelZero(layers);
	const at = memory.put(data);
	const code = format === 'srgb' ? G.FORMAT_RGBA8_UNORM_SRGB : G.FORMAT_RGBA8_UNORM;
	memory.push(G.OP_CREATE_TEXTURE, id, SIZE, SIZE, layers, code, USAGE, 1, MIPS, G.VIEW_2D_ARRAY);
	memory.push(G.OP_WRITE_TEXTURE, id, 0, 0, 0, 0, SIZE, SIZE, layers, at, data.byteLength);
}

/**
 * Makes each engine way's levels through the backend. Then grows an array as the texture store
 * does: a new array of twice the layers takes a copy of every level of every layer. Returns the
 * texture arrays to read back, which the page tells from the backend's other textures by their
 * storage.
 */
function engineWays(gl: WebGL2RenderingContext, shaders: DeviceShaders): Made[] {
	const arrays: WebGLTexture[] = [];
	const storage = gl.texStorage3D.bind(gl);
	gl.texStorage3D = (...args: Parameters<WebGL2RenderingContext['texStorage3D']>) => {
		storage(...args);
		arrays.push(gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture);
	};
	const canvas = gl.canvas as OffscreenCanvas;
	const backend = new WebGL2Backend(gl, canvas, shaders, true, 'reversed');
	const replay = (memory: TestMemory) => {
		memory.push(G.OP_SUBMIT);
		backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
	};
	const made: Made[] = [];
	for (const [k, { format, layers, layer }] of ENGINE_WAYS.entries()) {
		const memory = new TestMemory(SIZE * SIZE * LAYERS * 4 + 4096, 64);
		pushArray(memory, k + 1, format, layers);
		memory.push(G.OP_GENERATE_MIPMAPS, k + 1, layer);
		replay(memory);
		const texture = arrays.at(-1) as WebGLTexture;
		made.push({ texture, way: { way: 'engine', format, layers, layer } });
	}
	const memory = new TestMemory(SIZE * SIZE * LAYERS * 4 + 4096, 512);
	const source = 20;
	const grown = 21;
	pushArray(memory, source, 'srgb', LAYERS);
	for (let layer = 0; layer < LAYERS; layer++) memory.push(G.OP_GENERATE_MIPMAPS, source, layer);
	const code = G.FORMAT_RGBA8_UNORM_SRGB;
	const twice = 2 * LAYERS;
	memory.push(G.OP_CREATE_TEXTURE, grown, SIZE, SIZE, twice, code, USAGE, 1, MIPS, G.VIEW_2D_ARRAY);
	for (let level = 0; level < MIPS; level++) {
		const size = Math.max(1, SIZE >> level);
		const at = [source, level, 0, 0, 0, grown, level, 0, 0, 0, size, size, LAYERS];
		memory.push(G.OP_COPY_TEXTURE_TO_TEXTURE, ...at);
	}
	replay(memory);
	const texture = arrays.at(-1) as WebGLTexture;
	for (const layer of COPIED_LAYERS)
		made.push({ texture, way: { way: 'engine-copy', format: 'srgb', layers: twice, layer } });
	gl.texStorage3D = storage;
	return made;
}

/** The mip shader's program, compiled as the engine compiles it, with its uniforms. */
function mipProgram(gl: WebGL2RenderingContext, shaders: DeviceShaders) {
	const glsl = Object.values(shaders.mipmap)[0]?.glsl?.main;
	if (!glsl) throw new Error('no GLSL mip shader');
	const program = gl.createProgram();
	for (const [type, stage] of [
		[gl.VERTEX_SHADER, glsl.vertex],
		[gl.FRAGMENT_SHADER, glsl.fragment],
	] as const) {
		const shader = gl.createShader(type);
		if (!shader) throw new Error('no shader');
		gl.shaderSource(shader, stage.source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
			throw new Error(`the mip shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
		gl.attachShader(program, shader);
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		throw new Error(`the mip shader failed to link: ${gl.getProgramInfoLog(program)}`);
	gl.useProgram(program);
	const source = glsl.fragment.textures[0]?.name;
	if (source) gl.uniform1i(gl.getUniformLocation(program, source), 0);
	const depth = gl.getUniformLocation(program, 'null3d_depth_mapping');
	if (depth) gl.uniform2f(depth, 1, 0);
	return { program, layer: gl.getUniformLocation(program, 'naga_vs_first_instance') };
}

/**
 * A texture array as the engine makes one, with level 0 of every layer written, or with nothing
 * written when `written` is false.
 */
function arrayTexture(
	gl: WebGL2RenderingContext,
	format: Format,
	layers: number,
	written = true,
): WebGLTexture {
	const texture = gl.createTexture();
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
	gl.texStorage3D(gl.TEXTURE_2D_ARRAY, MIPS, internalOf(gl, format), SIZE, SIZE, layers);
	gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	if (written) {
		const data = levelZero(layers);
		const { RGBA, UNSIGNED_BYTE } = gl;
		gl.texSubImage3D(
			gl.TEXTURE_2D_ARRAY,
			0,
			0,
			0,
			0,
			SIZE,
			SIZE,
			layers,
			RGBA,
			UNSIGNED_BYTE,
			data,
		);
	}
	gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
	gl.activeTexture(gl.TEXTURE0);
	return texture;
}

const internalOf = (gl: WebGL2RenderingContext, format: Format) =>
	format === 'srgb' ? gl.SRGB8_ALPHA8 : gl.RGBA8;

/** A texture of one level and one layer: a spare to draw into, or to copy a level into. */
function spare(
	gl: WebGL2RenderingContext,
	target: number,
	format: Format,
	size: number,
): WebGLTexture {
	const texture = gl.createTexture();
	gl.activeTexture(gl.TEXTURE2);
	gl.bindTexture(target, texture);
	if (target === gl.TEXTURE_2D_ARRAY)
		gl.texStorage3D(target, 1, internalOf(gl, format), size, size, 1);
	else gl.texStorage2D(target, 1, internalOf(gl, format), size, size);
	gl.bindTexture(target, null);
	gl.activeTexture(gl.TEXTURE0);
	return texture;
}

/** The plain WebGL2 ways, by name: each makes levels 1 and up of one layer of a texture array. */
type MakeLevels = (texture: WebGLTexture, layer: number, format: Format) => void;

function plainWays(gl: WebGL2RenderingContext, shaders: DeviceShaders): Record<string, MakeLevels> {
	const { layer: layerUniform } = mipProgram(gl, shaders);
	const sampler = gl.createSampler();
	gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindSampler(0, sampler);
	gl.bindVertexArray(null);
	for (const cap of [gl.SCISSOR_TEST, gl.DEPTH_TEST, gl.CULL_FACE, gl.BLEND, gl.STENCIL_TEST])
		gl.disable(cap);
	gl.colorMask(true, true, true, true);
	const draw = gl.createFramebuffer();
	const read = gl.createFramebuffer();
	const size = (level: number) => Math.max(1, SIZE >> level);

	/** Draws the mip shader over the draw framebuffer's level, reading `source`'s layer at unit 0. */
	const drawLevel = (source: WebGLTexture, layer: number, width: number) => {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, source);
		gl.uniform1ui(layerUniform, layer);
		gl.viewport(0, 0, width, width);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
	};
	/** Limits the levels that a sampler reads from `texture` to one. */
	const onlyLevel = (texture: WebGLTexture, base: number, max: number) => {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, base);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, max);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
	};
	/** Copies a level of a layer of `texture` into a new spare array of one layer and level. */
	const copyOut = (texture: WebGLTexture, level: number, layer: number, format: Format) => {
		const copy = spare(gl, gl.TEXTURE_2D_ARRAY, format, size(level));
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
		gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, level, layer);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, copy);
		gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 0, 0, size(level), size(level));
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
		return copy;
	};
	/** Draws a level into a new spare 2D texture, which then copies into `texture`'s level. */
	const drawThroughSpare = (
		source: WebGLTexture,
		sourceLayer: number,
		texture: WebGLTexture,
		level: number,
		layer: number,
		format: Format,
	) => {
		const target = spare(gl, gl.TEXTURE_2D, format, size(level));
		gl.bindFramebuffer(gl.FRAMEBUFFER, draw);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
		drawLevel(source, sourceLayer, size(level));
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
		gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, 0, 0, size(level), size(level));
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
		gl.deleteTexture(target);
	};
	const intoLevel = (texture: WebGLTexture, level: number, layer: number) => {
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
		gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, level, layer);
	};
	const detach = () =>
		gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);

	return {
		// The engine's steps in plain calls: the level before is the base and highest level.
		'base-level-draw': (texture, layer) => {
			for (let level = 1; level < MIPS; level++) {
				onlyLevel(texture, level - 1, level - 1);
				intoLevel(texture, level, layer);
				drawLevel(texture, layer, size(level));
			}
			detach();
			onlyLevel(texture, 0, MIPS - 1);
		},
		// The same reads, but each level draws into a spare texture, which copies into the level.
		'spare-target': (texture, layer, format) => {
			for (let level = 1; level < MIPS; level++) {
				onlyLevel(texture, level - 1, level - 1);
				drawThroughSpare(texture, layer, texture, level, layer, format);
				onlyLevel(texture, 0, MIPS - 1);
			}
		},
		// Each level before is copied into a spare texture, which the draw into the level reads.
		'spare-source': (texture, layer, format) => {
			for (let level = 1; level < MIPS; level++) {
				const source = copyOut(texture, level - 1, layer, format);
				intoLevel(texture, level, layer);
				drawLevel(source, 0, size(level));
				detach();
				gl.deleteTexture(source);
			}
		},
		// Both spares: the texture never changes its base level, and no draw writes into it.
		'spare-both': (texture, layer, format) => {
			for (let level = 1; level < MIPS; level++) {
				const source = copyOut(texture, level - 1, layer, format);
				drawThroughSpare(source, 0, texture, level, layer, format);
				gl.deleteTexture(source);
			}
		},
		// WebGL's own call, which remakes the levels of every layer.
		'generate-mipmap': (texture) => {
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
			gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		},
		// A linear blit from each level to the next.
		blit: (texture, layer) => {
			for (let level = 1; level < MIPS; level++) {
				gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
				gl.framebufferTextureLayer(
					gl.READ_FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					texture,
					level - 1,
					layer,
				);
				intoLevel(texture, level, layer);
				const from = size(level - 1);
				const to = size(level);
				gl.blitFramebuffer(0, 0, from, from, 0, 0, to, to, gl.COLOR_BUFFER_BIT, gl.LINEAR);
			}
			detach();
			gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
		},
	};
}

/** Copies every level of every layer of one texture array into another, in plain WebGL2 calls. */
type CopyLayers = (from: WebGLTexture, into: WebGLTexture, layers: number) => void;

function plainCopies(gl: WebGL2RenderingContext): Record<string, CopyLayers> {
	const read = gl.createFramebuffer();
	const size = (level: number) => Math.max(1, SIZE >> level);
	/** Calls `copy` with each level and layer of `from` attached to the read framebuffer. */
	const eachLayer = (
		from: WebGLTexture,
		into: WebGLTexture,
		layers: number,
		copy: (level: number, layer: number) => void,
	) => {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, into);
		for (let level = 0; level < MIPS; level++)
			for (let layer = 0; layer < layers; layer++) {
				gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, from, level, layer);
				copy(level, layer);
			}
		gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		gl.activeTexture(gl.TEXTURE0);
	};
	return {
		// The engine's copy: each source layer is attached to a framebuffer that WebGL copies from.
		'copy-layer': (from, into, layers) =>
			eachLayer(from, into, layers, (level, layer) =>
				gl.copyTexSubImage3D(
					gl.TEXTURE_2D_ARRAY,
					level,
					0,
					0,
					layer,
					0,
					0,
					size(level),
					size(level),
				),
			),
		// Each layer read into a buffer on the GPU, which then uploads into the new array's layer.
		'buffer-copy': (from, into, layers) => {
			const buffer = gl.createBuffer();
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
			gl.bufferData(gl.PIXEL_PACK_BUFFER, SIZE * SIZE * 4, gl.STREAM_COPY);
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			eachLayer(from, into, layers, (level, layer) => {
				const side = size(level);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
				gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, 0);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
				gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
				gl.texSubImage3D(
					gl.TEXTURE_2D_ARRAY,
					level,
					0,
					0,
					layer,
					side,
					side,
					1,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					0,
				);
				gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
			});
			gl.deleteBuffer(buffer);
		},
	};
}

/** The renderer's names, where the browser gives them. */
function renderer(gl: WebGL2RenderingContext): Record<string, unknown> {
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	return {
		version: gl.getParameter(gl.VERSION),
		shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
		vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
		renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
	};
}

run('mip-levels', async () => {
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
	if (!gl) throw new Error('no WebGL2 context');
	const shaders = await loadGlslShaders(0);
	progress('the engine makes its levels');
	const ways: WayResult[] = [];
	const engineMade = engineWays(gl, shaders);
	const engineErrors = glErrors(gl);
	// Plain calls follow, so nothing the backend keeps bound may stay bound.
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
	gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
	gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
	gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
	gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
	gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
	gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	for (let unit = 0; unit < 4; unit++) gl.bindSampler(unit, null);
	const framebuffer = gl.createFramebuffer();
	for (const [k, { texture, way }] of engineMade.entries())
		ways.push(readWay(gl, framebuffer, texture, { ...way, errors: k === 0 ? engineErrors : [] }));
	progress('plain WebGL2 ways');
	const plain = plainWays(gl, shaders);
	for (const [name, make] of Object.entries(plain))
		for (const format of ['srgb', 'rgba8'] as const) {
			const layer = 2;
			const texture = arrayTexture(gl, format, LAYERS);
			let error: string | undefined;
			try {
				make(texture, layer, format);
			} catch (e) {
				error = (e as Error).message;
			}
			const result = readWay(gl, framebuffer, texture, {
				way: name,
				format,
				layers: LAYERS,
				layer,
				errors: [],
				...(error ? { error } : {}),
			});
			ways.push(result);
			gl.deleteTexture(texture);
		}
	progress('plain WebGL2 copies');
	for (const [name, copy] of Object.entries(plainCopies(gl))) {
		// A source whose levels `generateMipmap` made, which works where the other ways fail.
		const from = arrayTexture(gl, 'srgb', LAYERS);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, from);
		gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		const into = arrayTexture(gl, 'srgb', 2 * LAYERS, false);
		let error: string | undefined;
		try {
			copy(from, into, LAYERS);
		} catch (e) {
			error = (e as Error).message;
		}
		for (const layer of COPIED_LAYERS)
			ways.push(
				readWay(gl, framebuffer, into, {
					way: name,
					format: 'srgb',
					layers: 2 * LAYERS,
					layer,
					errors: [],
					...(error ? { error } : {}),
				}),
			);
		gl.deleteTexture(from);
		gl.deleteTexture(into);
	}
	const names = [...new Set(ways.map(({ way }) => way))];
	const works = (name: string) => ways.every(({ way, ok }) => way !== name || ok);
	return {
		...renderer(gl),
		ways,
		working: names.filter(works),
		failing: names.filter((name) => !works(name)),
	};
});
