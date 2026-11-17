// The Scots pine: its record and its texture files, which the textures package's module for the
// pine names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/scots-pine';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/** The Scots pine grown by the planned model, straight to the asked state. */
const planned: SpeciesForm = {
	form: 'the Scots pine grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...directed, forms: { ...(directed.forms ?? {}), planned } },
	'planned',
);

/**
 * The Scots pine. The record as it stands grows the planned model, whose form words it carries;
 * the planned form is the one a page can name.
 */
export const species: SpeciesModule = {
	record: {
		...plannedRecord,
		// The class's rows a clump, not one card a clump: the box, the share and the cards agree.
		lod: { ...plannedRecord.lod, clumpCard: [0, 0] },
		forms: { ...(directed.forms ?? {}), planned },
	},
	textures: files,
};
