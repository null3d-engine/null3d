// The Scots pine: its record and its texture files, which the textures package's module for the
// pine names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/scots-pine';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The Scots pine. */
export const species: SpeciesModule = { record, textures: files };
