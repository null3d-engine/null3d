// The wind add-on for null3D: one field of air that plants, flags, smoke and water read. The field
// is an analytic wind of place and time, with traveling gusts and pushes, held in a grid that
// follows the camera. Built on the engine's public API only.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/wind', VERSION);

export type { FieldState, WindReading } from './analytic';
export { NAMESPACE } from './namespace';
export type { Wind, WindField, WindOptions } from './wind';
export { createWind } from './wind';
