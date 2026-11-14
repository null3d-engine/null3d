// The olive: its record and its texture files, which the textures package's module for the olive
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/olive';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The olive, grown as a directed frame that carries its branch ends at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
