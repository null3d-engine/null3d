// The copy of a foundation add-on that an older build made. It runs the same version check as the
// add-on's own module, with the engine version that it was built for, so a page that imports it
// beside the shipped add-on holds two versions of one add-on. E1432 refuses that mix at the import.
import { checkAddonVersion } from '@null3d/engine';

/** The engine version that this copy of the add-on was built for. */
export const STALE_VERSION = '0.1.0';

checkAddonVersion('@null3d/impostors', STALE_VERSION);
