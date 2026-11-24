// The add-on's names, claimed once as the sketch's thread loads.
import { declareAddonNamespace } from '@null3d/engine';

/**
 * The add-on's names, claimed once as the sketch loads: its name, its package and its error codes.
 *
 * @category api/sound
 */
export const NAMESPACE = declareAddonNamespace({
	name: 'sound',
	package: '@null3d/sound',
	errorCodes: [2500, 2599],
});
