// The WebGL2 backend: owns every GL object in tables indexed by the core's resource ids, and
// replays binary draw lists into WebGL2 calls. A state cache skips calls that would set what is
// already set. The replay loop reads 32-bit words from views on engine memory, uploads straight
// from them, and allocates nothing per command, except when a command creates a GL object. Where
// WebGL refuses views on shared memory, uploads first copy their words out of it into a staging
// buffer.
//
// A texture's first write goes straight into it. Later writes into a data texture of 32-bit
// values, which may land in a texture that the GPU still reads for an earlier frame, go through a
// pixel unpack buffer, so the GPU copies them in order with its other work. A direct write there
// makes Safari wait until the GPU has finished every frame that reads the texture. Color textures
// keep direct writes: through an unpack buffer, Chrome on the Mac stored sRGB texels brighter.
//
// GL counts rows from the bottom, and the engine keeps GL's row order in what a render pass draws.
// The backend flips viewport and scissor rectangles, which the draw list gives from the top, so each
// covers the same part of the image as on WebGPU. Writes, uploads and copies address texels as
// stored, the same on both paths.
//
// Draw lists give depth as WebGPU's reversed depth. The backend draws it in its depth mode, and
// turns clear values and viewport depth ranges around for standard depth.

import * as G from '../../generated/gpu';
import type { DeviceShaders, FirstUseShaders, ShaderVariants } from '../../generated/shaders';
import type { DepthMode } from '../../page/switches';
import { ImageTable } from '../../shared/images';
import type { DeviceShaderSet } from '../device-shaders';
import { floatOfBits } from '../float-bits';
import {
	forEachFallbackAttribute,
	forEachVertexAttribute,
	isNormalized,
	type VertexAttribute,
	vertexStride,
} from '../vertex-format';
import { type DepthSetup, setDepthMode } from './depth';
import type { CubeGenerator } from './environment';
import {
	buildPermutation,
	createProgram,
	engineTemplates,
	type GlslTemplate,
	mipmapTemplate,
	type Pipeline,
	type Program,
	type ProgramHost,
	prepareProgram,
	programHost,
	slotOf,
	UPLOAD_UNIT,
} from './programs';

/** The unit that the mip level shader samples: its source texture's group 0, binding 0. */
const MIP_UNIT = 0;
/** The key of the mip level program among the programs of pipelines. */
const MIP_PROGRAM = 'mipmap';
/** The key of the program that copies a layer texel by texel. */
const COPY_PROGRAM = 'mipmap copy';

// Attachment names, for invalidating what a pass does not store.
const COLOR_ATTACHMENT0 = 0x8ce0;
const DEPTH_ATTACHMENT = 0x8d00;
const DISCARD_BOTH = [COLOR_ATTACHMENT0, DEPTH_ATTACHMENT];
const DISCARD_COLOR = [COLOR_ATTACHMENT0];
const DISCARD_DEPTH = [DEPTH_ATTACHMENT];
/** GL's `BACK`, the faces that a context culls until it is told otherwise. */
const CULL_BACK = 0x0405;
/**
 * Pixel unpack buffers in the ring that texture rewrites go through: one for the frame being
 * replayed and one for each frame that the GPU may still be reading.
 */
const UNPACK_RING = 3;
/** Each write's place in a pixel unpack buffer is aligned to this, the largest texel's size. */
const UNPACK_ALIGNMENT = 16;
/**
 * Features whose builds vary in every material bit, tens of programs for each device. A scene's
 * materials draw with a few of them, so a preload compiles none, and `scene.warmUp()` builds those.
 */
const WARM_UP_FEATURES: ReadonlySet<string> = new Set(['skinning', 'morph']);

/** Where drawing into the canvas goes during a capture: an offscreen stand-in of the same size. */
export interface CanvasTarget {
	framebuffer: WebGLFramebuffer;
	width: number;
	height: number;
}

interface GlBuffer {
	buffer: WebGLBuffer;
	size: number;
}

/** How GL stores a texture format, and how texels of it upload. */
interface GlFormat {
	/** The sized internal format. */
	readonly internal: number;
	/** The format and type of uploaded texels: bytes of blocks for a compressed format. */
	readonly format: number;
	readonly type: number;
	/** Bytes of one block of texels: one texel unless the format is compressed. */
	readonly bytes: number;
	/** Texels on each side of a block: more than 1 for a compressed format. */
	readonly block: number;
	/** Where a render target of the format attaches to a framebuffer. */
	readonly attachment: number;
}

/**
 * A texture, a render target that WebGL2 keeps in a renderbuffer, or a view of one mip level and
 * one layer of a texture. Its size is the size of the level that it draws into. A multisampled
 * depth target that shaders read has both: passes draw into the renderbuffer, and bind groups
 * read the texture, a copy of one sample that each render pass that stores the depth updates.
 */
interface GlTexture {
	readonly texture: WebGLTexture | null;
	readonly renderbuffer: WebGLRenderbuffer | null;
	/**
	 * `TEXTURE_2D`, `TEXTURE_2D_ARRAY`, `TEXTURE_CUBE_MAP` or `TEXTURE_3D` for a texture or a view,
	 * and 0 for a renderbuffer.
	 */
	readonly target: number;
	readonly width: number;
	readonly height: number;
	readonly format: GlFormat;
	/** The mip levels of the texture. */
	readonly mips: number;
	/** The mip level and the layer that a render pass draws into. */
	readonly level: number;
	readonly layer: number;
	/** True for a view, which shares its texture and never deletes it. */
	readonly view: boolean;
	/** True once a write has gone into the texture, so later writes go through an unpack buffer. */
	written: boolean;
	/**
	 * The framebuffer of passes that draw into this color target with a depth target, and that
	 * depth target.
	 */
	framebuffer: WebGLFramebuffer | null;
	framebufferDepth: GlTexture | null;
	/**
	 * A framebuffer with only this target in it: for passes that draw into it without depth, passes
	 * that draw depth only, and resolves.
	 */
	soloFramebuffer: WebGLFramebuffer | null;
	/** The framebuffer of the one-sample copy of a multisampled depth target that shaders read. */
	copyFramebuffer: WebGLFramebuffer | null;
}

interface BindEntry {
	binding: number;
	kind: number;
	resource: number;
	offset: number;
	size: number;
}

/** A vertex page's vertex array object, and the buffers and vertex format it was made for. */
interface VertexArray {
	vao: WebGLVertexArrayObject;
	vertices: WebGLBuffer;
	indices: WebGLBuffer;
	format: number;
}

/** The vertex array of a buffer that a template's own layout describes, and what it was made for. */
interface LayoutArray {
	vao: WebGLVertexArrayObject;
	vertices: WebGLBuffer;
	layout: GPUVertexBufferLayout;
}

/** GL's size, type and normalization of a WebGPU vertex format that the backend reads. */
function glAttribute(
	gl: WebGL2RenderingContext,
	format: GPUVertexFormat,
): [number, number, boolean] {
	switch (format) {
		case 'float32x2':
			return [2, gl.FLOAT, false];
		case 'float32x3':
			return [3, gl.FLOAT, false];
		case 'float32x4':
			return [4, gl.FLOAT, false];
		case 'unorm8x4':
			return [4, gl.UNSIGNED_BYTE, true];
		default:
			throw new Error(`the WebGL2 backend reads no vertex format ${format}`);
	}
}

/** GL's types of vertex attribute values. */
const GL_FLOAT = 0x1406;
const GL_BYTE = 0x1400;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_SHORT = 0x1402;
const GL_UNSIGNED_SHORT = 0x1403;

/** GL's type of each vertex attribute type's values, by code. */
const GL_VERTEX_TYPES: Readonly<Record<number, number>> = {
	[G.VERTEX_TYPE_F32]: GL_FLOAT,
	[G.VERTEX_TYPE_UNORM8]: GL_UNSIGNED_BYTE,
	[G.VERTEX_TYPE_SNORM8]: GL_BYTE,
	[G.VERTEX_TYPE_UNORM16]: GL_UNSIGNED_SHORT,
	[G.VERTEX_TYPE_SNORM16]: GL_SHORT,
	[G.VERTEX_TYPE_UINT8]: GL_UNSIGNED_BYTE,
	[G.VERTEX_TYPE_SINT8]: GL_BYTE,
	[G.VERTEX_TYPE_UINT16]: GL_UNSIGNED_SHORT,
	[G.VERTEX_TYPE_SINT16]: GL_SHORT,
};

/**
 * Points a vertex array's location at a mesh attribute. Attributes that shaders read as whole
 * numbers take the integer pointer. The others take the float pointer, which reads normalized
 * integers as fractions and plain integers as whole values, as glTF reads them.
 */
function pointAttribute(gl: WebGL2RenderingContext, stride: number, a: VertexAttribute): void {
	const type = GL_VERTEX_TYPES[a.type] as number;
	gl.enableVertexAttribArray(a.location);
	if (a.integer) gl.vertexAttribIPointer(a.location, a.size, type, stride, a.offset);
	else gl.vertexAttribPointer(a.location, a.size, type, isNormalized(a), stride, a.offset);
}

/**
 * How GL stores each texture format, by format code, for a canvas with alpha or without. A
 * compressed format is there only when the context turned on its extension, which the backend
 * asks for by name.
 */
function glFormats(gl: WebGL2RenderingContext, canvasAlpha: boolean): (GlFormat | undefined)[] {
	const formats: (GlFormat | undefined)[] = [];
	const add = (
		code: number,
		internal: number,
		format: number,
		type: number,
		attachment: number,
	) => {
		formats[code] = {
			internal,
			format,
			type,
			attachment,
			bytes: G.FORMAT_BLOCK_BYTES[code] ?? 0,
			block: G.FORMAT_BLOCK_SIZE[code] ?? 1,
		};
	};
	// A compressed format's writes read bytes.
	const compressed = (code: number, internal: number) =>
		add(code, internal, 0, gl.UNSIGNED_BYTE, 0);
	const astc = gl.getExtension('WEBGL_compressed_texture_astc');
	if (astc) {
		compressed(G.FORMAT_ASTC_4X4_UNORM, astc.COMPRESSED_RGBA_ASTC_4x4_KHR);
		compressed(G.FORMAT_ASTC_4X4_UNORM_SRGB, astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR);
	}
	const bptc = gl.getExtension('EXT_texture_compression_bptc');
	if (bptc) {
		compressed(G.FORMAT_BC7_RGBA_UNORM, bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT);
		compressed(G.FORMAT_BC7_RGBA_UNORM_SRGB, bptc.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT);
		compressed(G.FORMAT_BC6H_RGB_UFLOAT, bptc.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT);
	}
	const etc = gl.getExtension('WEBGL_compressed_texture_etc');
	if (etc) {
		compressed(G.FORMAT_ETC2_RGB8_UNORM, etc.COMPRESSED_RGB8_ETC2);
		compressed(G.FORMAT_ETC2_RGB8_UNORM_SRGB, etc.COMPRESSED_SRGB8_ETC2);
		compressed(G.FORMAT_ETC2_RGBA8_UNORM, etc.COMPRESSED_RGBA8_ETC2_EAC);
		compressed(G.FORMAT_ETC2_RGBA8_UNORM_SRGB, etc.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC);
	}
	const color = gl.COLOR_ATTACHMENT0;
	// The canvas holds three channels when its context has no alpha, and a multisampled image
	// resolves only into the same format.
	if (canvasAlpha) add(G.FORMAT_CANVAS, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, color);
	else add(G.FORMAT_CANVAS, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, color);
	add(G.FORMAT_RGBA8_UNORM, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, color);
	add(G.FORMAT_RGBA8_UNORM_SRGB, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, color);
	add(G.FORMAT_RGBA16_FLOAT, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, color);
	add(G.FORMAT_RG11B10_UFLOAT, gl.R11F_G11F_B10F, gl.RGB, gl.UNSIGNED_INT_10F_11F_11F_REV, color);
	add(G.FORMAT_RGB9E5_UFLOAT, gl.RGB9_E5, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, color);
	add(G.FORMAT_RGBA32_FLOAT, gl.RGBA32F, gl.RGBA, gl.FLOAT, color);
	add(G.FORMAT_R32_UINT, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, color);
	add(G.FORMAT_R32_FLOAT, gl.R32F, gl.RED, gl.FLOAT, color);
	add(G.FORMAT_RGBA32_UINT, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, color);
	const depth = gl.DEPTH_ATTACHMENT;
	add(G.FORMAT_DEPTH24_PLUS, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, depth);
	add(G.FORMAT_DEPTH32_FLOAT, gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT, depth);
	add(G.FORMAT_DEPTH16_UNORM, gl.DEPTH_COMPONENT16, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, depth);
	return formats;
}

function glTexture(
	texture: WebGLTexture | null,
	renderbuffer: WebGLRenderbuffer | null,
	target: number,
	width: number,
	height: number,
	format: GlFormat,
	mips: number,
	level: number,
	layer: number,
	view: boolean,
): GlTexture {
	return {
		texture,
		renderbuffer,
		target,
		width,
		height,
		format,
		mips,
		level,
		layer,
		view,
		written: false,
		framebuffer: null,
		framebufferDepth: null,
		soloFramebuffer: null,
		copyFramebuffer: null,
	};
}

export class WebGL2Backend {
	private readonly buffers: (GlBuffer | undefined)[] = [];
	private readonly textures: (GlTexture | undefined)[] = [];
	private readonly samplers: (WebGLSampler | undefined)[] = [];
	/** Images for uploads, by id, which outlive the backend when the drawing thread owns them. */
	private readonly images: ImageTable;
	private readonly ownsImages: boolean;
	private readonly pipelines: (Pipeline | undefined)[] = [];
	/** The programs of the templates and permutations in use, which their pipelines share. */
	private readonly programs = new Map<string, Program>();
	private readonly templates: (GlslTemplate | undefined)[];
	/** The template of the program that draws mip levels. */
	private readonly mipTemplate: GlslTemplate;
	private readonly copyTemplate: GlslTemplate;
	private readonly bindGroups: (BindEntry[] | undefined)[] = [];
	private readonly vertexArrays: (VertexArray | undefined)[] = [];
	/** Vertex arrays of the buffers that templates with their own vertex layout draw from, by id. */
	private readonly layoutArrays: (LayoutArray | undefined)[] = [];
	private readonly formats: (GlFormat | undefined)[];
	/** GL's address modes and min filters, by the draw list's codes. */
	private readonly addressModes: number[] = [];
	/** GL's texture target for each binding view dimension. */
	private readonly targets: number[] = [];
	private readonly minFilters: number[][] = [];
	private readonly multiDraw: WEBGL_multi_draw | null;
	/**
	 * `KHR_parallel_shader_compile`, where the context has it and the device uses it: programs then
	 * compile in the background, and the backend asks whether each has finished.
	 */
	private readonly parallel: KHR_parallel_shader_compile | null;
	/** Programs that may still be compiling in the background. */
	private readonly compiling: Program[] = [];
	/**
	 * The operands of each `CreateRenderPipeline` whose custom material's shader has not reached
	 * this thread yet, by pipeline id. Each is created once its shader arrives; until then, its
	 * draws draw nothing.
	 */
	private readonly parked = new Map<number, Uint32Array>();
	/**
	 * The device shaders that load another module when a pipeline needs builds with other fixed
	 * bits. Without it, every pipeline's build must be in the shaders that the backend got.
	 */
	moreShaders: DeviceShaderSet | undefined;
	/** True while the current pipeline's program is compiling: draws draw nothing until it is set again. */
	private skipDraws = false;
	private readonly anisotropic: EXT_texture_filter_anisotropic | null;
	private readonly maxAnisotropy: number;
	private readonly maxSamples: number;
	private readonly depth: DepthSetup;
	/** A vertex array with no attributes, for draws whose vertex shaders make their vertices. */
	private shaderVertices: WebGLVertexArrayObject | null = null;
	/** The framebuffer through which copies read their source. */
	private copyFramebuffer: WebGLFramebuffer | null = null;
	/** The ring of pixel unpack buffers that texture rewrites go through, and their sizes in bytes. */
	private readonly unpackBuffers: (WebGLBuffer | null)[] = new Array(UNPACK_RING).fill(null);
	private readonly unpackSizes = new Array<number>(UNPACK_RING).fill(0);
	/** The ring slot of the replay under way, and the bytes that its writes have taken in it. */
	private unpackSlot = 0;
	private unpackUsed = 0;
	/** The framebuffer through which a mip level is drawn, and the sampler that reads the level before. */
	private mipFramebuffer: WebGLFramebuffer | null = null;
	private mipSampler: WebGLSampler | null = null;
	/** How the texture generators draw with programs of their own. */
	private readonly programHost: ProgramHost;
	/**
	 * The texture that each mip level, and each copied layer of an array, draws into before it
	 * copies into its place, by format.
	 */
	private readonly spares = new Map<number, GlTexture>();
	/** Where drawing into the canvas goes during a capture; the canvas itself otherwise. */
	canvasTarget: CanvasTarget | undefined;
	/**
	 * What the replays since the last reset uploaded, drew and built, the other objects they made,
	 * and the draw commands they skipped because the program was still compiling.
	 */
	readonly counts = { uploadBytes: 0, drawCalls: 0, pipelines: 0, objects: 0, skippedDraws: 0 };

	// Views on engine memory, rebuilt when it grows, and copies for browsers that refuse views on
	// shared memory. The replay's own views give the words and the floats.
	private memory: ArrayBufferLike | undefined;
	private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	private halves: Uint16Array<ArrayBufferLike> = new Uint16Array(0);
	private ints: Int32Array<ArrayBufferLike> = new Int32Array(0);
	private uints: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
	private floats: Float32Array<ArrayBufferLike> = new Float32Array(0);
	private copying = false;
	private staging = new ArrayBuffer(0);
	private stagingBytes = new Uint8Array(0);
	private stagingHalves = new Uint16Array(0);
	private stagingFloats = new Float32Array(0);
	private stagingUints = new Uint32Array(0);
	private stagingInts = new Int32Array(0);
	/** A multi-draw call's counts, offsets and instance counts, one after another. */
	private drawLists = new Int32Array(3 * G.SIZE_MULTI_DRAW_RECORDS);

	// The state cache.
	private program: WebGLProgram | null = null;
	private vertexArray: WebGLVertexArrayObject | null = null;
	private activeUnit = -1;
	private readonly unitTextures: (WebGLTexture | null)[] = [];
	private readonly unitSamplers: (WebGLSampler | null)[] = [];
	/** The texture that bind groups set at each slot, which the program's unit for the slot gets. */
	private readonly slotTextures: (WebGLTexture | null)[] = [];
	/** The target of each slot's texture. */
	private readonly slotTargets: number[] = [];
	/** The sampler that bind groups set at each slot, which the units that read it get. */
	private readonly slotSamplers: (WebGLSampler | null)[] = [];
	/**
	 * True when the program, the bind groups' textures or samplers, or a unit that a spare program
	 * borrowed changed since the program's units were set.
	 */
	private unitsChanged = true;
	private readonly blockBuffers: (WebGLBuffer | null)[] = [];
	private readonly blockOffsets: number[] = [];
	private readonly blockSizes: number[] = [];
	/** The faces that GL culls: `BACK` or `FRONT`, or 0 while culling is off. */
	private cullFace = 0;
	/** The faces that GL culls while culling is on, which starts as GL's default. */
	private cullMode = CULL_BACK;
	private depthTest = false;
	private depthMask = true;
	/** GL's depth function, which starts as the depth mode's own. */
	private depthFunc: number;
	private colorMask = true;
	private blend = 0;
	private offsetFactor = 0;
	private offsetUnits = 0;
	// Fractions passed to WebGL become new number objects, so the clear values and the depth range
	// are set only when they change. The depth values are the draw list's, before any turn.
	private readonly clearColor = [0, 0, 0, 0];
	private clearDepth: number;
	private readonly viewport = [0, 0, 0, 0];
	private depthNear = 0;
	private depthFar = 1;
	private scissorTest = false;
	private readonly scissor = [0, 0, 0, 0];

	// The pass and draw state the list set last.
	private current: Pipeline | undefined;
	private vertexBuffer = 0;
	private indexBuffer = 0;
	private indexType = 0;
	private indexBytes = 2;
	private passFramebuffer: WebGLFramebuffer | null = null;
	private passWidth = 0;
	private passHeight = 0;
	private passResolve = G.NO_TARGET;
	/** The pass's depth target, whose one-sample copy the pass's end updates when it has one. */
	private passDepth: GlTexture | null = null;
	private passFlags = 0;
	private passToCanvas = false;

	/**
	 * `shaders` are the GLSL builds that the device loaded (`loadGlslShaders`), with the bits
	 * that it fixes. `sharedUploads` is false where WebGL refuses views on shared memory, so uploads
	 * and multi-draw arrays go through copies. `depthMode` is how the backend stores depth.
	 * `images` holds the images that uploads read, which the thread that draws keeps across GPU
	 * devices; by default the backend has its own. `parallelCompile` lets programs compile in the
	 * background where the context has `KHR_parallel_shader_compile`. `canvasAlpha` says whether
	 * the canvas's context has alpha.
	 */
	constructor(
		private readonly gl: WebGL2RenderingContext,
		private readonly canvas: OffscreenCanvas | HTMLCanvasElement,
		shaders: DeviceShaders,
		private readonly sharedUploads: boolean,
		depthMode: DepthMode,
		images?: ImageTable,
		parallelCompile = true,
		canvasAlpha = false,
	) {
		this.templates = engineTemplates(shaders);
		this.mipTemplate = mipmapTemplate(shaders, 'main');
		this.copyTemplate = mipmapTemplate(shaders, 'copy');
		this.images = images ?? new ImageTable();
		this.ownsImages = !images;
		this.multiDraw = gl.getExtension('WEBGL_multi_draw');
		this.parallel = parallelCompile ? gl.getExtension('KHR_parallel_shader_compile') : null;
		// Float render targets, for HDR color, where the device draws them: WebGL turns them on only
		// when the extensions are asked for by name.
		gl.getExtension('EXT_color_buffer_float');
		gl.getExtension('EXT_color_buffer_half_float');
		this.anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
		this.maxAnisotropy = this.anisotropic
			? (gl.getParameter(this.anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number)
			: 1;
		this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
		this.formats = glFormats(gl, canvasAlpha);
		this.targets[G.VIEW_2D] = gl.TEXTURE_2D;
		this.targets[G.VIEW_2D_ARRAY] = gl.TEXTURE_2D_ARRAY;
		this.targets[G.VIEW_CUBE] = gl.TEXTURE_CUBE_MAP;
		this.targets[G.VIEW_3D] = gl.TEXTURE_3D;
		this.addressModes[G.ADDRESS_CLAMP_TO_EDGE] = gl.CLAMP_TO_EDGE;
		this.addressModes[G.ADDRESS_REPEAT] = gl.REPEAT;
		this.addressModes[G.ADDRESS_MIRROR_REPEAT] = gl.MIRRORED_REPEAT;
		this.minFilters[G.FILTER_NEAREST] = [];
		this.minFilters[G.FILTER_LINEAR] = [];
		(this.minFilters[G.FILTER_NEAREST] as number[])[G.FILTER_NEAREST] = gl.NEAREST_MIPMAP_NEAREST;
		(this.minFilters[G.FILTER_NEAREST] as number[])[G.FILTER_LINEAR] = gl.NEAREST_MIPMAP_LINEAR;
		(this.minFilters[G.FILTER_LINEAR] as number[])[G.FILTER_NEAREST] = gl.LINEAR_MIPMAP_NEAREST;
		(this.minFilters[G.FILTER_LINEAR] as number[])[G.FILTER_LINEAR] = gl.LINEAR_MIPMAP_LINEAR;
		this.indexType = gl.UNSIGNED_SHORT;
		this.depth = setDepthMode(gl, depthMode);
		this.programHost = programHost(gl, this.depth, this.parallel);
		const host = this.programHost;
		this.images.warmGeneratorsWith((code) => (code as CubeGenerator).prepare(host));
		this.depthFunc = this.nearerPasses();
		// GL clears depth to 1 until told otherwise, which is the draw list's 0 in standard depth.
		this.clearDepth = this.depth.standard ? 0 : 1;
		// Texel rows in engine memory are tightly packed, whatever their width.
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		this.prebuildSparePrograms();
	}

	private need<T>(table: (T | undefined)[], id: number, what: string): T {
		const value = table[id];
		if (value === undefined) throw new Error(`draw list names ${what} ${id}, which does not exist`);
		return value;
	}

	/**
	 * Adds a render pipeline template, which `CreateRenderPipeline` then builds programs from. The
	 * id must be one that no engine template has.
	 */
	defineTemplate(id: number, template: GlslTemplate): void {
		if (this.templates[id]) throw new Error(`render pipeline template ${id} already exists`);
		this.templates[id] = template;
	}

	/** Hands the backend an image for `UploadImage` commands to copy from, under the draw list's id. */
	setImage(id: number, image: ImageBitmap): void {
		this.images.set(id, image);
	}

	/**
	 * Starts to build each pipeline that the list in `words[start, end)` creates before its first
	 * other command, and returns where the rest of the list starts. Programs compile without
	 * blocking where the context has `KHR_parallel_shader_compile`. Until one has compiled,
	 * `building` is true and the draws that use it draw nothing. Without the extension, a program's
	 * first draw waits for its compile.
	 */
	prepare(words: Uint32Array, start: number, end: number): number {
		let i = start;
		while (i < end && ((words[i] as number) & 0xff) === G.OP_CREATE_RENDER_PIPELINE) {
			this.createPipeline(words, i + 1, true);
			i += (words[i] as number) >>> 8;
		}
		return i;
	}

	/**
	 * True while a program is compiling in the background, or a pipeline waits for its custom
	 * material's shader. Pipelines whose shaders arrived are created first.
	 */
	get building(): boolean {
		if (this.parked.size > 0) this.unpark();
		const compiling = this.compiling;
		for (let k = compiling.length - 1; k >= 0; k--) {
			if (this.compiled(compiling[k] as Program)) {
				compiling[k] = compiling[compiling.length - 1] as Program;
				compiling.pop();
			}
		}
		return compiling.length > 0 || this.parked.size > 0;
	}

	/**
	 * True when a render pipeline template can create a program of `permutation` now: an engine
	 * template whose build for it is loaded, or a custom material's whose shader arrived, which it
	 * defines at its first use.
	 */
	private templateReady(template: number, permutation: number): boolean {
		let defined = this.templates[template];
		if (!defined) {
			const shader = this.images.shaders.get(template);
			if (!shader) return false;
			// A custom material's prepass draws with its own vertex shader, as every mesh's does. A
			// custom effect's or tone curve's template draws one triangle, as the final pass does.
			defined =
				shader.kind === undefined
					? { shader: shader.variants, pipeline: 'main', meshPrepass: true }
					: { shader: shader.variants, pipeline: 'main' };
			this.templates[template] = defined;
		}
		const build = buildPermutation(defined, permutation);
		return this.moreShaders?.ready(defined.shader, build, 'glsl') ?? true;
	}

	/**
	 * Starts to compile the programs of the builds of `module`, a feature's module that the page or
	 * the sketch preloaded, so that the feature's first objects draw at once. They compile in the
	 * background where the browser can, and the first frame waits for them. Skinning's and morph
	 * targets' builds vary in every material bit, and a scene's materials draw with a few of them, so
	 * `scene.warmUp()` builds those, as for any material.
	 */
	precompile(feature: string, module: FirstUseShaders): void {
		if (WARM_UP_FEATURES.has(feature)) return;
		const held = this.moreShaders?.shaders as Readonly<Record<string, ShaderVariants>> | undefined;
		for (const [name, builds] of Object.entries(module)) {
			const variants = held?.[name];
			if (!variants) continue;
			this.templates.forEach((template, id) => {
				if (template?.shader !== variants) return;
				for (const build of Object.values(builds as ShaderVariants))
					if (build.glsl?.[template.pipeline]) this.programOf(id, build.permutation, true);
			});
		}
	}

	/** Creates each parked pipeline whose custom material's shader has arrived. */
	private unpark(): void {
		for (const [id, operands] of this.parked) {
			if (!this.templateReady(operands[1] as number, operands[2] as number)) continue;
			this.parked.delete(id);
			this.counts.pipelines--;
			this.createPipeline(operands, 0, true);
		}
	}

	/**
	 * True once a program may be used without waiting: it has compiled and linked, or failed to, or
	 * its first draw waits for its compile.
	 */
	private compiled(p: Program): boolean {
		const parallel = this.parallel;
		return (
			p.ready ||
			!p.background ||
			!parallel ||
			this.gl.getProgramParameter(p.program, parallel.COMPLETION_STATUS_KHR) === true
		);
	}

	/**
	 * Creates the pipeline of a `CreateRenderPipeline` command with its operands at `a`. A new
	 * program compiles in the background when `background` is set; otherwise its first draw waits
	 * for it.
	 */
	private createPipeline(words: Uint32Array, a: number, background: boolean): void {
		const template = words[a + 1] as number;
		const flags = words[a + 6] as number;
		if (!this.templateReady(template, words[a + 2] as number)) {
			// The command's header, before its operands, gives its length in words.
			this.parked.set(words[a] as number, words.slice(a, a - 1 + ((words[a - 1] as number) >>> 8)));
			this.counts.pipelines++;
			return;
		}
		const depth = words[a + 4] !== G.FORMAT_NONE;
		// The list's bias is in reversed depth. Standard depth stores the near plane as 0, so a bias
		// toward the camera turns negative there.
		const sign = this.depth.standard ? -1 : 1;
		this.pipelines[words[a] as number] = {
			program: this.programOf(template, words[a + 2] as number, background),
			cull: this.cullOf(flags),
			depth,
			depthWrite: depth && (flags & (G.STATE_NO_DEPTH_WRITE | G.STATE_NO_DEPTH_TEST)) === 0,
			depthFunc: this.depthFuncOf(flags),
			colorWrite: (flags & G.STATE_NO_COLOR_WRITE) === 0,
			blend: flags & G.STATE_BLEND,
			offsetUnits: sign * ((words[a + 8] as number) | 0),
			offsetFactor: sign * floatOfBits(words[a + 9] as number),
			vertexFormat: words[a + 7] as number,
			mode: flags & G.STATE_LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES,
			vertices: this.need(this.templates, template, 'render pipeline template').vertices,
		};
		this.counts.pipelines++;
	}

	resetCounts(): void {
		this.counts.uploadBytes = 0;
		this.counts.drawCalls = 0;
		this.counts.pipelines = 0;
		this.counts.objects = 0;
		this.counts.skippedDraws = 0;
	}

	/**
	 * Replays the draw list in `words[start, end)`. `floats` views the same memory as `words`, for
	 * float operands; `memory` is the engine memory that uploads read from.
	 */
	replay(
		words: Uint32Array,
		floats: Float32Array,
		start: number,
		end: number,
		memory: ArrayBufferLike,
	): void {
		if (memory !== this.memory) {
			this.memory = memory;
			this.bytes = new Uint8Array(memory);
			this.halves = new Uint16Array(memory);
			this.ints = new Int32Array(memory);
			this.copying =
				!this.sharedUploads &&
				typeof SharedArrayBuffer === 'function' &&
				memory instanceof SharedArrayBuffer;
		}
		this.uints = words;
		this.floats = floats;
		this.unpackSlot = (this.unpackSlot + 1) % UNPACK_RING;
		this.unpackUsed = 0;
		const gl = this.gl;
		for (let i = start; i < end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			const length = header >>> 8;
			if (length === 0 || i + length > end) throw new Error(`draw list is truncated at word ${i}`);
			const a = i + 1;
			switch (op) {
				case G.OP_CREATE_BUFFER:
					this.counts.objects++;
					this.createBuffer(words[a] as number, words[a + 1] as number, words[a + 2] as number);
					break;
				case G.OP_WRITE_BUFFER: {
					const buffer = this.need(this.buffers, words[a] as number, 'buffer').buffer;
					const offset = words[a + 1] as number;
					const source = words[a + 2] as number;
					const bytes = words[a + 3] as number;
					gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
					this.writeBytes(gl.COPY_WRITE_BUFFER, offset, source, bytes);
					this.counts.uploadBytes += bytes;
					break;
				}
				case G.OP_DESTROY_BUFFER:
					this.destroyBuffer(words[a] as number);
					break;
				case G.OP_CREATE_TEXTURE:
					this.counts.objects++;
					this.createTexture(words, a);
					break;
				case G.OP_CREATE_TEXTURE_VIEW:
					this.counts.objects++;
					this.createView(words, a);
					break;
				case G.OP_DESTROY_TEXTURE:
					this.destroyTexture(words[a] as number);
					break;
				case G.OP_WRITE_TEXTURE:
					this.writeTexture(words, a);
					break;
				case G.OP_UPLOAD_IMAGE:
					this.uploadImage(words, a);
					break;
				case G.OP_RELEASE_IMAGE:
					this.images.release(words[a] as number);
					break;
				case G.OP_DESTROY_PIPELINE:
					this.destroyPipeline(words[a] as number);
					break;
				case G.OP_GENERATE_TEXTURE:
					this.generateTexture(words, a);
					break;
				case G.OP_GENERATE_MIPMAPS:
					this.generateMipmaps(words[a] as number, words[a + 1] as number);
					break;
				case G.OP_COPY_TEXTURE_TO_TEXTURE:
					this.copyTexture(words, a);
					break;
				case G.OP_CREATE_SAMPLER:
					this.counts.objects++;
					this.createSampler(words, floats, a);
					break;
				case G.OP_RESIZE_CANVAS: {
					const width = words[a] as number;
					const height = words[a + 1] as number;
					if (this.canvas.width !== width || this.canvas.height !== height) {
						this.canvas.width = width;
						this.canvas.height = height;
					}
					break;
				}
				case G.OP_CREATE_RENDER_PIPELINE:
					// A list that creates a pipeline after other commands waits for it at its first draw.
					this.createPipeline(words, a, false);
					break;
				case G.OP_CREATE_BIND_GROUP: {
					this.counts.objects++;
					const entries: BindEntry[] = [];
					for (let k = 0; k < (words[a + 2] as number); k++) {
						const e = a + 3 + k * 5;
						entries.push({
							binding: words[e] as number,
							kind: words[e + 1] as number,
							resource: words[e + 2] as number,
							offset: words[e + 3] as number,
							size: words[e + 4] as number,
						});
					}
					this.bindGroups[words[a] as number] = entries;
					break;
				}
				case G.OP_BEGIN_RENDER_PASS:
					this.beginPass(words, floats, a);
					break;
				case G.OP_END_RENDER_PASS:
					this.endPass();
					break;
				case G.OP_SET_VIEWPORT:
					this.setViewport(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 3] as number,
					);
					this.setDepthRange(floats[a + 4] as number, floats[a + 5] as number);
					break;
				case G.OP_SET_SCISSOR:
					this.setScissor(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 3] as number,
					);
					break;
				case G.OP_SET_PIPELINE: {
					const id = words[a] as number;
					// A pipeline that waits for its custom material's shader draws nothing.
					if (this.parked.has(id)) this.skipDraws = true;
					else this.setPipeline(this.need(this.pipelines, id, 'render pipeline'));
					break;
				}
				case G.OP_SET_BIND_GROUP:
					this.setBindGroup(words, a);
					break;
				case G.OP_SET_VERTEX_BUFFER:
					if (words[a] !== 0) throw new Error('the WebGL2 backend reads vertices from slot 0 only');
					this.vertexBuffer = words[a + 1] as number;
					break;
				case G.OP_SET_INDEX_BUFFER:
					this.indexBuffer = words[a] as number;
					this.indexType =
						words[a + 1] === G.INDEX_FORMAT_UINT32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
					this.indexBytes = words[a + 1] === G.INDEX_FORMAT_UINT32 ? 4 : 2;
					break;
				case G.OP_DRAW:
					if (this.skipDraws) {
						this.counts.skippedDraws++;
						break;
					}
					this.useVertexArray(this.drawVertexArray());
					this.prepareDraw(words[a + 3] as number);
					gl.drawArraysInstanced(
						(this.current as Pipeline).mode,
						words[a + 2] as number,
						words[a] as number,
						words[a + 1] as number,
					);
					this.counts.drawCalls++;
					break;
				case G.OP_DRAW_INDEXED: {
					if (this.skipDraws) {
						this.counts.skippedDraws++;
						break;
					}
					if (words[a + 3] !== 0) throw new Error('WebGL2 has no base vertex for draws');
					this.useMeshVertexArray();
					this.prepareDraw(words[a + 4] as number);
					gl.drawElementsInstanced(
						(this.current as Pipeline).mode,
						words[a] as number,
						this.indexType,
						(words[a + 2] as number) * this.indexBytes,
						words[a + 1] as number,
					);
					this.counts.drawCalls++;
					break;
				}
				case G.OP_MULTI_DRAW_INDEXED:
					if (this.skipDraws) this.counts.skippedDraws++;
					else this.multiDrawIndexed(words, a);
					break;
				case G.OP_SUBMIT:
					break;
				default:
					throw new Error(`the WebGL2 backend cannot replay draw list command ${op} at word ${i}`);
			}
			i += length;
		}
	}

	/**
	 * The program that draws mip levels, or the one that copies a layer, which starts compiling the
	 * first time.
	 */
	private spareProgramOf(key: typeof MIP_PROGRAM | typeof COPY_PROGRAM): Program {
		let program = this.programs.get(key);
		if (!program) {
			const template = key === MIP_PROGRAM ? this.mipTemplate : this.copyTemplate;
			program = createProgram(this.gl, template, 0);
			this.programs.set(key, program);
		}
		return program;
	}

	/**
	 * Starts compiling the programs that draw mip levels and copy layers, so that the driver can
	 * compile them before the first texture upload needs them. Nothing waits for their link here.
	 * A program that fails to start is made again at first use, which reports the failure.
	 */
	private prebuildSparePrograms(): void {
		for (const key of [MIP_PROGRAM, COPY_PROGRAM] as const) {
			try {
				this.spareProgramOf(key);
			} catch {}
		}
	}

	/**
	 * The program that draws mip levels, or the one that copies a layer, in use. Its first use
	 * waits for its link when the driver has not finished it.
	 */
	private spareProgram(key: typeof MIP_PROGRAM | typeof COPY_PROGRAM): Program {
		const program = this.spareProgramOf(key);
		this.useProgram(program);
		return program;
	}

	/** Puts a program in use, first checking its link and binding its slots at its first use. */
	private useProgram(program: Program): void {
		if (!program.ready) {
			prepareProgram(this.gl, program, this.depth);
			this.program = program.program;
		}
		if (this.program !== program.program) {
			this.gl.useProgram(program.program);
			this.program = program.program;
		}
	}

	/**
	 * The program of a template and permutation, which starts compiling the first time, in the
	 * background when `background` is set and the context can.
	 */
	/**
	 * Forgets a render pipeline, and deletes its program once no other pipeline uses it. A pipeline
	 * that is gone already, as when a capture replays a list again, changes nothing.
	 */
	private destroyPipeline(id: number): void {
		this.parked.delete(id);
		const program = this.pipelines[id]?.program;
		this.pipelines[id] = undefined;
		if (!program || this.pipelines.some((p) => p?.program === program)) return;
		for (const [key, held] of this.programs) if (held === program) this.programs.delete(key);
		const compiling = this.compiling.indexOf(program);
		if (compiling >= 0) this.compiling.splice(compiling, 1);
		for (const shader of program.shaders) this.gl.deleteShader(shader);
		this.gl.deleteProgram(program.program);
	}

	private programOf(template: number, permutation: number, background: boolean): Program {
		const key = `${template} ${permutation}`;
		let program = this.programs.get(key);
		if (!program) {
			const glsl = this.need(this.templates, template, 'render pipeline template');
			program = createProgram(this.gl, glsl, permutation);
			this.programs.set(key, program);
			if (background && this.parallel) {
				program.background = true;
				this.compiling.push(program);
			}
		}
		return program;
	}

	/** Makes the staging buffer hold at least `bytes`. */
	private ensureStaging(bytes: number): void {
		if (this.staging.byteLength >= bytes) return;
		this.staging = new ArrayBuffer(Math.max(bytes, this.staging.byteLength * 2));
		this.stagingBytes = new Uint8Array(this.staging);
		this.stagingHalves = new Uint16Array(this.staging);
		this.stagingFloats = new Float32Array(this.staging);
		this.stagingUints = new Uint32Array(this.staging);
		this.stagingInts = new Int32Array(this.staging);
	}

	/**
	 * Copies bytes out of shared memory into the staging buffer, and returns them. Uploads start and
	 * end on four-byte boundaries, so a loop copies whole words, which makes no view per upload.
	 */
	private stage(source: number, bytes: number): Uint8Array {
		this.ensureStaging(bytes);
		const from = source >>> 2;
		const staged = this.stagingInts;
		const ints = this.ints;
		for (let k = 0; k < bytes >>> 2; k++) staged[k] = ints[from + k] as number;
		return this.stagingBytes;
	}

	/** True for the GL types whose texels uploads read as whole 32-bit words: packed and integer. */
	private wordTexels(type: number): boolean {
		const gl = this.gl;
		return (
			type === gl.UNSIGNED_INT ||
			type === gl.UNSIGNED_INT_5_9_9_9_REV ||
			type === gl.UNSIGNED_INT_10F_11F_11F_REV
		);
	}

	/** The view of values of GL type `type` that texel uploads read: engine memory, or its staged copy. */
	private texels(type: number): ArrayBufferView {
		const gl = this.gl;
		const staged = this.copying;
		if (type === gl.FLOAT) return staged ? this.stagingFloats : this.floats;
		if (this.wordTexels(type)) return staged ? this.stagingUints : this.uints;
		if (type === gl.HALF_FLOAT) return staged ? this.stagingHalves : this.halves;
		return staged ? this.stagingBytes : this.bytes;
	}

	/**
	 * The index in the view of `texels(type)` of the value `offset` bytes after byte `source` of
	 * engine memory. A staged upload starts at the staging buffer's first byte.
	 */
	private texelIndex(type: number, source: number, offset: number): number {
		const byte = (this.copying ? 0 : source) + offset;
		const gl = this.gl;
		if (type === gl.FLOAT || this.wordTexels(type)) return byte >>> 2;
		return type === gl.HALF_FLOAT ? byte >>> 1 : byte;
	}

	/** True for the GL targets whose layers or depth slices a call reaches with a third coordinate. */
	private layered(target: number): boolean {
		return target === this.gl.TEXTURE_2D_ARRAY || target === this.gl.TEXTURE_3D;
	}

	/**
	 * The GL target of one layer of a texture that calls in two dimensions reach: a cube's face, or
	 * the texture itself when it is 2D.
	 */
	private planeTarget(texture: GlTexture, layer: number): number {
		const gl = this.gl;
		return texture.target === gl.TEXTURE_CUBE_MAP
			? gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer
			: texture.target;
	}

	private useVertexArray(vao: WebGLVertexArrayObject | null): void {
		if (this.vertexArray === vao) return;
		this.gl.bindVertexArray(vao);
		this.vertexArray = vao;
	}

	private bindTexture(unit: number, target: number, texture: WebGLTexture | null): void {
		if (this.unitTextures[unit] === texture) return;
		this.activate(unit);
		this.gl.bindTexture(target, texture);
		this.unitTextures[unit] = texture;
	}

	private activate(unit: number): void {
		if (this.activeUnit === unit) return;
		this.gl.activeTexture(this.gl.TEXTURE0 + unit);
		this.activeUnit = unit;
	}

	/**
	 * Binds a texture for the calls that change it, which act on the active unit: when the texture
	 * is bound already, a bind group may have made another unit active since.
	 */
	private editTexture(unit: number, target: number, texture: WebGLTexture | null): void {
		this.bindTexture(unit, target, texture);
		this.activate(unit);
	}

	private createBuffer(id: number, size: number, usage: number): void {
		const gl = this.gl;
		this.destroyBuffer(id);
		const buffer = gl.createBuffer();
		if (!buffer) throw new Error('WebGL2 could not create a buffer');
		// A buffer's first binding fixes its kind; an index buffer must first bind as one, which
		// also binds it to the current vertex array, so none may be current.
		const target =
			usage & G.BUFFER_USAGE_INDEX
				? gl.ELEMENT_ARRAY_BUFFER
				: usage & G.BUFFER_USAGE_UNIFORM
					? gl.UNIFORM_BUFFER
					: gl.ARRAY_BUFFER;
		this.useVertexArray(null);
		gl.bindBuffer(target, buffer);
		gl.bufferData(target, size, gl.DYNAMIC_DRAW);
		this.buffers[id] = { buffer, size };
	}

	private destroyBuffer(id: number): void {
		const old = this.buffers[id];
		if (!old) return;
		this.gl.deleteBuffer(old.buffer);
		this.buffers[id] = undefined;
		for (let slot = 0; slot < this.blockBuffers.length; slot++)
			if (this.blockBuffers[slot] === old.buffer) this.blockBuffers[slot] = null;
	}

	private format(code: number): GlFormat {
		const format = this.formats[code];
		if (!format) throw new Error(`the WebGL2 backend has no texture format ${code}`);
		return format;
	}

	/**
	 * Creates a texture. A render target that nothing samples or copies lives in a renderbuffer,
	 * and so does every multisampled one, since WebGL2 has no multisampled textures. A multisampled
	 * depth target that shaders read also gets a texture of one sample, which they read instead:
	 * WebGPU's shaders read its sample 0, and WebGL2 copies one sample of each pixel.
	 */
	private createTexture(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const id = words[a] as number;
		const width = words[a + 1] as number;
		const height = words[a + 2] as number;
		const layers = words[a + 3] as number;
		const format = this.format(words[a + 4] as number);
		const usage = words[a + 5] as number;
		const samples = words[a + 6] as number;
		const mips = words[a + 7] as number;
		this.destroyTexture(id);
		const read =
			G.TEXTURE_USAGE_TEXTURE_BINDING | G.TEXTURE_USAGE_COPY_SRC | G.TEXTURE_USAGE_COPY_DST;
		if (samples > 1 || (usage & G.TEXTURE_USAGE_RENDER_ATTACHMENT && !(usage & read))) {
			const renderbuffer = gl.createRenderbuffer();
			if (!renderbuffer) throw new Error('WebGL2 could not create a renderbuffer');
			gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
			if (samples > 1) {
				gl.renderbufferStorageMultisample(
					gl.RENDERBUFFER,
					Math.min(samples, this.maxSamples),
					format.internal,
					width,
					height,
				);
			} else {
				gl.renderbufferStorage(gl.RENDERBUFFER, format.internal, width, height);
			}
			const copied = samples > 1 && usage & G.TEXTURE_USAGE_TEXTURE_BINDING;
			const copy = copied ? this.depthCopy(width, height, format) : null;
			const target = copy ? gl.TEXTURE_2D : 0;
			this.textures[id] = glTexture(
				copy,
				renderbuffer,
				target,
				width,
				height,
				format,
				1,
				0,
				0,
				false,
			);
			return;
		}
		const texture = gl.createTexture();
		if (!texture) throw new Error('WebGL2 could not create a texture');
		// WebGL2 fixes a texture's kind at its first binding, as compatibility mode fixes its view.
		const target = this.targets[words[a + 8] as number];
		if (target === undefined) throw new Error(`unknown texture view dimension ${words[a + 8]}`);
		this.editTexture(UPLOAD_UNIT, target, texture);
		if (this.layered(target)) gl.texStorage3D(target, mips, format.internal, width, height, layers);
		else gl.texStorage2D(target, mips, format.internal, width, height);
		// Shaders sample through sampler objects, which set their own filters. The texture's own
		// filters serve texelFetch, which needs a complete texture: 32-bit float and integer
		// textures are complete only with nearest filters.
		gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		this.textures[id] = glTexture(texture, null, target, width, height, format, mips, 0, 0, false);
	}

	/** The texture of one sample that shaders read in place of a multisampled depth target. */
	private depthCopy(width: number, height: number, format: GlFormat): WebGLTexture {
		const gl = this.gl;
		if (format.attachment !== gl.DEPTH_ATTACHMENT)
			throw new Error('WebGL2 reads only multisampled depth targets, through a copy of one sample');
		const texture = gl.createTexture();
		if (!texture) throw new Error('WebGL2 could not create a texture');
		this.editTexture(UPLOAD_UNIT, gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, format.internal, width, height);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		return texture;
	}

	/** A texture by id, which a view, a write, an upload or a copy can use: not a render-only one. */
	private textureOf(id: number): GlTexture {
		const record = this.need(this.textures, id, 'texture');
		if (!record.texture || record.view)
			throw new Error(`texture ${id} is a render target or a view, without texels of its own`);
		return record;
	}

	private createView(words: Uint32Array, a: number): void {
		const id = words[a] as number;
		this.destroyTexture(id);
		const texture = this.textureOf(words[a + 1] as number);
		const level = words[a + 2] as number;
		this.textures[id] = glTexture(
			texture.texture,
			null,
			texture.target,
			Math.max(1, texture.width >> level),
			Math.max(1, texture.height >> level),
			texture.format,
			texture.mips,
			level,
			words[a + 3] as number,
			true,
		);
	}

	private destroyTexture(id: number): void {
		const gl = this.gl;
		const old = this.textures[id];
		if (!old) return;
		this.textures[id] = undefined;
		this.forgetFramebuffers(old);
		if (old.view) return;
		if (old.texture) {
			for (const other of this.textures)
				if (other?.view && other.texture === old.texture) this.forgetFramebuffers(other);
			gl.deleteTexture(old.texture);
			for (let unit = 0; unit < this.unitTextures.length; unit++)
				if (this.unitTextures[unit] === old.texture) this.unitTextures[unit] = null;
			for (let slot = 0; slot < this.slotTextures.length; slot++)
				if (this.slotTextures[slot] === old.texture) this.slotTextures[slot] = null;
		}
		if (old.renderbuffer) gl.deleteRenderbuffer(old.renderbuffer);
	}

	/** Deletes the framebuffers that draw into a target, and those that pair it as their depth. */
	private forgetFramebuffers(target: GlTexture): void {
		const gl = this.gl;
		if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
		if (target.soloFramebuffer) gl.deleteFramebuffer(target.soloFramebuffer);
		if (target.copyFramebuffer) gl.deleteFramebuffer(target.copyFramebuffer);
		target.copyFramebuffer = null;
		target.framebuffer = null;
		target.framebufferDepth = null;
		target.soloFramebuffer = null;
		for (const other of this.textures) {
			if (other?.framebufferDepth !== target) continue;
			gl.deleteFramebuffer(other.framebuffer);
			other.framebuffer = null;
			other.framebufferDepth = null;
		}
	}

	/** Writes `bytes` bytes of engine memory from byte `source` into the buffer bound at `target`. */
	private writeBytes(target: number, offset: number, source: number, bytes: number): void {
		if (this.copying) this.gl.bufferSubData(target, offset, this.stage(source, bytes), 0, bytes);
		else this.gl.bufferSubData(target, offset, this.bytes, source, bytes);
	}

	/**
	 * Copies `bytes` bytes of engine memory into this replay's pixel unpack buffer, which it leaves
	 * bound, and returns where they start. A buffer too small for the replay's writes is made again
	 * larger: the writes already given keep the data of the buffer they read.
	 */
	private unpack(source: number, bytes: number): number {
		const gl = this.gl;
		const slot = this.unpackSlot;
		let buffer = this.unpackBuffers[slot] ?? null;
		if (!buffer) {
			buffer = gl.createBuffer();
			this.unpackBuffers[slot] = buffer;
		}
		gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
		let at = Math.ceil(this.unpackUsed / UNPACK_ALIGNMENT) * UNPACK_ALIGNMENT;
		const size = this.unpackSizes[slot] as number;
		if (at + bytes > size) {
			const grown = Math.max(bytes, 2 * size);
			gl.bufferData(gl.PIXEL_UNPACK_BUFFER, grown, gl.STREAM_DRAW);
			this.unpackSizes[slot] = grown;
			at = 0;
		}
		this.writeBytes(gl.PIXEL_UNPACK_BUFFER, at, source, bytes);
		this.unpackUsed = at + bytes;
		return at;
	}

	/**
	 * Writes a box of texels, layer after layer, from tightly packed rows in engine memory. The
	 * layers of a cube are its faces, and those of a 3D texture its depth slices. A
	 * compressed format's rows are rows of blocks: WebGL2 takes the box in texels, cut by the
	 * level's edge, and the bytes of its whole blocks. The texture's first write reads engine
	 * memory directly. Later writes into a texture of 32-bit values read a pixel unpack buffer, as
	 * the GPU may still read the texture.
	 */
	private writeTexture(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const texture = this.textureOf(words[a] as number);
		const source = words[a + 8] as number;
		const bytes = words[a + 9] as number;
		const { format, type, internal } = texture.format;
		const compressed = texture.format.block > 1;
		const level = words[a + 1] as number;
		const x = words[a + 2] as number;
		const y = words[a + 3] as number;
		const z = words[a + 4] as number;
		const width = words[a + 5] as number;
		const height = words[a + 6] as number;
		const depth = words[a + 7] as number;
		const target = texture.target;
		this.editTexture(UPLOAD_UNIT, target, texture.texture);
		const unpacked = texture.written && (type === gl.FLOAT || type === gl.UNSIGNED_INT);
		texture.written = true;
		const layered = this.layered(target);
		// A cube's faces take one call each, as calls in two dimensions reach one face.
		const planeBytes = bytes / depth;
		if (unpacked) {
			const at = this.unpack(source, bytes);
			if (layered) gl.texSubImage3D(target, level, x, y, z, width, height, depth, format, type, at);
			else
				for (let k = 0; k < depth; k++)
					gl.texSubImage2D(
						this.planeTarget(texture, z + k),
						level,
						x,
						y,
						width,
						height,
						format,
						type,
						at + k * planeBytes,
					);
			// Image uploads and direct writes read no unpack buffer.
			gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
		} else {
			if (this.copying) this.stage(source, bytes);
			const data = this.texels(type);
			if (layered && compressed)
				gl.compressedTexSubImage3D(
					target,
					level,
					x,
					y,
					z,
					width,
					height,
					depth,
					internal,
					data,
					this.texelIndex(type, source, 0),
					bytes,
				);
			else if (layered)
				gl.texSubImage3D(
					target,
					level,
					x,
					y,
					z,
					width,
					height,
					depth,
					format,
					type,
					data,
					this.texelIndex(type, source, 0),
				);
			else
				for (let k = 0; k < depth; k++) {
					const plane = this.planeTarget(texture, z + k);
					const index = this.texelIndex(type, source, k * planeBytes);
					if (compressed)
						gl.compressedTexSubImage2D(
							plane,
							level,
							x,
							y,
							width,
							height,
							internal,
							data,
							index,
							planeBytes,
						);
					else gl.texSubImage2D(plane, level, x, y, width, height, format, type, data, index);
				}
		}
		this.counts.uploadBytes += bytes;
	}

	/**
	 * Copies part of an image into a texture. WebGL applies no flip and no premultiplication to an
	 * image bitmap, so the texture gets the bitmap as its decoder made it. The pixel store's skips
	 * pick the part, as WebGL2 applies them to images too.
	 */
	private uploadImage(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const texture = this.textureOf(words[a] as number);
		const id = words[a + 7] as number;
		const image = this.images.need(id);
		const width = words[a + 5] as number;
		const height = words[a + 6] as number;
		const skipPixels = words[a + 9] as number;
		const skipRows = words[a + 10] as number;
		const { format, type } = texture.format;
		this.editTexture(UPLOAD_UNIT, texture.target, texture.texture);
		if (skipPixels) gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, skipPixels);
		if (skipRows) gl.pixelStorei(gl.UNPACK_SKIP_ROWS, skipRows);
		if (this.layered(texture.target)) {
			gl.texSubImage3D(
				texture.target,
				words[a + 1] as number,
				words[a + 2] as number,
				words[a + 3] as number,
				words[a + 4] as number,
				width,
				height,
				1,
				format,
				type,
				image,
			);
		} else {
			gl.texSubImage2D(
				this.planeTarget(texture, words[a + 4] as number),
				words[a + 1] as number,
				words[a + 2] as number,
				words[a + 3] as number,
				width,
				height,
				format,
				type,
				image,
			);
		}
		// Writes from engine memory read whole rows from their first texel.
		if (skipPixels) gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
		if (skipRows) gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
		this.counts.uploadBytes += width * height * texture.format.bytes;
		if ((words[a + 8] as number) & G.UPLOAD_RELEASE) this.images.release(id);
	}

	/**
	 * Makes mip levels 1 and up of one layer of a texture array, as the WebGPU backend does: a
	 * triangle over each level samples the level before it with a linear filter. Each level draws
	 * into the spare texture and then copies into its place, so no draw writes the texture it
	 * reads. Chrome on Adreno 830 refuses a draw into one level of a texture that the draw samples
	 * at another level, although WebGL allows it. A blit per level fails there too, and in Firefox
	 * it averages the stored bytes of sRGB texels, not their linear values. `generateMipmap` would
	 * remake every layer.
	 */
	private generateMipmaps(id: number, layer: number): void {
		const texture = this.textureOf(id);
		const program = this.beginSpareDraws(MIP_PROGRAM, texture, texture.width, texture.height);
		for (let level = 1; level < texture.mips; level++) {
			const width = Math.max(1, texture.width >> level);
			const height = Math.max(1, texture.height >> level);
			this.drawIntoSpare(program, texture, level - 1, layer, width, height);
			this.copyFromSpare(texture, level, 0, 0, layer, 0, 0, width, height);
		}
		this.endSpareDraws(texture);
	}

	/**
	 * Runs a generator that the table holds, which fills a whole cube texture on the GPU. The
	 * generator draws full-screen triangles with no depth test, culling, scissor or blending, and
	 * writes every channel. It changes bindings that the state cache holds, so the cache forgets
	 * them, and the next draws bind what they need again.
	 */
	private generateTexture(words: Uint32Array, a: number): void {
		const texture = this.textureOf(words[a] as number);
		const generator = words[a + 1] as number;
		const [source, code] = this.images.generator<CubeGenerator>(generator);
		this.setScissorTest(false);
		this.setDepthTest(false);
		this.setCullFace(0);
		this.setColorMask(true);
		if (this.blend) this.setBlend(0);
		this.useVertexArray(null);
		for (let unit = 0; unit < this.unitSamplers.length; unit++) this.bindUnitSampler(unit, null);
		code.run(
			this.programHost,
			texture.texture as WebGLTexture,
			texture.width,
			texture.mips,
			source,
		);
		this.program = null;
		this.activeUnit = -1;
		this.unitTextures.length = 0;
		this.blockBuffers.length = 0;
		this.viewport.fill(-1);
		this.unitsChanged = true;
	}

	/**
	 * Gets ready to draw layers of `source` into the spare texture of its format, at least `width`
	 * by `height`, with the program that `key` names. The source is bound for sampling.
	 */
	private beginSpareDraws(
		key: typeof MIP_PROGRAM | typeof COPY_PROGRAM,
		source: GlTexture,
		width: number,
		height: number,
	): Program {
		const gl = this.gl;
		const spare = this.spareOf(source.format, width, height);
		const program = this.spareProgram(key);
		if (!this.mipFramebuffer) this.mipFramebuffer = gl.createFramebuffer();
		if (!this.mipSampler) {
			this.mipSampler = gl.createSampler();
			gl.samplerParameteri(this.mipSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.samplerParameteri(this.mipSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.samplerParameteri(this.mipSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		}
		// The copies read the spare through the same framebuffer that the draws write.
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.mipFramebuffer);
		const attachment = source.format.attachment;
		gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, spare.texture, 0);
		this.useVertexArray(this.emptyVertexArray());
		this.setScissorTest(false);
		this.setDepthTest(false);
		this.setCullFace(0);
		this.setColorMask(true);
		if (this.blend) this.setBlend(0);
		this.editTexture(MIP_UNIT, gl.TEXTURE_2D_ARRAY, source.texture);
		this.bindUnitSampler(MIP_UNIT, this.mipSampler);
		this.unitsChanged = true;
		return program;
	}

	/**
	 * Draws one layer of the bound source into the spare's lower-left `width` by `height` texels.
	 * The program reads `level` of the source as its first level.
	 */
	private drawIntoSpare(
		program: Program,
		source: GlTexture,
		level: number,
		layer: number,
		width: number,
		height: number,
	): void {
		const gl = this.gl;
		if (program.firstInstance && program.firstInstanceValue !== layer) {
			gl.uniform1ui(program.firstInstance, layer);
			program.firstInstanceValue = layer;
		}
		this.editTexture(MIP_UNIT, gl.TEXTURE_2D_ARRAY, source.texture);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, level);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, level);
		this.setGlViewport(0, 0, width, height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	/** Copies a rectangle of the spare into a level of `into`: a layer, a cube face or a 3D slice. */
	private copyFromSpare(
		into: GlTexture,
		level: number,
		x: number,
		y: number,
		layer: number,
		spareX: number,
		spareY: number,
		width: number,
		height: number,
	): void {
		const gl = this.gl;
		this.editTexture(MIP_UNIT, into.target, into.texture);
		if (this.layered(into.target))
			gl.copyTexSubImage3D(into.target, level, x, y, layer, spareX, spareY, width, height);
		else {
			const plane = this.planeTarget(into, layer);
			gl.copyTexSubImage2D(plane, level, x, y, spareX, spareY, width, height);
		}
	}

	/** Gives the source back all its levels, and takes the spare out of the framebuffer. */
	private endSpareDraws(source: GlTexture): void {
		const gl = this.gl;
		this.editTexture(MIP_UNIT, gl.TEXTURE_2D_ARRAY, source.texture);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, 0);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, source.mips - 1);
		// A framebuffer that is not bound keeps what it holds alive, so the spare leaves it.
		const attachment = source.format.attachment;
		gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, null, 0);
	}

	/**
	 * The spare texture of a format, at least `width` by `height`. A smaller spare gives way to
	 * one that fits both sizes. Each spare stays for the next draws of its format.
	 */
	private spareOf(format: GlFormat, width: number, height: number): GlTexture {
		const gl = this.gl;
		const old = this.spares.get(format.internal);
		const w = Math.max(1, width, old?.width ?? 0);
		const h = Math.max(1, height, old?.height ?? 0);
		if (old && old.width === w && old.height === h) return old;
		if (old?.texture) gl.deleteTexture(old.texture);
		const spare = gl.createTexture();
		if (!spare) throw new Error('WebGL2 could not create a texture');
		this.editTexture(UPLOAD_UNIT, gl.TEXTURE_2D, spare);
		gl.texStorage2D(gl.TEXTURE_2D, 1, format.internal, w, h);
		const made = glTexture(spare, null, gl.TEXTURE_2D, w, h, format, 1, 0, 0, false);
		this.spares.set(format.internal, made);
		return made;
	}

	/** Attaches one mip level and layer of a texture to a framebuffer. */
	private attachLevel(
		framebuffer: number,
		attachment: number,
		texture: GlTexture,
		level: number,
		layer: number,
	): void {
		const gl = this.gl;
		if (this.layered(texture.target))
			gl.framebufferTextureLayer(framebuffer, attachment, texture.texture, level, layer);
		else
			gl.framebufferTexture2D(
				framebuffer,
				attachment,
				this.planeTarget(texture, layer),
				texture.texture,
				level,
			);
	}

	/**
	 * Copies texels layer by layer. Rows count as stored, the same as on WebGPU. A layer of a color
	 * texture array draws into the spare texture, which then copies into the destination: Chrome
	 * on Adreno 830 copies layer 0 from a framebuffer that holds another layer of an array. Other
	 * sources attach to a framebuffer, which WebGL2 copies from.
	 */
	private copyTexture(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const source = this.textureOf(words[a] as number);
		const sourceLevel = words[a + 1] as number;
		const sourceX = words[a + 2] as number;
		const sourceY = words[a + 3] as number;
		const sourceLayer = words[a + 4] as number;
		const destination = this.textureOf(words[a + 5] as number);
		const level = words[a + 6] as number;
		const x = words[a + 7] as number;
		const y = words[a + 8] as number;
		const layer = words[a + 9] as number;
		const width = words[a + 10] as number;
		const height = words[a + 11] as number;
		const layers = words[a + 12] as number;
		const attachment = source.format.attachment;
		if (source.target === gl.TEXTURE_2D_ARRAY && attachment === gl.COLOR_ATTACHMENT0) {
			const right = sourceX + width;
			const top = sourceY + height;
			const program = this.beginSpareDraws(COPY_PROGRAM, source, right, top);
			for (let k = 0; k < layers; k++) {
				this.drawIntoSpare(program, source, sourceLevel, sourceLayer + k, right, top);
				this.copyFromSpare(destination, level, x, y, layer + k, sourceX, sourceY, width, height);
			}
			this.endSpareDraws(source);
			return;
		}
		if (!this.copyFramebuffer) this.copyFramebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFramebuffer);
		this.editTexture(UPLOAD_UNIT, destination.target, destination.texture);
		for (let k = 0; k < layers; k++) {
			this.attachLevel(gl.READ_FRAMEBUFFER, attachment, source, sourceLevel, sourceLayer + k);
			if (this.layered(destination.target)) {
				gl.copyTexSubImage3D(
					destination.target,
					level,
					x,
					y,
					layer + k,
					sourceX,
					sourceY,
					width,
					height,
				);
			} else {
				gl.copyTexSubImage2D(
					this.planeTarget(destination, layer + k),
					level,
					x,
					y,
					sourceX,
					sourceY,
					width,
					height,
				);
			}
		}
		// A framebuffer that is not bound keeps what it holds alive, so the source leaves it.
		gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, attachment, gl.TEXTURE_2D, null, 0);
	}

	private createSampler(words: Uint32Array, floats: Float32Array, a: number): void {
		const gl = this.gl;
		const id = words[a] as number;
		this.destroySampler(id);
		const sampler = gl.createSampler();
		if (!sampler) throw new Error('WebGL2 could not create a sampler');
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, this.addressMode(words[a + 1] as number));
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, this.addressMode(words[a + 2] as number));
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, this.addressMode(words[a + 3] as number));
		const magnify = words[a + 4] === G.FILTER_LINEAR ? gl.LINEAR : gl.NEAREST;
		const minify = this.minFilters[words[a + 5] as number]?.[words[a + 6] as number];
		if (minify === undefined) throw new Error('unknown sampler filter');
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, magnify);
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, minify);
		gl.samplerParameterf(sampler, gl.TEXTURE_MIN_LOD, floats[a + 7] as number);
		gl.samplerParameterf(sampler, gl.TEXTURE_MAX_LOD, floats[a + 8] as number);
		const compare = words[a + 9] as number;
		if (compare !== G.COMPARE_NONE) {
			gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
			// WebGL's compare functions run from NEVER to ALWAYS in the draw list's order. Standard
			// depth stores one minus WebGPU's depth, which the shaders' reference values do not
			// match, so every comparison passes there: shadows then light every surface.
			const func = this.depth.standard ? gl.ALWAYS : gl.NEVER + compare - G.COMPARE_NEVER;
			gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_FUNC, func);
		}
		const anisotropy = words[a + 10] as number;
		// Without the extension, a sampler filters as well as the device can, without anisotropy.
		if (anisotropy > 1 && this.anisotropic)
			gl.samplerParameterf(
				sampler,
				this.anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
				Math.min(anisotropy, this.maxAnisotropy),
			);
		this.samplers[id] = sampler;
	}

	private addressMode(code: number): number {
		const mode = this.addressModes[code];
		if (mode === undefined) throw new Error(`unknown sampler address mode ${code}`);
		return mode;
	}

	private destroySampler(id: number): void {
		const old = this.samplers[id];
		if (!old) return;
		// Deleting a sampler unbinds it from every unit.
		this.gl.deleteSampler(old);
		this.samplers[id] = undefined;
		for (let slot = 0; slot < this.slotSamplers.length; slot++)
			if (this.slotSamplers[slot] === old) this.slotSamplers[slot] = null;
		for (let unit = 0; unit < this.unitSamplers.length; unit++)
			if (this.unitSamplers[unit] === old) this.unitSamplers[unit] = null;
		this.unitsChanged = true;
	}

	/** Attaches a render target to the bound framebuffer. */
	private attach(target: GlTexture): void {
		const gl = this.gl;
		const point = target.format.attachment;
		if (target.renderbuffer)
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, point, gl.RENDERBUFFER, target.renderbuffer);
		else this.attachLevel(gl.FRAMEBUFFER, point, target, target.level, target.layer);
	}

	/** Makes a framebuffer with `first` in it, and `depth` when given. It leaves it bound. */
	private makeFramebuffer(first: GlTexture, depth: GlTexture | null): WebGLFramebuffer {
		const gl = this.gl;
		const framebuffer = gl.createFramebuffer();
		if (!framebuffer) throw new Error('WebGL2 could not create a framebuffer');
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		this.attach(first);
		if (depth) this.attach(depth);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE)
			throw new Error(
				`WebGL2 cannot draw into this target's format (status 0x${status.toString(16)})`,
			);
		return framebuffer;
	}

	/**
	 * The framebuffer of passes that draw into `color`, with `depth` when given. A target that the
	 * render graph shares between a pass with depth and one without, as the scene color and a
	 * custom effect's target, keeps a framebuffer for each, so no frame makes one again: each new
	 * framebuffer's completeness check waits for the browser's GPU process, about 1.5 ms on a
	 * Pixel 10. A framebuffer is made again when its depth target changes.
	 */
	private colorFramebuffer(color: GlTexture, depth: GlTexture | null): WebGLFramebuffer {
		if (!depth) return this.soloFramebuffer(color);
		if (color.framebuffer && color.framebufferDepth === depth) return color.framebuffer;
		if (color.framebuffer) this.gl.deleteFramebuffer(color.framebuffer);
		color.framebuffer = this.makeFramebuffer(color, depth);
		color.framebufferDepth = depth;
		return color.framebuffer;
	}

	/** The framebuffer with only `target` in it. */
	private soloFramebuffer(target: GlTexture): WebGLFramebuffer {
		if (!target.soloFramebuffer) target.soloFramebuffer = this.makeFramebuffer(target, null);
		return target.soloFramebuffer;
	}

	private beginPass(words: Uint32Array, floats: Float32Array, a: number): void {
		const gl = this.gl;
		this.skipDraws = false;
		const color = words[a] as number;
		const depth = words[a + 2] as number;
		const flags = words[a + 8] as number;
		this.passResolve = words[a + 1] as number;
		this.passFlags = flags;
		this.passToCanvas = color === 0;
		const depthTarget = depth === G.NO_TARGET ? null : this.need(this.textures, depth, 'texture');
		this.passDepth = depthTarget;
		let framebuffer: WebGLFramebuffer | null;
		if (color === 0) {
			if (depthTarget) throw new Error('WebGL2 cannot draw into the canvas with a depth target');
			framebuffer = this.canvasTarget?.framebuffer ?? null;
			this.passWidth = this.canvasTarget?.width ?? this.canvas.width;
			this.passHeight = this.canvasTarget?.height ?? this.canvas.height;
		} else if (color === G.NO_TARGET) {
			if (!depthTarget) throw new Error('a render pass needs a color target or a depth target');
			framebuffer = this.soloFramebuffer(depthTarget);
			this.passWidth = depthTarget.width;
			this.passHeight = depthTarget.height;
		} else {
			const target = this.need(this.textures, color, 'texture');
			framebuffer = this.colorFramebuffer(target, depthTarget);
			this.passWidth = target.width;
			this.passHeight = target.height;
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		this.passFramebuffer = framebuffer;
		// Each pass starts with its whole target, and with no vertex or index buffer, as on WebGPU.
		this.setViewport(0, 0, this.passWidth, this.passHeight);
		this.setDepthRange(0, 1);
		this.setScissorTest(false);
		this.vertexBuffer = 0;
		this.indexBuffer = 0;
		let clear = 0;
		if (flags & G.PASS_CLEAR_COLOR && color !== G.NO_TARGET) {
			this.setColorMask(true);
			const clearColor = this.clearColor;
			if (
				clearColor[0] !== floats[a + 3] ||
				clearColor[1] !== floats[a + 4] ||
				clearColor[2] !== floats[a + 5] ||
				clearColor[3] !== floats[a + 6]
			) {
				for (let k = 0; k < 4; k++) clearColor[k] = floats[a + 3 + k] as number;
				gl.clearColor(
					clearColor[0] as number,
					clearColor[1] as number,
					clearColor[2] as number,
					clearColor[3] as number,
				);
			}
			clear |= gl.COLOR_BUFFER_BIT;
		}
		if (flags & G.PASS_CLEAR_DEPTH && depthTarget) {
			if (!this.depthMask) {
				gl.depthMask(true);
				this.depthMask = true;
			}
			if (this.clearDepth !== floats[a + 7]) {
				this.clearDepth = floats[a + 7] as number;
				gl.clearDepth(this.depth.standard ? 1 - this.clearDepth : this.clearDepth);
			}
			clear |= gl.DEPTH_BUFFER_BIT;
		}
		if (clear) gl.clear(clear);
	}

	private endPass(): void {
		const gl = this.gl;
		// A resolve covers the whole target, as on WebGPU, but GL's scissor would limit it.
		this.setScissorTest(false);
		if (this.passToCanvas) return;
		const framebuffer = this.passFramebuffer;
		// Tile-based GPUs skip writing a target that the pass discards back to memory. A discard
		// comes while the pass's framebuffer is still the one drawn into, as ANGLE on Metal ends the
		// pass, with its stores, at a resolve's blit, which it draws as a pass of its own. The blit
		// reads the color, so a pass that resolves discards its color after the blit.
		const storeColor = (this.passFlags & G.PASS_STORE_COLOR) !== 0;
		const storeDepth = (this.passFlags & G.PASS_STORE_DEPTH) !== 0;
		const resolves = this.passResolve !== G.NO_TARGET;
		const keepsColor = storeColor || resolves;
		const discard = storeDepth
			? keepsColor
				? undefined
				: DISCARD_COLOR
			: keepsColor
				? DISCARD_DEPTH
				: DISCARD_BOTH;
		if (discard) gl.invalidateFramebuffer(gl.DRAW_FRAMEBUFFER, discard);
		if (resolves) {
			const into =
				this.passResolve === 0
					? (this.canvasTarget?.framebuffer ?? null)
					: this.soloFramebuffer(this.need(this.textures, this.passResolve, 'texture'));
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, into);
			this.setColorMask(true);
			const width = this.passWidth;
			const height = this.passHeight;
			gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
		}
		const depth = this.passDepth;
		if (storeDepth && depth?.renderbuffer && depth.texture) this.copyDepth(framebuffer, depth);
		if (resolves && !storeColor) {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, DISCARD_COLOR);
		}
	}

	/**
	 * Copies one sample of each pixel of a multisampled depth target into the texture that shaders
	 * read in its place. GL copies a multisampled depth through a blit, of the whole target.
	 */
	private copyDepth(framebuffer: WebGLFramebuffer | null, depth: GlTexture): void {
		const gl = this.gl;
		if (!depth.copyFramebuffer) {
			const copy = gl.createFramebuffer();
			if (!copy) throw new Error('WebGL2 could not create a framebuffer');
			gl.bindFramebuffer(gl.FRAMEBUFFER, copy);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.texture, 0);
			depth.copyFramebuffer = copy;
		}
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depth.copyFramebuffer);
		if (!this.depthMask) {
			gl.depthMask(true);
			this.depthMask = true;
		}
		const { width, height } = depth;
		gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
	}

	/** Sets the viewport from a rectangle given from the target's top, as GL counts from its bottom. */
	private setViewport(x: number, y: number, width: number, height: number): void {
		this.setGlViewport(x, this.passHeight - y - height, width, height);
	}

	/** Sets GL's viewport, a rectangle counted from the target's bottom. */
	private setGlViewport(x: number, bottom: number, width: number, height: number): void {
		const viewport = this.viewport;
		if (
			viewport[0] === x &&
			viewport[1] === bottom &&
			viewport[2] === width &&
			viewport[3] === height
		)
			return;
		this.gl.viewport(x, bottom, width, height);
		viewport[0] = x;
		viewport[1] = bottom;
		viewport[2] = width;
		viewport[3] = height;
	}

	private setDepthRange(near: number, far: number): void {
		if (this.depthNear === near && this.depthFar === far) return;
		if (this.depth.standard) this.gl.depthRange(1 - far, 1 - near);
		else this.gl.depthRange(near, far);
		this.depthNear = near;
		this.depthFar = far;
	}

	/** The faces that a pipeline's state flags cull: GL's `BACK` or `FRONT`, or 0 for none. */
	private cullOf(flags: number): number {
		if (flags & G.STATE_CULL_NONE) return 0;
		return flags & G.STATE_CULL_FRONT ? this.gl.FRONT : this.gl.BACK;
	}

	/** Culls `face`, GL's `BACK` or `FRONT`, or nothing for 0. */
	private setCullFace(face: number): void {
		const gl = this.gl;
		const was = this.cullFace;
		if (was === face) return;
		if (face === 0) gl.disable(gl.CULL_FACE);
		else {
			if (was === 0) gl.enable(gl.CULL_FACE);
			if (face !== this.cullMode) {
				gl.cullFace(face);
				this.cullMode = face;
			}
		}
		this.cullFace = face;
	}

	private setDepthTest(on: boolean): void {
		if (this.depthTest === on) return;
		if (on) this.gl.enable(this.gl.DEPTH_TEST);
		else this.gl.disable(this.gl.DEPTH_TEST);
		this.depthTest = on;
	}

	private setScissorTest(on: boolean): void {
		if (this.scissorTest === on) return;
		if (on) this.gl.enable(this.gl.SCISSOR_TEST);
		else this.gl.disable(this.gl.SCISSOR_TEST);
		this.scissorTest = on;
	}

	/** Sets the scissor from a rectangle given from the target's top, as GL counts from its bottom. */
	private setScissor(x: number, y: number, width: number, height: number): void {
		this.setScissorTest(true);
		const bottom = this.passHeight - y - height;
		const scissor = this.scissor;
		if (scissor[0] === x && scissor[1] === bottom && scissor[2] === width && scissor[3] === height)
			return;
		this.gl.scissor(x, bottom, width, height);
		scissor[0] = x;
		scissor[1] = bottom;
		scissor[2] = width;
		scissor[3] = height;
	}

	private setPipeline(p: Pipeline): void {
		const program = p.program;
		this.skipDraws = !this.compiled(program);
		if (this.skipDraws) return;
		this.useProgram(program);
		if (this.current?.program !== program && program.textureUnits.length > 0)
			this.unitsChanged = true;
		this.current = p;
		this.setCullFace(p.cull);
		this.setDepthTest(p.depth);
		if (p.depthWrite !== this.depthMask) {
			this.gl.depthMask(p.depthWrite);
			this.depthMask = p.depthWrite;
		}
		if (p.depthFunc !== this.depthFunc) {
			this.gl.depthFunc(p.depthFunc);
			this.depthFunc = p.depthFunc;
		}
		this.setColorMask(p.colorWrite);
		this.setPolygonOffset(p.offsetFactor, p.offsetUnits);
		if (p.blend !== this.blend) this.setBlend(p.blend);
	}

	/** GL's depth function that passes nearer surfaces in the backend's depth mode. */
	private nearerPasses(): number {
		return this.depth.standard ? this.gl.LESS : this.gl.GREATER;
	}

	/**
	 * GL's depth function of a pipeline's state flags. A pipeline without the depth test still
	 * keeps GL's test on, with a function that passes every fragment: GL writes no depth while its
	 * test is off, and the pipeline writes none either way. After the depth prepass, the opaque
	 * pass draws only at the depth that the prepass found, in every depth mode.
	 */
	private depthFuncOf(flags: number): number {
		const gl = this.gl;
		if (flags & G.STATE_NO_DEPTH_TEST) return gl.ALWAYS;
		return flags & G.STATE_DEPTH_EQUAL ? gl.EQUAL : this.nearerPasses();
	}

	/** Lets draws write color, or keeps the color targets as they are. */
	private setColorMask(on: boolean): void {
		if (on === this.colorMask) return;
		this.gl.colorMask(on, on, on, on);
		this.colorMask = on;
	}

	/**
	 * Sets GL's blending for a blend mode, whose fragments write color premultiplied by alpha, as
	 * the WebGPU backend's blend states do.
	 */
	private setBlend(mode: number): void {
		const gl = this.gl;
		if (!mode) gl.disable(gl.BLEND);
		else {
			if (!this.blend) gl.enable(gl.BLEND);
			if (mode === G.STATE_BLEND_ADDITIVE) gl.blendFunc(gl.ONE, gl.ONE);
			else if (mode === G.STATE_BLEND_MULTIPLY)
				gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
			else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		}
		this.blend = mode;
	}

	/** Sets GL's polygon offset, switched on only while it moves depth. */
	private setPolygonOffset(factor: number, units: number): void {
		if (this.offsetFactor === factor && this.offsetUnits === units) return;
		const gl = this.gl;
		const on = factor !== 0 || units !== 0;
		if (on !== (this.offsetFactor !== 0 || this.offsetUnits !== 0)) {
			if (on) gl.enable(gl.POLYGON_OFFSET_FILL);
			else gl.disable(gl.POLYGON_OFFSET_FILL);
		}
		if (on) gl.polygonOffset(factor, units);
		this.offsetFactor = factor;
		this.offsetUnits = units;
	}

	private setBindGroup(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const group = words[a] as number;
		const entries = this.need(this.bindGroups, words[a + 1] as number, 'bind group');
		const offsets = words[a + 2] as number;
		// The group's dynamic offsets apply to its buffer entries, in order.
		let dynamic = 0;
		for (let k = 0; k < entries.length; k++) {
			const entry = entries[k] as BindEntry;
			const slot = slotOf(group, entry.binding);
			if (entry.kind === G.RESOURCE_BUFFER) {
				const buffer = this.need(this.buffers, entry.resource, 'buffer');
				const offset = entry.offset + (dynamic < offsets ? (words[a + 3 + dynamic] as number) : 0);
				dynamic++;
				const size = entry.size || buffer.size - offset;
				if (
					this.blockBuffers[slot] !== buffer.buffer ||
					this.blockOffsets[slot] !== offset ||
					this.blockSizes[slot] !== size
				) {
					gl.bindBufferRange(gl.UNIFORM_BUFFER, slot, buffer.buffer, offset, size);
					this.blockBuffers[slot] = buffer.buffer;
					this.blockOffsets[slot] = offset;
					this.blockSizes[slot] = size;
				}
			} else if (entry.kind === G.RESOURCE_TEXTURE) {
				const texture = this.textureOf(entry.resource);
				if (this.slotTextures[slot] !== texture.texture) {
					this.slotTextures[slot] = texture.texture;
					this.slotTargets[slot] = texture.target;
					this.unitsChanged = true;
				}
			} else if (entry.kind === G.RESOURCE_SAMPLER) {
				const sampler = this.need(this.samplers, entry.resource, 'sampler');
				if (this.slotSamplers[slot] !== sampler) {
					this.slotSamplers[slot] = sampler;
					this.unitsChanged = true;
				}
			}
		}
	}

	/**
	 * The vertex array of a draw without indices: the current vertex buffer in the layout of the
	 * pipeline's template, or none where the template's vertex shader makes its vertices. Such a
	 * draw ignores a vertex buffer that earlier draws of the pass bound, as WebGPU does: the
	 * background draws after the depth prepass's meshes in one pass.
	 */
	private drawVertexArray(): WebGLVertexArrayObject {
		const layout = this.current?.vertices;
		return layout ? this.layoutVertexArray(layout) : this.emptyVertexArray();
	}

	/** The vertex array of the current vertex buffer in a template's own layout. */
	private layoutVertexArray(layout: GPUVertexBufferLayout): WebGLVertexArrayObject {
		const vertices = this.need(this.buffers, this.vertexBuffer, 'buffer').buffer;
		const cached = this.layoutArrays[this.vertexBuffer];
		if (cached && cached.vertices === vertices && cached.layout === layout) return cached.vao;
		if (cached) this.gl.deleteVertexArray(cached.vao);
		return this.createLayoutVertexArray(vertices, layout);
	}

	/**
	 * Makes the vertex array of the current vertex buffer in a template's layout. It runs only when
	 * the buffer or the layout change.
	 */
	private createLayoutVertexArray(
		vertices: WebGLBuffer,
		layout: GPUVertexBufferLayout,
	): WebGLVertexArrayObject {
		const gl = this.gl;
		const vao = gl.createVertexArray();
		if (!vao) throw new Error('WebGL2 could not create a vertex array');
		this.useVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
		for (const attribute of layout.attributes) {
			const [size, type, normalized] = glAttribute(gl, attribute.format);
			gl.enableVertexAttribArray(attribute.shaderLocation);
			gl.vertexAttribPointer(
				attribute.shaderLocation,
				size,
				type,
				normalized,
				layout.arrayStride,
				attribute.offset,
			);
		}
		this.layoutArrays[this.vertexBuffer] = { vao, vertices, layout };
		return vao;
	}

	/**
	 * A vertex array with no attributes, for draws that read no vertex buffer: their vertex shaders
	 * make vertices.
	 */
	private emptyVertexArray(): WebGLVertexArrayObject {
		if (!this.shaderVertices) {
			this.shaderVertices = this.gl.createVertexArray();
			if (!this.shaderVertices) throw new Error('WebGL2 could not create a vertex array');
		}
		return this.shaderVertices;
	}

	/**
	 * Binds the vertex array of the current vertex and index buffers, which holds every attribute
	 * of the current pipeline's vertex format. A program reads the attributes it declares, and any
	 * other location reads GL's constant default.
	 */
	private useMeshVertexArray(): void {
		const gl = this.gl;
		const p = this.current;
		if (!p) throw new Error('draw list draws before it sets a pipeline');
		const format = p.vertexFormat;
		const vertices = this.need(this.buffers, this.vertexBuffer, 'buffer').buffer;
		const indices = this.need(this.buffers, this.indexBuffer, 'buffer').buffer;
		const cached = this.vertexArrays[this.vertexBuffer];
		if (
			cached &&
			cached.vertices === vertices &&
			cached.indices === indices &&
			cached.format === format
		) {
			this.useVertexArray(cached.vao);
			return;
		}
		if (cached) gl.deleteVertexArray(cached.vao);
		this.createMeshVertexArray(vertices, indices, format);
	}

	/**
	 * Makes and binds the vertex array of the current vertex buffer. It runs only when the buffers
	 * or the format change, and keeps its closure out of the function that every draw calls.
	 */
	private createMeshVertexArray(vertices: WebGLBuffer, indices: WebGLBuffer, format: number): void {
		const gl = this.gl;
		const vao = gl.createVertexArray();
		if (!vao) throw new Error('WebGL2 could not create a vertex array');
		this.useVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
		const stride = vertexStride(format);
		const point = (attribute: VertexAttribute) => pointAttribute(gl, stride, attribute);
		forEachVertexAttribute(format, point);
		forEachFallbackAttribute(format, point);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
		this.vertexArrays[this.vertexBuffer] = { vao, vertices, indices, format };
	}

	/** Readies the current program for a draw: its first instance, and its units' samplers. */
	private prepareDraw(firstInstance: number): void {
		const gl = this.gl;
		const p = this.current?.program;
		if (!p) throw new Error('draw list draws before it sets a pipeline');
		if (p.firstInstance && p.firstInstanceValue !== firstInstance) {
			gl.uniform1ui(p.firstInstance, firstInstance);
			p.firstInstanceValue = firstInstance;
		}
		if (!this.unitsChanged) return;
		// Each unit that the program reads gets the texture of its slot, and the sampler that its
		// triple names, or none for texelFetch, which a comparison sampler left on the unit would
		// break.
		const units = p.textureUnits;
		for (let k = 0; k < units.length; k += 3) {
			const unit = units[k] as number;
			const slot = units[k + 1] as number;
			const sampler = units[k + 2] as number;
			const texture = this.slotTextures[slot] ?? null;
			if (texture) this.bindTexture(unit, this.slotTargets[slot] as number, texture);
			this.bindUnitSampler(unit, sampler < 0 ? null : (this.slotSamplers[sampler] ?? null));
		}
		this.unitsChanged = false;
	}

	/** Binds a sampler to a texture unit, or none. */
	private bindUnitSampler(unit: number, sampler: WebGLSampler | null): void {
		if ((this.unitSamplers[unit] ?? null) === sampler) return;
		this.gl.bindSampler(unit, sampler);
		this.unitSamplers[unit] = sampler;
	}

	/**
	 * Draws a run of buckets in one multi-draw call. Safari reads all of an array that a multi-draw
	 * call gets, not just the entries its draws use, so a view on engine memory would cost time in
	 * proportion to the memory: over 200 ms a call at 16 MB. The draws' three lists therefore go
	 * into a small array of their own, which a loop fills without making a view.
	 */
	private multiDrawIndexed(words: Uint32Array, a: number): void {
		const ext = this.multiDraw;
		if (!ext) throw new Error('this WebGL2 context has no WEBGL_multi_draw');
		const count = words[a] as number;
		const ints = this.ints;
		const counts = (words[a + 1] as number) / 4;
		const offsets = (words[a + 2] as number) / 4;
		const instances = (words[a + 3] as number) / 4;
		this.useMeshVertexArray();
		this.prepareDraw(0);
		const mode = (this.current as Pipeline).mode;
		if (count === 1) {
			// One draw needs no arrays. Its gl_DrawID is 0 either way, so it reads the same record.
			this.gl.drawElementsInstanced(
				mode,
				ints[counts] as number,
				this.indexType,
				ints[offsets] as number,
				ints[instances] as number,
			);
			this.counts.drawCalls += 1;
			return;
		}
		if (this.drawLists.length < 3 * count) this.drawLists = new Int32Array(3 * count);
		const lists = this.drawLists;
		for (let k = 0; k < count; k++) {
			lists[k] = ints[counts + k] as number;
			lists[count + k] = ints[offsets + k] as number;
			lists[2 * count + k] = ints[instances + k] as number;
		}
		ext.multiDrawElementsInstancedWEBGL(
			mode,
			lists,
			0,
			this.indexType,
			lists,
			count,
			lists,
			2 * count,
			count,
		);
		this.counts.drawCalls += count;
	}

	destroy(): void {
		const gl = this.gl;
		for (let id = 0; id < this.buffers.length; id++) this.destroyBuffer(id);
		for (let id = 0; id < this.textures.length; id++) this.destroyTexture(id);
		for (let id = 0; id < this.samplers.length; id++) this.destroySampler(id);
		if (this.ownsImages) this.images.clear();
		for (const p of this.programs.values()) gl.deleteProgram(p.program);
		for (const v of this.vertexArrays) if (v) gl.deleteVertexArray(v.vao);
		for (const v of this.layoutArrays) if (v) gl.deleteVertexArray(v.vao);
		if (this.shaderVertices) gl.deleteVertexArray(this.shaderVertices);
		if (this.copyFramebuffer) gl.deleteFramebuffer(this.copyFramebuffer);
		for (const buffer of this.unpackBuffers) if (buffer) gl.deleteBuffer(buffer);
		if (this.mipFramebuffer) gl.deleteFramebuffer(this.mipFramebuffer);
		if (this.mipSampler) gl.deleteSampler(this.mipSampler);
		for (const spare of this.spares.values()) gl.deleteTexture(spare.texture);
	}
}
