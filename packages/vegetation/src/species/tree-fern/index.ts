// The soft tree fern: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/tree-fern';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The soft tree fern, grown as a directed crown that carries its fronds at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
