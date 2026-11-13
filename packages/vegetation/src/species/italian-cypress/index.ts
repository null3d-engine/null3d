// The Italian cypress: its record and its texture files, which the textures package's module for the
// cypress names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/italian-cypress';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The Italian cypress. */
export const species: SpeciesModule = { record, textures: files };
