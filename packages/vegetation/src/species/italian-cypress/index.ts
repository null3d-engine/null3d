// The Italian cypress: its record and its texture files, which the textures package's module for the
// cypress names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/italian-cypress';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The Italian cypress, grown as a directed frame whose closed shell carries its fans at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
