// The English elm: its record and its texture files, which the textures package's module for the
// elm names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/english-elm';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The English elm. */
export const species: SpeciesModule = { record, textures: files };
