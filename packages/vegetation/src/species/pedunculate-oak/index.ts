// The pedunculate oak: its record and its texture files, which the textures package's module for
// the oak names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/pedunculate-oak';
import type { SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The oak grown by the planned model: straight to the asked maturity, sparseness and triangle
 * maximum. The record as it stands stays the oak grown by its frame.
 */
const planned: SpeciesForm = {
	form: 'the oak grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
};

/** The pedunculate oak, grown as a directed frame that carries its branch ends at sockets. */
export const species: SpeciesModule = {
	record: { ...directed, forms: { ...(directed.forms ?? {}), planned } },
	textures: files,
};
