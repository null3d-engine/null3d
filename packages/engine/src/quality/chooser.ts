// Chooses the quality preset when the engine starts, from facts that describe the device and never
// from browser or GPU names. The GPU path sets the highest preset. The main pointer and the
// screen's smaller edge tell a phone from a tablet from a desktop, and each kind of device starts
// at its own preset. A memory reading under 4 GB lowers that preset, and nothing raises it. Starts
// that crashed the tab lower it further (page/start-marker.ts). These functions are pure, so tests
// call them with any device.

import type { Tier } from '../shared/tier';
import { presetIndex, QUALITY_PRESETS, type QualityPreset } from './presets';

/**
 * The facts about the device that the engine chooses a quality preset from. The page reads them
 * when the engine starts, and `engine.report` holds them.
 *
 * @category api/quality
 */
export interface DeviceHints {
	/** True when the main pointer is coarse, as on a touch screen: `(pointer: coarse)`. */
	coarsePointer: boolean;
	/**
	 * The screen's smaller edge in CSS pixels, which stays the same when the device turns or the
	 * window changes size.
	 */
	screenMinEdge: number;
	/**
	 * The device's memory in GB, as `navigator.deviceMemory` rounds it, or null in browsers that do
	 * not report it, such as Safari and Firefox.
	 */
	deviceMemoryGB: number | null;
}

/** A kind of device, as the main pointer and the screen's smaller edge tell them apart. */
export type DeviceKind = 'phone' | 'tablet' | 'desktop';

/**
 * The smallest screen edge of a tablet, in CSS pixels. A device whose main pointer is coarse and
 * whose smaller screen edge is shorter is a phone.
 */
export const TABLET_MIN_EDGE = 600;

/** A memory reading under this many GB lowers the preset by one. */
export const LOW_MEMORY_GB = 4;

/** The preset that each kind of device starts at. The engine picks Ultra only when asked. */
export const DEVICE_PRESETS: Readonly<Record<DeviceKind, QualityPreset>> = {
	phone: 'low',
	tablet: 'medium',
	desktop: 'high',
};

/**
 * The highest preset of each GPU path. WebGL2 and WebGPU's compatibility mode lack features that
 * the heavier presets use, such as multisampled float targets in compatibility mode.
 */
export const TIER_CEILINGS: Readonly<Record<Tier, QualityPreset>> = {
	webgpu: 'ultra',
	'webgpu-compat': 'medium',
	webgl2: 'medium',
};

/** What the chooser works from, besides the GPU path. */
export interface PresetRequest {
	/** The preset that the page's option or the `?preset=` switch names, or `auto`. */
	wanted: QualityPreset | 'auto';
	hints: DeviceHints;
	/** The starts before this one that crashed the tab, one after another. */
	crashedStarts: number;
}

/** The kind of device that the hints describe. */
export function deviceKind(hints: DeviceHints): DeviceKind {
	if (!hints.coarsePointer) return 'desktop';
	return hints.screenMinEdge < TABLET_MIN_EDGE ? 'phone' : 'tablet';
}

/** `preset` lowered by `steps`, down to Low at most. */
function lowered(preset: QualityPreset, steps: number): QualityPreset {
	return QUALITY_PRESETS[Math.max(0, presetIndex(preset) - steps)] ?? 'low';
}

/** The preset that the hints give: the device's own, one lower when its memory reads under 4 GB. */
export function hintedPreset(hints: DeviceHints): QualityPreset {
	const preset = DEVICE_PRESETS[deviceKind(hints)];
	const lowMemory = hints.deviceMemoryGB !== null && hints.deviceMemoryGB < LOW_MEMORY_GB;
	return lowMemory ? lowered(preset, 1) : preset;
}

/** `preset` after crashed starts: the same with none, one lower after one, and Low after two. */
export function afterCrashes(preset: QualityPreset, crashedStarts: number): QualityPreset {
	return crashedStarts >= 2 ? 'low' : lowered(preset, crashedStarts);
}

/** The preset that the page or a switch names, or else the one that the hints give. */
function wantedPreset(request: PresetRequest): QualityPreset {
	return request.wanted === 'auto' ? hintedPreset(request.hints) : request.wanted;
}

/**
 * The preset whose memory maximum the engine takes. The engine makes its memory while it tests the
 * GPU paths, so this preset follows the hints and the crashed starts alone, and the GPU path's
 * ceiling does not lower it.
 */
export function memoryPreset(request: PresetRequest): QualityPreset {
	return afterCrashes(wantedPreset(request), request.crashedStarts);
}

/**
 * The preset the engine runs on `tier`: the wanted or hinted preset within the GPU path's ceiling,
 * lowered after crashed starts.
 */
export function choosePreset(request: PresetRequest, tier: Tier): QualityPreset {
	const wanted = wantedPreset(request);
	const ceiling = TIER_CEILINGS[tier];
	const capped = presetIndex(wanted) <= presetIndex(ceiling) ? wanted : ceiling;
	return afterCrashes(capped, request.crashedStarts);
}

/**
 * The GPU path to start on after crashed starts, when the page leaves the path to the engine:
 * WebGL2 after two, when the last one ran on WebGPU. Undefined leaves the choice to the engine.
 */
export function crashTier(crashedStarts: number, lastTier: Tier | null): 'webgl2' | undefined {
	return crashedStarts >= 2 && lastTier !== null && lastTier !== 'webgl2' ? 'webgl2' : undefined;
}
