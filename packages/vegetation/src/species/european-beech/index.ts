// The European beech: its record and its texture files, which the textures package's module for
// the beech names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/european-beech';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The European beech. */
export const species: SpeciesModule = { record, textures: files };
