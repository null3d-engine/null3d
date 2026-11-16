// The bamboo: its record and its texture files, which the textures package's module for the bamboo
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/bamboo';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The bamboo, grown as a directed clump of culms that carries its branch pairs at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
