// The bamboo: its record and its texture files, which the textures package's module for the bamboo
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/bamboo';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The bamboo. */
export const species: SpeciesModule = { record, textures: files };
