// The wind add-on for null3D: one field of air that plants, flags, smoke and water read. The field
// is an analytic wind of place and time, with traveling gusts and pushes, held in a grid that
// follows the camera. Built on the engine's public API only.
import { checkAddonVersion, declareAddonNamespace } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/wind', VERSION);

/**
 * The add-on's names, claimed once as the page loads: its shader library and its error codes.
 *
 * @category api/wind
 */
export const NAMESPACE = declareAddonNamespace({
	name: 'wind',
	package: '@null3d/wind',
	errorCodes: [2400, 2499],
});

export type { FieldState, Push } from './analytic';
export { analyticVelocity, defaultFieldState, profile } from './analytic';
export type { Wind, WindField, WindOptions } from './wind';
export { createWind } from './wind';
