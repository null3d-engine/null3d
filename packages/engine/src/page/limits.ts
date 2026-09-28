// The storage binding size the engine asks the GPU for. It sets how many objects and instance rows
// a scene can draw, so the engine asks for as much as the device offers and the renderer can use.

import * as C from '../generated/core';

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

/** The most objects and instance rows, counted together, that a scene draws with this binding. */
export function maxInstances(bindingBytes: number): number {
	return Math.floor(bindingBytes / C.LIMIT_INSTANCE_STRIDE);
}
