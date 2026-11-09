// The meadow grass: its record and its texture files, which the textures package's module for the
// grass names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/meadow-grass';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The meadow grass. */
export const species: SpeciesModule = { record, textures: files };
