// What the engine core and the thread that draws need to know about the device and the canvas: on
// WebGPU, the storage binding size the engine asks the GPU for; on WebGL2, multi-draw, the texture
// size, whether WebGL reads shared memory and how depth is stored; on both, the target that scene
// passes draw into, the anti-aliasing mode and whether the canvas is transparent. On WebGPU the
// core also learns whether the device has transient attachments. They also set how many objects and
// instance rows a scene can draw, and past how many development builds warn that other devices of
// the same GPU path draw fewer.

import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { FORMAT_CANVAS, FORMAT_RG11B10_UFLOAT, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { Tier } from '../render/renderer';
import type { DepthMode, Switches } from './switches';

/**
 * How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa`
 * smooths edges in the final pass, and `none` leaves them.
 */
export type AntialiasMode = 'none' | 'fxaa' | 'msaa';

/** Each anti-aliasing mode's code in the core. */
const ANTIALIAS_CODES: Record<AntialiasMode, number> = {
	none: C.ANTIALIAS_NONE,
	fxaa: C.ANTIALIAS_FXAA,
	msaa: C.ANTIALIAS_MSAA,
};

/**
 * The anti-aliasing mode that `createEngine`'s option names, and MSAA where it names none. Throws
 * E1213 for any other value.
 */
export function antialiasOption(value: unknown): AntialiasMode {
	if (value === undefined) return 'msaa';
	if (typeof value === 'string' && Object.hasOwn(ANTIALIAS_CODES, value))
		return value as AntialiasMode;
	const shown = typeof value === 'string' ? `"${value}"` : String(value);
	throw new EngineError(
		'E1213',
		`createEngine() got the anti-aliasing mode ${shown}, which is not 'msaa', 'fxaa' or 'none'.`,
	);
}

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
		sharedMemoryUploads: {
			bufferSubData: boolean;
			texSubImage2D: boolean;
		} | null;
		floatRenderTargets: {
			rgba16f: { complete: boolean; readsBack: boolean; samples: number };
		} | null;
	};
}

/** What the engine core and the thread that draws need to know about the device and the canvas. */
export interface CoreDevice {
	/** True on the WebGL2 path, false on WebGPU. */
	webgl2: boolean;
	/** WebGPU: the largest storage binding to request, which sizes the scene the core can draw. */
	storageBindingBytes: number;
	/** The core's capability flags: multi-draw on WebGL2, transient attachments on WebGPU. */
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
	 * The format code of the target that scene passes draw into: a float format for HDR color, which
	 * the final pass tone maps, or the canvas's format on the 8-bit path.
	 */
	sceneColor: number;
	/** The anti-aliasing mode's code in the core. */
	antialias: number;
	/** True when the canvas keeps premultiplied alpha, and stays clear where nothing draws. */
	transparent: boolean;
}

/**
 * How the page asks the engine to use the device: the test switches that force a route, the
 * anti-aliasing mode and the canvas's transparency.
 */
export type DeviceOptions = Pick<Switches, 'copyUploads' | 'depth' | 'hdr'> & {
	/** The anti-aliasing mode. */
	antialias: AntialiasMode;
	/** True for a transparent canvas. */
	transparent: boolean;
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

/**
 * True when WebGL2 draws HDR color: RGBA16F targets are complete and keep values above 1. With
 * MSAA they must also take the engine's samples.
 */
export function webgl2DrawsHdr(report: DeviceReport['webgl2'], antialias: AntialiasMode): boolean {
	const test = report.floatRenderTargets?.rgba16f;
	return (
		test?.complete === true &&
		test.readsBack &&
		(antialias !== 'msaa' || test.samples >= C.LIMIT_MSAA_SAMPLES)
	);
}

/**
 * The format of the target that scene passes draw into. WebGPU draws HDR color, in rg11b10ufloat,
 * which takes half the bytes, where the device draws into it and the canvas needs no alpha, and in
 * rgba16float elsewhere. Compatibility mode cannot multisample float targets, so with MSAA it takes
 * the 8-bit path. WebGL2 takes it too, unless the device draws HDR color in the anti-aliasing
 * mode. `hdr` false forces the 8-bit path.
 */
export function sceneColorFormat(
	tier: Tier,
	report: DeviceReport,
	{ hdr, transparent, antialias }: Pick<DeviceOptions, 'hdr' | 'transparent' | 'antialias'>,
): number {
	if (!hdr) return FORMAT_CANVAS;
	if (tier === 'webgl2')
		return webgl2DrawsHdr(report.webgl2, antialias) ? FORMAT_RGBA16_FLOAT : FORMAT_CANVAS;
	if (tier === 'webgpu-compat' && antialias === 'msaa') return FORMAT_CANVAS;
	return !transparent && report.webgpu.features.includes('rg11b10ufloat-renderable')
		? FORMAT_RG11B10_UFLOAT
		: FORMAT_RGBA16_FLOAT;
}

/**
 * The device and the canvas as the engine uses them on a tier, from the capability report and the
 * options. The test switches make the WebGL2 path copy uploads out of shared memory even where
 * WebGL reads it, force a WebGL2 depth mode, or force the 8-bit path, so tests reach every route.
 */
export function coreDevice(tier: Tier, report: DeviceReport, options: DeviceOptions): CoreDevice {
	const canvas = {
		sceneColor: sceneColorFormat(tier, report, options),
		antialias: ANTIALIAS_CODES[options.antialias],
		transparent: options.transparent,
	};
	if (tier !== 'webgl2') {
		return {
			webgl2: false,
			storageBindingBytes: storageBindingBytes(report.webgpu.limits),
			capabilities: report.webgpu.transientAttachments ? C.CAPABILITY_TRANSIENT_ATTACHMENTS : 0,
			maxTextureSize: 0,
			sharedUploads: true,
			depth: 'reversed',
			...canvas,
		};
	}
	const gl = report.webgl2;
	const multiDraw = gl.extensions.WEBGL_multi_draw === true;
	const shared = gl.sharedMemoryUploads;
	return {
		webgl2: true,
		storageBindingBytes: C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES,
		capabilities: multiDraw ? C.CAPABILITY_MULTI_DRAW : 0,
		maxTextureSize: Math.max(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE, gl.maxTextureSize ?? 0),
		sharedUploads:
			!options.copyUploads && shared !== null && shared.bufferSubData && shared.texSubImage2D,
		depth: webgl2Depth(gl.extensions.EXT_clip_control === true, options.depth),
		...canvas,
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
