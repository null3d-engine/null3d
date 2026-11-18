// The grass add-on for null3D: tufts of bent blades over a ground, placed by integer hashes. WebGPU
// builds the blade list in a compute pass, whose count the near shadows read, and WebGL2 draws the
// same rows as an instance batch. The blades bend in the wind add-on's field. Built on the engine's
// public API only. The integer hash that places the tufts has an entry of its own,
// `@null3d/grass/hash`, which imports nothing.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/grass', VERSION);

export type { Grass, GrassBladeShape, GrassDraw, GrassMaterial, GrassOptions } from './grass';
export { createGrass } from './grass';
export { PLANT_SWAY_DISTANCE, swayDistanceFor } from './sway';
