// A small add-on that builds on another null3D package. The build keeps that package external, so
// the import survives in the built file, and a test reads it there.
import { createImpostors } from '@null3d/impostors';

export const make = createImpostors;
