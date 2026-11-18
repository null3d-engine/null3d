// The public names of the grass that stands on a ground and bends in the wind add-on's field. The
// grass package draws it, and this add-on adds the cover that a species record gives it.
export type { Grass, GrassDraw, GrassMaterial, GrassOptions } from '@null3d/grass';
export { createGrass } from '@null3d/grass';
export { type GrassCover, grassCover } from './cover';
