// The giant sequoia: its record and its texture files, which the textures package's module for the
// species names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/giant-sequoia';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The giant sequoia grown by the planned model: straight to the asked maturity, sparseness and
 * triangle maximum. Its card levels draw one card set per clump, which its fill clothes at sockets.
 */
const planned: SpeciesForm = {
	form: 'the sequoia grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...directed, forms: { ...(directed.forms ?? {}), planned } },
	'planned',
);

/**
 * The giant sequoia. The record as it stands grows the planned model, whose form words it carries;
 * the planned form is the one a page can name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { ...(directed.forms ?? {}), planned } },
	textures: files,
};
