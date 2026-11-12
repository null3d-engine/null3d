// The giant sequoia: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/giant-sequoia';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The giant sequoia. */
export const species: SpeciesModule = { record, textures: files };
