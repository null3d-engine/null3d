// The Scots pine: its record and its texture files, which the textures package's module for the
// pine names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/scots-pine';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The Scots pine, grown as a directed frame that carries its boughs at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
