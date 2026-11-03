// The add-on's names, claimed once as the sketch's thread loads. The package's entry and the near
// pool's quality feature both read them, so they live apart from either.
import { declareAddonNamespace } from '@null3d/engine';

/**
 * The add-on's names, claimed once as the page loads: its error codes and its quality keys.
 *
 * @category api/vegetation
 */
export const NAMESPACE = declareAddonNamespace({
	name: 'vegetation',
	package: '@null3d/vegetation',
	errorCodes: [2300, 2399],
});
