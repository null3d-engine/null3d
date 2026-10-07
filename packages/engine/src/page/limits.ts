// What the engine core and the thread that draws need to know about the device and the canvas: on
// WebGPU, the storage binding size the engine asks the GPU for; on WebGL2, multi-draw, the texture
// size, whether WebGL reads shared memory and how depth is stored; on both, the compressed texture
// formats that KTX2 files can become, the target that scene passes draw into, the anti-aliasing
// mode and whether the canvas is transparent. On WebGPU the core also learns whether the device has
// transient attachments. The permutation bits that the device fixes pick the shader module that
// the thread that draws loads: among them, whether the scene shaders do their color math at half
// precision. They also set how many objects and instance rows a scene can draw,
// and past how many development builds warn that other devices of the same GPU path draw fewer.

import * as C from '../generated/core';
import {
	FORMAT_CANVAS,
	FORMAT_RG11B10_UFLOAT,
	FORMAT_RGBA16_FLOAT,
	PERMUTATION_DRAW_INDEX,
	PERMUTATION_HALF,
	PERMUTATION_TONE_MAP,
} from '../generated/gpu';
import type { QualitySettings } from '../quality/presets';
import type { Tier } from '../render/renderer';
import type {
	CompressionFamily,
	DepthMode,
	ShadowDepthBits,
	SkinningSwitch,
	Switches,
} from './switches';

/** The anti-aliasing mode, as the quality settings name it. */
export type AntialiasMode = QualitySettings['antialias'];

/** The core's code of each skinning mode that ?skinning= picks. */
const SKINNING_CODES: Record<SkinningSwitch, number> = {
	lean: C.SKINNING_LEAN,
	vertex: C.SKINNING_VERTEX,
	full: C.SKINNING_FULL,
	skip: C.SKINNING_SKIP_ONLY,
	narrow: C.SKINNING_NARROW_ONLY,
};

/** Each anti-aliasing mode's code in the core. */
const ANTIALIAS_CODES: Record<AntialiasMode, number> = {
	none: C.ANTIALIAS_NONE,
	fxaa: C.ANTIALIAS_FXAA,
	msaa: C.ANTIALIAS_MSAA,
};

/** The parts of the capability report that decide how the engine uses the device. */
export interface DeviceReport {
	webgpu: {
		limits: Record<string, number | null>;
		features: string[];
		transientAttachments: boolean;
	};
	webgl2: {
		extensions: Record<string, boolean>;
		maxTextureSize: number | null;
		maxRenderbufferSize: number | null;
		maxViewportDims: [width: number, height: number] | null;
		sharedMemoryUploads: {
			bufferSubData: boolean;
			texSubImage2D: boolean;
		} | null;
		floatRenderTargets: {
			rgba16f: FloatTarget;
			rgba32f?: { complete: boolean };
			r11fG11fB10f?: FloatTarget;
		} | null;
	};
}

/** What the engine core and the thread that draws need to know about the device and the canvas. */
export interface CoreDevice {
	/** True on the WebGL2 path, false on WebGPU. */
	webgl2: boolean;
	/** WebGPU: the largest storage binding to request, which sizes the scene the core can draw. */
	storageBindingBytes: number;
	/**
	 * The core's capability flags: the compressed texture families on both paths, multi-draw on
	 * WebGL2 and transient attachments on WebGPU.
	 */
	capabilities: number;
	/** WebGL2: the largest texture width and height in texels. */
	maxTextureSize: number;
	/**
	 * WebGL2: true when uploads and multi-draw calls may read views on shared memory, false when the
	 * thread that draws copies the data out first.
	 */
	sharedUploads: boolean;
	/** How the GPU path stores depth: always `reversed` on WebGPU. */
	depth: DepthMode;
	/**
	 * WebGL2: true to compile programs in the background where the context has
	 * `KHR_parallel_shader_compile`, false to wait for each program's compile at its first draw.
	 */
	parallelCompile: boolean;
	/** True when every shader's text gets a comment of its own, so the browser compiles it again. */
	freshShaders: boolean;
	/**
	 * The format code of the target that scene passes draw into: a float format for HDR color, which
	 * the final pass tone maps, or the canvas's format on the 8-bit path.
	 */
	sceneColor: number;
	/** The anti-aliasing mode's code in the core. */
	antialias: number;
	/**
	 * The scene color's format and the anti-aliasing mode's code once a sketch turns on an effect
	 * that needs HDR color, such as bloom. On the HDR path they are `sceneColor` and `antialias`.
	 * Where the 8-bit path serves only MSAA, they are HDR color with FXAA. Where the device has no
	 * HDR target, the format stays the canvas's, and such effects stay off.
	 */
	effectsSceneColor: number;
	effectsAntialias: number;
	/**
	 * True when the device draws into the float targets of ambient occlusion's steps: always on
	 * WebGPU, and on WebGL2 where the 32-bit and the 16-bit float targets pass the device check.
	 */
	occlusionTargets: boolean;
	/** True when the canvas keeps premultiplied alpha, and stays clear where nothing draws. */
	transparent: boolean;
	/**
	 * The permutation bits that the device fixes, in every pipeline it builds: the draw index where
	 * WebGL2 has multi-draw, tone mapping in the shader on the 8-bit path, and half precision where
	 * the scene shaders do their color math in it. They pick the module of shader builds that the
	 * thread that draws loads.
	 */
	shaderBits: number;
	/** False when the core culls every object and instance row, with no grid cells skipped first. */
	cellCulling: boolean;
	/**
	 * True when each camera view draws its opaque objects' depth before it shades them.
	 */
	depthPrepass: boolean;
	/**
	 * The core's code of WebGPU's skinning mode: the skinning pass, with or without its savings, or
	 * the vertex shader of each pass.
	 */
	skinning: number;
	/** The bits per texel of the shadow cascades' depth: 16, or 32 for floats. */
	shadowDepthBits: ShadowDepthBits;
	/**
	 * True when core WebGPU's vertex shaders read each culled instance by index from storage
	 * buffers, instead of a copy that the culling shader writes. Only a test switch asks for it,
	 * and compatibility mode, which may have no storage buffers in vertex shaders, and WebGL2 never
	 * do it.
	 */
	indexInstances: boolean;
	/**
	 * True when each object's position holds whole cells besides its 32-bit part, so positions keep
	 * their precision at any distance from the origin.
	 */
	largeWorld: boolean;
	/**
	 * True when each camera view culls in two phases against a depth pyramid of what it drew.
	 * Only the WebGPU path culls this way.
	 */
	gpuOcclusion: boolean;
}

/**
 * Each compressed texture family that KTX2 files become: its capability flag, the WebGPU feature
 * that the renderer asks the device for, the WebGL2 extension, which each context asks for by
 * name, and the family's name in the ?compression= switch.
 */
export const TEXTURE_COMPRESSION: readonly (readonly [
	flag: number,
	feature: GPUFeatureName,
	extension: string,
	family: CompressionFamily,
])[] = [
	[C.CAPABILITY_TEXTURE_ASTC, 'texture-compression-astc', 'WEBGL_compressed_texture_astc', 'astc'],
	[C.CAPABILITY_TEXTURE_BC, 'texture-compression-bc', 'EXT_texture_compression_bptc', 'bc'],
	[C.CAPABILITY_TEXTURE_ETC2, 'texture-compression-etc2', 'WEBGL_compressed_texture_etc', 'etc2'],
];

/**
 * The capability flags of the compressed texture families that `has` finds, by feature or
 * extension, among those that `allowed` names when it names any.
 */
function compression(
	has: (feature: GPUFeatureName, extension: string) => boolean,
	allowed: readonly CompressionFamily[] | undefined,
): number {
	let flags = 0;
	for (const [flag, feature, extension, family] of TEXTURE_COMPRESSION)
		if (has(feature, extension) && (!allowed || allowed.includes(family))) flags |= flag;
	return flags;
}

/**
 * How the page asks the engine to use the device: the test switches that force a route, limit the
 * compressed texture families or turn cell culling off for benchmarks, the anti-aliasing mode and
 * the canvas's transparency.
 */
export type DeviceOptions = Pick<
	Switches,
	| 'copyUploads'
	| 'depth'
	| 'hdr'
	| 'sceneFormat'
	| 'half'
	| 'parallelCompile'
	| 'freshShaders'
	| 'compression'
	| 'cells'
	| 'skinning'
	| 'indexInstances'
	| 'shadowDepthBits'
> & {
	/** The anti-aliasing mode. */
	antialias: AntialiasMode;
	/** True for a transparent canvas. */
	transparent: boolean;
	/** True to draw the opaque objects' depth in a depth prepass. */
	depthPrepass: boolean;
	/** True for positions that keep their precision at any distance from the origin. */
	largeWorld: boolean;
	/** True to cull each camera view in two phases against a depth pyramid. */
	gpuOcclusion: boolean;
};

/** The depth mode of a WebGL2 device without `EXT_clip_control`. */
export const DEPTH_WITHOUT_CLIP_CONTROL: DepthMode = 'reversed-gl';

/**
 * The depth mode a WebGL2 device draws with: `reversed` where it has `EXT_clip_control`, and
 * `DEPTH_WITHOUT_CLIP_CONTROL` elsewhere. `wanted`, from the ?depth= switch, overrides that
 * where the device can draw it.
 */
export function webgl2Depth(clipControl: boolean, wanted: DepthMode | undefined): DepthMode {
	if (wanted && (wanted !== 'reversed' || clipControl)) return wanted;
	return clipControl ? 'reversed' : DEPTH_WITHOUT_CLIP_CONTROL;
}

/**
 * The largest storage binding to request, from the adapter's limits: what the adapter offers for
 * a binding and for a whole buffer, within the range the renderer can use. Every device offers
 * WebGPU's default, so a device that reports less, or nothing, gets the default.
 */
export function storageBindingBytes(limits: Record<string, number | null>): number {
	const offered = Math.min(limits.maxStorageBufferBindingSize ?? 0, limits.maxBufferSize ?? 0);
	const usable = Math.min(offered, C.LIMIT_MAX_USEFUL_BINDING_BYTES);
	return Math.max(C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES, usable - (usable % 256));
}

/** What the WebGL2 probe found of a float format as a render target. */
interface FloatTarget {
	complete: boolean;
	readsBack: boolean;
	samples: number;
}

/**
 * True when WebGL2 draws scene color into a float format: its targets are complete and keep values
 * above 1, and with MSAA they take the engine's samples.
 */
function webgl2Draws(test: FloatTarget | undefined, antialias: AntialiasMode): boolean {
	return (
		test?.complete === true &&
		test.readsBack &&
		(antialias !== 'msaa' || test.samples >= C.LIMIT_MSAA_SAMPLES)
	);
}

/** True when WebGL2 draws HDR color: RGBA16F targets pass the probe in the anti-aliasing mode. */
export function webgl2DrawsHdr(report: DeviceReport['webgl2'], antialias: AntialiasMode): boolean {
	return webgl2Draws(report.floatRenderTargets?.rgba16f, antialias);
}

/**
 * Whether WebGL2 takes the packed small float format for HDR scene color where the device draws
 * it, without the ?scene-format= switch. It is off: on phones the small format drew no faster than
 * RGBA16F, and a little slower on one Mali GPU, as decision record D-77 says.
 */
export const WEBGL2_SMALL_SCENE_COLOR = false;

/**
 * True when WebGL2 draws into the float targets of ambient occlusion's steps: one 32-bit float, and
 * four 16-bit floats. The 32-bit test covers the extension that both need.
 */
export function webgl2DrawsOcclusion(report: DeviceReport['webgl2']): boolean {
	const targets = report.floatRenderTargets;
	return targets?.rgba32f?.complete === true && targets.rgba16f.complete;
}

/**
 * The format of the target that scene passes draw into. Both GPU paths draw HDR color, in the
 * packed small float format, which takes half the bytes, where the device draws into it and the
 * canvas needs no alpha, and in 16-bit floats elsewhere. WebGPU takes the small format by default,
 * and WebGL2 as `WEBGL2_SMALL_SCENE_COLOR` says; `sceneFormat`, from the ?scene-format= switch,
 * picks one where the device can draw it. Compatibility mode cannot multisample float targets, so
 * with MSAA it takes the 8-bit path. WebGL2 takes it too, unless the device draws RGBA16F in the
 * anti-aliasing mode. `hdr` false forces the 8-bit path.
 */
export function sceneColorFormat(
	tier: Tier,
	report: DeviceReport,
	{
		hdr,
		transparent,
		antialias,
		sceneFormat,
	}: Pick<DeviceOptions, 'hdr' | 'transparent' | 'antialias' | 'sceneFormat'>,
): number {
	if (!hdr) return FORMAT_CANVAS;
	if (tier === 'webgl2' && !webgl2DrawsHdr(report.webgl2, antialias)) return FORMAT_CANVAS;
	if (tier === 'webgpu-compat' && antialias === 'msaa') return FORMAT_CANVAS;
	const small =
		tier === 'webgl2'
			? webgl2Draws(report.webgl2.floatRenderTargets?.r11fG11fB10f, antialias)
			: report.webgpu.features.includes('rg11b10ufloat-renderable');
	const wanted =
		sceneFormat ?? (tier !== 'webgl2' || WEBGL2_SMALL_SCENE_COLOR ? 'rg11b10' : 'rgba16f');
	return !transparent && small && wanted === 'rg11b10'
		? FORMAT_RG11B10_UFLOAT
		: FORMAT_RGBA16_FLOAT;
}

/**
 * The scene color's format and the anti-aliasing mode once an effect that needs HDR color turns
 * on: the start's on the HDR path, and HDR color with FXAA where only MSAA keeps the device on the
 * 8-bit path. Where no anti-aliasing mode gives HDR color, the format stays the canvas's.
 */
export function effectsOutput(
	tier: Tier,
	report: DeviceReport,
	options: Pick<DeviceOptions, 'hdr' | 'transparent' | 'antialias' | 'sceneFormat'>,
): { sceneColor: number; antialias: AntialiasMode } {
	const start = sceneColorFormat(tier, report, options);
	if (start !== FORMAT_CANVAS || options.antialias !== 'msaa')
		return { sceneColor: start, antialias: options.antialias };
	const sceneColor = sceneColorFormat(tier, report, { ...options, antialias: 'fxaa' });
	return { sceneColor, antialias: sceneColor === FORMAT_CANVAS ? 'msaa' : 'fxaa' };
}

/**
 * The half precision bit of the device's shaders: set where the scene shaders do their color math
 * at half precision. `wanted` comes from the ?half= switch, and without it each GPU path keeps full
 * precision. WebGPU needs the device feature `shader-f16` for it, and WebGL2 runs that math at
 * `mediump`, which every WebGL2 device has.
 */
export function halfPrecision(
	tier: Tier,
	report: DeviceReport,
	wanted: boolean | undefined,
): number {
	if (wanted !== true) return 0;
	return tier === 'webgl2' || report.webgpu.features.includes('shader-f16') ? PERMUTATION_HALF : 0;
}

/**
 * The device and the canvas as the engine uses them on a tier, from the capability report and the
 * options. The test switches make the WebGL2 path copy uploads out of shared memory even where
 * WebGL reads it, force a WebGL2 depth mode, make WebGL2 wait for each program's compile, or force
 * the 8-bit path, so tests reach every route. `freshShaders` makes the browser compile every
 * shader again, as on a first visit. `compression` limits the compressed texture families,
 * as on a device with fewer. `cells` off makes the core cull without grid cells, for benchmarks.
 */
export function coreDevice(tier: Tier, report: DeviceReport, options: DeviceOptions): CoreDevice {
	const sceneColor = sceneColorFormat(tier, report, options);
	const effects = effectsOutput(tier, report, options);
	const toneMap = sceneColor === FORMAT_CANVAS ? PERMUTATION_TONE_MAP : 0;
	const half = halfPrecision(tier, report, options.half);
	const common = {
		parallelCompile: options.parallelCompile,
		freshShaders: options.freshShaders,
		sceneColor,
		antialias: ANTIALIAS_CODES[options.antialias],
		effectsSceneColor: effects.sceneColor,
		effectsAntialias: ANTIALIAS_CODES[effects.antialias],
		occlusionTargets: tier !== 'webgl2' || webgl2DrawsOcclusion(report.webgl2),
		transparent: options.transparent,
		cellCulling: options.cells,
		depthPrepass: options.depthPrepass,
		skinning: SKINNING_CODES[options.skinning],
		shadowDepthBits: options.shadowDepthBits,
		largeWorld: options.largeWorld,
		gpuOcclusion: options.gpuOcclusion,
	};
	if (tier !== 'webgl2') {
		return {
			webgl2: false,
			storageBindingBytes: storageBindingBytes(report.webgpu.limits),
			capabilities:
				compression((feature) => report.webgpu.features.includes(feature), options.compression) |
				(report.webgpu.transientAttachments ? C.CAPABILITY_TRANSIENT_ATTACHMENTS : 0),
			maxTextureSize: 0,
			sharedUploads: true,
			depth: 'reversed',
			shaderBits: toneMap | half,
			indexInstances: tier === 'webgpu' && options.indexInstances,
			...common,
		};
	}
	const gl = report.webgl2;
	const multiDraw = gl.extensions.WEBGL_multi_draw === true;
	const uploads = gl.sharedMemoryUploads;
	return {
		webgl2: true,
		storageBindingBytes: C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES,
		capabilities:
			(multiDraw ? C.CAPABILITY_MULTI_DRAW : 0) |
			compression((_, extension) => gl.extensions[extension] === true, options.compression),
		maxTextureSize: Math.max(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE, gl.maxTextureSize ?? 0),
		sharedUploads:
			!options.copyUploads && uploads !== null && uploads.bufferSubData && uploads.texSubImage2D,
		depth: webgl2Depth(gl.extensions.EXT_clip_control === true, options.depth),
		shaderBits: (multiDraw ? PERMUTATION_DRAW_INDEX : 0) | toneMap | half,
		indexInstances: false,
		...common,
	};
}

/**
 * The default limit on a WebGPU texture's width and height in each feature level. The engine asks
 * for no higher limit, so every WebGPU device it requests has exactly this one.
 */
const WEBGPU_MAX_TEXTURE_SIZE = { webgpu: 8192, 'webgpu-compat': 4096 } as const;

/**
 * The widest and tallest drawing buffer that the GPU path draws into. The canvas and the render
 * targets of the canvas's size must fit WebGPU's texture limit, and on WebGL2 its texture,
 * renderbuffer and viewport limits too. A limit the report lacks counts as the least that WebGL2
 * allows.
 */
export function maxCanvasSize(tier: Tier, report: DeviceReport): number {
	if (tier !== 'webgl2') return WEBGPU_MAX_TEXTURE_SIZE[tier];
	const least = C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE;
	const gl = report.webgl2;
	const [viewportWidth, viewportHeight] = gl.maxViewportDims ?? [least, least];
	return Math.max(
		least,
		Math.min(
			gl.maxTextureSize ?? least,
			gl.maxRenderbufferSize ?? least,
			viewportWidth,
			viewportHeight,
		),
	);
}

/**
 * The most objects and instance rows, counted together, that a scene draws on the device. On
 * WebGL2 a data texture row holds a fixed number of matrices, and an index list entry names at
 * most `LIMIT_WEBGL2_MAX_SOURCES` of them, below its grid cell.
 */
export function maxInstances(
	device: Pick<CoreDevice, 'webgl2' | 'storageBindingBytes' | 'maxTextureSize'>,
): number {
	return device.webgl2
		? Math.min(C.LIMIT_MATRICES_PER_TEXTURE_ROW * device.maxTextureSize, C.LIMIT_WEBGL2_MAX_SOURCES)
		: Math.floor(device.storageBindingBytes / C.LIMIT_INSTANCE_STRIDE);
}

/**
 * The most objects and instance rows that every device on a GPU path draws: `maxInstances` of the
 * smallest device the path allows. That is a WebGPU device with the default storage binding, or a
 * WebGL2 device whose textures reach only the size that WebGL2 promises.
 */
export function portableMaxInstances(webgl2: boolean): number {
	return maxInstances({
		webgl2,
		storageBindingBytes: C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES,
		maxTextureSize: C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE,
	});
}

/**
 * The development warning for a scene that counts `sources` objects and instance rows toward the
 * GPU's limit on a device of the GPU path, or undefined while every device of that path draws them.
 * The device that runs the page draws them all, since the core refuses a batch past its limit.
 */
export function rowLimitWarning(sources: number, webgl2: boolean): string | undefined {
	const portable = portableMaxInstances(webgl2);
	if (sources <= portable) return undefined;
	const count = (n: number) => n.toLocaleString('en-US');
	const smallest = webgl2
		? `WebGL2 devices whose textures reach only ${count(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE)} pixels`
		: "devices with WebGPU's default limits";
	return `null3D: this scene counts ${count(sources)} objects and instance rows toward the GPU's limit. This device draws them, but ${smallest} draw at most ${count(portable)} and fail with E1501. engine.capabilities.maxInstances gives the limit of each device.`;
}

/**
 * The warning that the sketch thread gives once, the first time an object or an instance row
 * enters a new grid cell while every cell is in use.
 */
export function cellTableWarning(): string {
	return `null3D: all ${C.CELL_MAX} grid cells are in use, so an object or instance row that entered a new cell went into the origin's cell instead. There it has only the precision of a 32-bit position, and far from the origin it jitters as the camera moves. Keep far content in fewer cells: put far objects under a few parent objects, which share their root's cell, or create and destroy them as the camera moves.`;
}
