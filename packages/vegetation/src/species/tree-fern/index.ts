// The soft tree fern: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/tree-fern';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The soft tree fern. */
export const species: SpeciesModule = { record, textures: files };
