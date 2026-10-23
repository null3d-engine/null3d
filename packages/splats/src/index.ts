import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/splats', VERSION);

// Gaussian splats for null3D sketches: SPZ files and glTF models that carry KHR_gaussian_splatting,
// drawn as soft camera-facing Gaussians that mix with the scene's meshes by depth. A cloud is cut
// into chunks with detail levels, an add-on task chooses which splats draw within a budget that
// follows the quality preset and the GPU path, and the engine sorts the chosen rows back to front.
export type { ChunkOptions, SplatChunk, SplatChunks, Yielder } from './chunks';
export { chunkSplats } from './chunks';
export type { SplatData } from './format';
export { checkSplats, colorOfSh } from './format';
export { SPLAT_EXTENSION } from './gltf';
export { decodeSpz } from './spz';
export type { Splats, SplatsDraw, SplatsOptions } from './system';
export { createSplats } from './system';
