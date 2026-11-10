// The weeping willow: its record and its texture files, which the textures package's module for the
// willow names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/weeping-willow';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The weeping willow. */
export const species: SpeciesModule = { record, textures: files };
