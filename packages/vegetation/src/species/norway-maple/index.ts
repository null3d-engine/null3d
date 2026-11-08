// The Norway maple: its record and its texture files, which the textures package's module for the
// maple names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/norway-maple';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The Norway maple. */
export const species: SpeciesModule = { record, textures: files };
