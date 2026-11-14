// The weeping willow: its record and its texture files, which the textures package's module for the
// willow names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/weeping-willow';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The weeping willow, grown as a directed frame that carries its hanging strands at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
