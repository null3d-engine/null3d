// The device hints that the quality chooser reads. They are read on the page's main thread, which
// workers cannot: they have no media queries and no screen. This module holds only that read, so a
// page that asks what kind of device it runs on does not pull the capability probe in with it.

import type { DeviceHints } from './chooser';

/**
 * Reads the device hints on the page's main thread, which workers cannot: they have no media
 * queries and no screen.
 *
 * @category api/engine
 */
export function readDeviceHints(): DeviceHints {
	const screen = globalThis.screen;
	const memory = (globalThis.navigator as { deviceMemory?: unknown } | undefined)?.deviceMemory;
	return {
		coarsePointer: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
		screenMinEdge: screen ? Math.min(screen.width, screen.height) : 0,
		deviceMemoryGB: typeof memory === 'number' ? memory : null,
	};
}
