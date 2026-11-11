// The silver birch: its record and its texture files, which the textures package's module for the
// birch names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/silver-birch';
import type { SpeciesModule } from '../../core/record';
import { record } from './record';

/** The silver birch. */
export const species: SpeciesModule = { record, textures: files };
