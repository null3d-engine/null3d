// The wind's settings for each quality preset. A plant's sway fades to nothing at the material's
// sway distance, so plants past it stand still and their far shadow cascades keep the layers they
// hold. A heavier preset affords more of the grove in motion, so the distance grows with it, and a
// page takes its preset's value rather than choosing one of its own.
import type { QualityPreset } from '@null3d/engine';

/**
 * The distance from the camera out to which plants sway, in meters, for each preset. The grove's
 * page reads it from the engine's preset, so a governor step that lowers the preset shortens the
 * distance with it.
 *
 * @category api/vegetation
 */
export const PLANT_SWAY_DISTANCE: Readonly<Record<QualityPreset, number>> = {
	low: 8,
	medium: 16,
	high: 24,
	ultra: 32,
};

/**
 * The distance from the camera out to which plants sway at a preset, in meters.
 *
 * @param preset The engine's quality preset.
 * @returns The distance that {@link PLANT_SWAY_DISTANCE} gives the preset.
 * @category api/vegetation
 */
export function swayDistanceFor(preset: QualityPreset): number {
	return PLANT_SWAY_DISTANCE[preset];
}
