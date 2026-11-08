// The small-leaved lime: its record and its texture files, which the textures package's module for
// the lime names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/small-leaved-lime';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The small-leaved lime. */
export const species: SpeciesModule = { record, textures: files };
