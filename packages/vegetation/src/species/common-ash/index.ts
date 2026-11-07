// The common ash: its record and its texture files, which the textures package's module for the ash
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/common-ash';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The common ash. */
export const species: SpeciesModule = { record, textures: files };
