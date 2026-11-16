// The pedunculate oak: its record and its texture files, which the textures package's module for
// the oak names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/pedunculate-oak';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The pedunculate oak, grown as a directed frame that carries its branch ends at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
