// What the engine core and the thread that draws need to know about the device: on WebGPU, the
// storage binding size the engine asks the GPU for; on WebGL2, multi-draw, the texture size,
// whether WebGL reads shared memory and how depth is stored; on both, the compressed texture
// formats that KTX2 files can become. The permutation bits that the device fixes pick the shader
// module that the thread that draws loads. They also set how many objects and
// instance rows a scene can draw, and past how many development builds warn that other devices of
// the same GPU path draw fewer.

import * as C from '../generated/core';
import { PERMUTATION_DRAW_INDEX } from '../generated/gpu';
import type { CompressionFamily, DepthMode, Switches } from './switches';

/** The parts of the capability report that decide how the engine uses the device. */
export interface DeviceReport {
	webgpu: { limits: Record<string, number | null>; features: string[] };
	webgl2: {
		extensions: Record<string, boolean>;
		maxTextureSize: number | null;
		sharedMemoryUploads: {
			bufferSubData: boolean;
			texSubImage2D: boolean;
		} | null;
	};
}

/** What the engine core and the thread that draws need to know about the device. */
export interface CoreDevice {
	/** True on the WebGL2 path, false on WebGPU. */
	webgl2: boolean;
	/** WebGPU: the largest storage binding to request, which sizes the scene the core can draw. */
	storageBindingBytes: number;
	/**
	 * The core's capability flags: the compressed texture families on both paths, and multi-draw
	 * on WebGL2.
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
	/**
	 * The permutation bits that the device fixes, in every pipeline it builds: the draw index where
	 * WebGL2 has multi-draw. They pick the module of shader builds that the thread that draws loads.
	 */
	shaderBits: number;
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

/**
 * The device as the engine uses it on WebGL2 or WebGPU, from the capability report and the test
 * switches. `copyUploads` makes the WebGL2 path copy uploads out of shared memory even where
 * WebGL reads it, `depth` forces a WebGL2 depth mode, `parallelCompile` off makes WebGL2 wait for
 * each program's compile, and `compression` limits the compressed texture families, so tests reach
 * every route.
 */
export function coreDevice(
	webgl2: boolean,
	report: DeviceReport,
	{
		copyUploads,
		depth,
		parallelCompile,
		compression: allowed,
	}: Pick<Switches, 'copyUploads' | 'depth' | 'parallelCompile' | 'compression'>,
): CoreDevice {
	if (!webgl2) {
		const features = new Set(report.webgpu.features);
		return {
			webgl2,
			storageBindingBytes: storageBindingBytes(report.webgpu.limits),
			capabilities: compression((feature) => features.has(feature), allowed),
			maxTextureSize: 0,
			sharedUploads: true,
			depth: 'reversed',
			parallelCompile,
			shaderBits: 0,
		};
	}
	const gl = report.webgl2;
	const multiDraw = gl.extensions.WEBGL_multi_draw === true;
	const shared = gl.sharedMemoryUploads;
	return {
		webgl2,
		storageBindingBytes: C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES,
		capabilities:
			(multiDraw ? C.CAPABILITY_MULTI_DRAW : 0) |
			compression((_, extension) => gl.extensions[extension] === true, allowed),
		maxTextureSize: Math.max(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE, gl.maxTextureSize ?? 0),
		sharedUploads: !copyUploads && shared !== null && shared.bufferSubData && shared.texSubImage2D,
		depth: webgl2Depth(gl.extensions.EXT_clip_control === true, depth),
		parallelCompile,
		shaderBits: multiDraw ? PERMUTATION_DRAW_INDEX : 0,
	};
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
