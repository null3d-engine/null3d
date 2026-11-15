// The silver birch: its record and its texture files, which the textures package's module for the
// birch names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/silver-birch';
import type { SpeciesModule } from '../../core/record';
import { directed } from './directed';

/** The silver birch, grown as a directed frame that carries its hanging strands at sockets. */
export const species: SpeciesModule = { record: directed, textures: files };
