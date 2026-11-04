// The three.js compatibility add-on for null3D: the tone curves that three.js has and the engine
// keeps out of its core, and the soft outline of three.js's OutlinePass. Both reach the engine
// through its own settings, the tone mapping and the outline mask, and through the public passes
// and effects. Built on the engine's public API only.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/three-compat', VERSION);

export { createOutlinePass, type OutlinePass, type OutlinePassOptions } from './outline';
export { cineon, reinhard } from './tone';
