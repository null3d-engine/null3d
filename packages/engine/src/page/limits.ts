// What the engine core and the thread that draws need to know about the device and the canvas: on
// WebGPU, the storage binding size the engine asks the GPU for; on WebGL2, multi-draw, the texture
// size and whether WebGL reads shared memory; on both, the target that scene passes draw into and
// whether the canvas is transparent. They also set how many objects and instance rows a scene can
// draw.

import * as C from '../generated/core';
import { FORMAT_CANVAS, FORMAT_RG11B10_UFLOAT, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { Tier } from '../render/renderer';

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
	/** WebGL2: the core's capability flags, such as multi-draw. */
	capabilities: number;
	/** WebGL2: the largest texture width and height in texels. */
	maxTextureSize: number;
	/**
	 * WebGL2: true when uploads and multi-draw calls may read views on shared memory, false when the
	 * thread that draws copies the data out first.
	 */
	sharedUploads: boolean;
	/**
	 * The format code of the target that scene passes draw into: a float format for HDR color, which
	 * the final pass tone maps, or the canvas's format on the 8-bit path.
	 */
	sceneColor: number;
	/** True when the canvas keeps premultiplied alpha, and stays clear where nothing draws. */
	transparent: boolean;
}

/** How the page asks the engine to use the device. */
export interface DeviceOptions {
	/** Copies WebGL2 uploads out of shared memory even where WebGL reads it, so tests reach both routes. */
	copyUploads: boolean;
	/** False forces the 8-bit path, so tests reach it on devices that draw HDR color. */
	hdr: boolean;
	/** True for a transparent canvas. */
	transparent: boolean;
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
 * True when WebGL2 draws HDR color: RGBA16F targets are complete, keep values above 1, and take
 * the engine's MSAA.
 */
export function webgl2DrawsHdr(report: DeviceReport['webgl2']): boolean {
	const test = report.floatRenderTargets?.rgba16f;
	return test?.complete === true && test.readsBack && test.samples >= C.LIMIT_MSAA_SAMPLES;
}

/**
 * The format of the target that scene passes draw into. Core WebGPU draws HDR color, in
 * rg11b10ufloat, which takes half the bytes, where the device draws into it and the canvas needs
 * no alpha, and in rgba16float elsewhere. Compatibility mode cannot use MSAA on float targets, so it
 * takes the 8-bit path. WebGL2 takes it too, unless the device draws HDR color. `hdr` false
 * forces the 8-bit path.
 */
export function sceneColorFormat(
	tier: Tier,
	report: DeviceReport,
	hdr: boolean,
	transparent: boolean,
): number {
	if (!hdr) return FORMAT_CANVAS;
	if (tier === 'webgpu')
		return !transparent && report.webgpu.features.includes('rg11b10ufloat-renderable')
			? FORMAT_RG11B10_UFLOAT
			: FORMAT_RGBA16_FLOAT;
	if (tier === 'webgl2' && webgl2DrawsHdr(report.webgl2)) return FORMAT_RGBA16_FLOAT;
	return FORMAT_CANVAS;
}

/** The device and the canvas as the engine uses them on a tier, from the capability report. */
export function coreDevice(tier: Tier, report: DeviceReport, options: DeviceOptions): CoreDevice {
	const canvas = {
		sceneColor: sceneColorFormat(tier, report, options.hdr, options.transparent),
		transparent: options.transparent,
	};
	if (tier !== 'webgl2') {
		return {
			webgl2: false,
			storageBindingBytes: storageBindingBytes(report.webgpu.limits),
			capabilities: 0,
			maxTextureSize: 0,
			sharedUploads: true,
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
		...canvas,
	};
}

/** The most objects and instance rows, counted together, that a scene draws on the device. */
export function maxInstances(device: CoreDevice): number {
	return device.webgl2
		? C.LIMIT_MATRICES_PER_TEXTURE_ROW * device.maxTextureSize
		: Math.floor(device.storageBindingBytes / C.LIMIT_INSTANCE_STRIDE);
}
