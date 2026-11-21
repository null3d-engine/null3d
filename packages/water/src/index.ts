// The water add-on for null3D: a river and a lake from one description, drawn with waves that the
// current carries, ripples, caustics, foam, a soft shore that reads the scene's depth or the shape's
// bed, a reflection whose cadence follows the quality preset, the view from under the surface, and
// waterfalls that fall from a river's lip. Built on the engine's public API, and on the particles
// add-on for a fall's spray and mist.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/water', VERSION);

export type { WaterfallMesh } from './fall';
export type { FoamMapOptions, FoamObstacle } from './foam';
export { foamMap } from './foam';
export type { MeshDetail } from './mesh';
export type { Ocean, OceanMaterialOptions, OceanOptions } from './ocean';
export { createOcean, OCEAN_BANDS } from './ocean';
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
export type { OceanBand } from './spectrum';
export type { Underwater, UnderwaterOptions } from './underwater';
export { createUnderwater } from './underwater';
export type { FoamMap, Water, WaterMaterialOptions, WaterOptions, WaterWind } from './water';
export { createWater, waveHeight } from './water';
export type { Waterfall, WaterfallMaterialOptions, WaterfallOptions } from './waterfall';
export { createWaterfall } from './waterfall';
