// What the engine core and the thread that draws need to know about the device: on WebGPU, the
// storage binding size the engine asks the GPU for; on WebGL2, multi-draw, the texture size and
// whether WebGL reads shared memory. They also set how many objects and instance rows a scene can
// draw.

import * as C from '../generated/core';

/** The parts of the capability report that decide how the engine uses the device. */
export interface DeviceReport {
	webgpu: { limits: Record<string, number | null> };
	webgl2: {
		extensions: Record<string, boolean>;
		maxTextureSize: number | null;
		sharedMemoryUploads: {
			bufferSubData: boolean;
			texSubImage2D: boolean;
			multiDraw: boolean | null;
		} | null;
	};
}

/** What the engine core and the thread that draws need to know about the device. */
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
 * The device as the engine uses it on WebGL2 or WebGPU, from the capability report. `copyUploads`
 * makes the WebGL2 path copy uploads out of shared memory even where WebGL reads it, so tests
 * reach both routes.
 */
export function coreDevice(
	webgl2: boolean,
	report: DeviceReport,
	copyUploads: boolean,
): CoreDevice {
	if (!webgl2) {
		return {
			webgl2,
			storageBindingBytes: storageBindingBytes(report.webgpu.limits),
			capabilities: 0,
			maxTextureSize: 0,
			sharedUploads: true,
		};
	}
	const gl = report.webgl2;
	const multiDraw = gl.extensions.WEBGL_multi_draw === true;
	const shared = gl.sharedMemoryUploads;
	return {
		webgl2,
		storageBindingBytes: C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES,
		capabilities: multiDraw ? C.CAPABILITY_MULTI_DRAW : 0,
		maxTextureSize: Math.max(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE, gl.maxTextureSize ?? 0),
		sharedUploads:
			!copyUploads &&
			shared !== null &&
			shared.bufferSubData &&
			shared.texSubImage2D &&
			(!multiDraw || shared.multiDraw === true),
	};
}

/** The most objects and instance rows, counted together, that a scene draws on the device. */
export function maxInstances(device: CoreDevice): number {
	return device.webgl2
		? C.LIMIT_MATRICES_PER_TEXTURE_ROW * device.maxTextureSize
		: Math.floor(device.storageBindingBytes / C.LIMIT_INSTANCE_STRIDE);
}
