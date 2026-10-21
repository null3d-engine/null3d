// The terrain add-on for null3D: a height field drawn as a camera-centered quadtree of blocks, so
// the ground near the camera is fine and the far ground is cheap. One splat-mapped material blends
// up to four tiled layers over every block, and the ground carries no collision. Games read
// `heightAt` and `normalAt` to place what stands on it. Built on the engine's public API only.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/terrain', VERSION);

export type { HeightfieldOptions } from './heightfield';
export { createHeightfield, Heightfield } from './heightfield';
export type { SplatFunction, TerrainLayer, TerrainOptions } from './terrain';
export { createTerrain, Terrain } from './terrain';
export type { TerrainTextureOptions, TerrainTextures } from './textures';
export { terrainTextures } from './textures';
