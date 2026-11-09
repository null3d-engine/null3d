// The common alder: its record and its texture files, which the textures package's module for the
// alder names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/common-alder';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The common alder. */
export const species: SpeciesModule = { record, textures: files };
