// The date palm: its record and its texture files, which the textures package's module for the
// palm names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/date-palm';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The date palm. */
export const species: SpeciesModule = { record, textures: files };
