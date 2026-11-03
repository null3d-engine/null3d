// The vegetation add-on for null3D. The main entry holds the scatter that places plants by ecological
// rules, the ground maps it reads, the grass and the floating leaves. The first plant generator, with
// its materials, wind and far trees, is at `@null3d/vegetation/legacy`. Each module keeps its public
// names in its own `public.ts`, and this file only re-exports them. Built on the engine's public API
// only.
import { checkAddonVersion, declareAddonNamespace } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/vegetation', VERSION);

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

export * from './ecology/public';
export * from './floating-leaves/public';
export * from './grass/public';
export * from './grid/public';
export * from './ground/public';
export * from './scatter/public';
export * from './variance/public';
