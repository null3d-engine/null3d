// Octahedral impostors and merged far geometry for null3D: an object baked from many directions
// into one atlas, shown far away as cards that face the camera and pick the stored view nearest
// the camera, and the copies of a far level of detail merged into one mesh per grid cell. Both
// build on what the engine has: the impostor cards are sprite batches, and the merged meshes are
// `geometry.fromArrays`. So both draw on WebGPU and WebGL2 with no extra shaders.

export type { ImpostorOptions } from './batch';
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
