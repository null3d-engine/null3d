// The quality preset that null3D chooses on this device for a GPU path, and the preset's settings
// that the phone scene's three.js twin copies. It uses the engine's own chooser and preset table,
// with the rows that are planned as well as the ones the engine applies, so the twin follows the
// engine as its settings change.
import type { QualityPreset, Tier } from '@null3d/engine';
import { readDeviceHints } from '../../../packages/engine/src/page/capabilities';
import { choosePreset } from '../../../packages/engine/src/quality/chooser';
import { PLANNED_SETTINGS } from '../../../packages/engine/src/quality/preset-docs';
import {
	presetIndex,
	QUALITY_PRESETS,
	QUALITY_SETTINGS,
} from '../../../packages/engine/src/quality/presets';

/** Every row of the preset table: the settings that the engine applies, and the planned ones. */
const ALL_SETTINGS = { ...PLANNED_SETTINGS, ...QUALITY_SETTINGS };

/** The preset's settings that a twin copies. */
export interface TwinSettings {
	maxPixelRatio: number;
	maxAnisotropy: number;
	shadowCascades: number;
	shadowMapSize: number;
	/** The share of the canvas's width and height that ambient occlusion draws at, or 0 for none. */
	aoScale: number;
}

/**
 * The preset that null3D runs on `tier` on this device: the one that `?preset=` names, or the one
 * that the device hints give, within the GPU path's ceiling. A twin never crashed a start, so no
 * crash lowers it.
 */
export function chosenPreset(tier: Tier, params: URLSearchParams): QualityPreset {
	const named = QUALITY_PRESETS.find((preset) => preset === params.get('preset'));
	return choosePreset(
		{ wanted: named ?? 'auto', hints: readDeviceHints(), crashedStarts: 0 },
		tier,
	);
}

/** The settings of `preset` that a twin copies. */
export function twinSettings(preset: QualityPreset): TwinSettings {
	const value = (name: keyof typeof ALL_SETTINGS) =>
		ALL_SETTINGS[name].presets[presetIndex(preset)] as number;
	return {
		maxPixelRatio: value('maxPixelRatio'),
		maxAnisotropy: value('maxAnisotropy'),
		shadowCascades: value('shadowCascades'),
		shadowMapSize: value('shadowMapSize'),
		aoScale: value('aoScale'),
	};
}
