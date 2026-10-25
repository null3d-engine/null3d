import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/splats', VERSION);

// Gaussian splats for null3D sketches: SPZ files and glTF models that carry KHR_gaussian_splatting,
// drawn as soft camera-facing Gaussians that mix with the scene's meshes by depth. A cloud is cut
// into chunks with detail levels, an add-on task chooses which splats draw within a budget that
// follows the quality preset and the GPU path, and the engine sorts the chosen rows back to front.
// A splat stream names its chunks in a small index, so a large cloud draws before its whole file
// has downloaded.
export type { ChunkOptions, SplatChunk, SplatChunks, Yielder } from './chunks';
export { chunkSplats } from './chunks';
export type { SplatData } from './format';
export { checkSplats, colorOfSh } from './format';
export { SPLAT_EXTENSION } from './gltf';
export { decodeSpz } from './spz';
export { encodeSpz } from './spz-write';
export type { SplatStream, StreamChunk } from './stream';
export { parseStreamIndex } from './stream';
export type { Splats, SplatsDraw, SplatsOptions } from './system';
export { createSplats } from './system';
