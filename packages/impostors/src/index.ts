// Octahedral impostors and merged far geometry for null3D: an object baked from many directions
// into two atlases, shown far away as cards that face the camera, blend the three stored views
// nearest the camera and relight from the stored normals, and the copies of a far level of detail
// merged into one mesh per grid cell. The cards draw with the package's material, which the engine
// compiles from the WGSL that ships here; the merged meshes are `geometry.fromArrays`. Both draw on
// WebGPU and WebGL2.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/impostors', VERSION);

export type {
	ImpostorBake,
	ImpostorBakeMap,
	ImpostorBakeOptions,
	ImpostorBakePart,
} from './bake';
export { bakeImpostorAtlas } from './bake';
export type { ImpostorContext, ImpostorOptions } from './batch';
export { createImpostors, ImpostorBatch } from './batch';
export type { FarPart } from './merge';
export { farCellGroups, mergeFarGeometry } from './merge';
export type { Direction, OctahedralAtlas, OctahedralUv } from './octahedral';
export {
	decodeOctahedral,
	encodeOctahedral,
	frameDirection,
	impostorFrame,
	nearestFrame,
	octahedralAtlas,
	octahedralCells,
} from './octahedral';
export { encodeImpostorSurface } from './surface';
