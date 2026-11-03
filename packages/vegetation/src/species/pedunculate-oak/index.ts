// The pedunculate oak: its record and its texture files, which the textures package's module for
// the oak names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/pedunculate-oak';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The pedunculate oak. */
export const species: SpeciesModule = { record, textures: files };
