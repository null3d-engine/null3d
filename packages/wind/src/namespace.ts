// The add-on's names, claimed once as the sketch's thread loads. The package's entry and the wind
// field both read them, so they live apart from either.
import { declareAddonNamespace } from '@null3d/engine';

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
