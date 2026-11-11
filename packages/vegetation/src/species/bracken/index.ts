// The bracken: its record and its texture files, which the textures package's module for the
// fern names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/bracken';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The bracken. */
export const species: SpeciesModule = { record, textures: files };
