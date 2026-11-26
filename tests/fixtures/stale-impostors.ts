// The copy of a foundation add-on that a build for another engine version made. It runs the same
// version check as the add-on's own module, with the engine version that it was built for, so a page
// that imports it beside the shipped add-on holds two versions of one add-on. E1432 refuses that mix
// at the import.
import { checkAddonVersion, VERSION } from '@null3d/engine';
import { otherVersion } from '../lib/other-version';

/**
 * The engine version that this copy of the add-on was built for: one major release past the
 * engine's, which no release of this engine has, so it never matches the engine that runs.
 */
export const STALE_VERSION = otherVersion(VERSION);

checkAddonVersion('@null3d/impostors', STALE_VERSION);
