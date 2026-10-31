// The water add-on for null3D: a river and a lake from one description, drawn with waves that the
// current carries, ripples, caustics, foam, a soft shore that reads the scene's depth or the shape's
// bed, a reflection whose cadence follows the quality preset, and the view from under the surface.
// Built on the engine's public API only.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/water', VERSION);

export type { FoamMapOptions, FoamObstacle } from './foam';
export { foamMap } from './foam';
export type { MeshDetail } from './mesh';
export type {
	BedDepth,
	FlowAt,
	LakeDepth,
	LakeShape,
	RiverDepth,
	RiverShape,
	WaterBody,
	WaterPoint,
	WaterShape,
} from './shape';
export { waterBody } from './shape';
export type { Underwater, UnderwaterOptions } from './underwater';
export { createUnderwater } from './underwater';
export type { FoamMap, Water, WaterMaterialOptions, WaterOptions } from './water';
export { createWater, waveHeight } from './water';
