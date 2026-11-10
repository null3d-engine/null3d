// The hosta: its record and its texture files, which the textures package's module for the hosta
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/hosta';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The hosta. */
export const species: SpeciesModule = { record, textures: files };
