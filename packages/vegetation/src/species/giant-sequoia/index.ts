// The giant sequoia: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/giant-sequoia';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The giant sequoia, grown as a directed frame whose clumps carry its boughs at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
