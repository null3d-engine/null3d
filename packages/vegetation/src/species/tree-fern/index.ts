// The soft tree fern: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/tree-fern';
import type { SpeciesModule } from '../../core/record';
import { planned } from './planned-record';

/** The soft tree fern, grown as one stout trunk under a planned rosette of fronds. */
export const species: SpeciesModule = { record: planned, textures: files };
