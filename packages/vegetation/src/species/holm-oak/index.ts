// The holm oak: its record and its texture files, which the textures package's module for the
// holm oak names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/holm-oak';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The holm oak grown by the planned model: straight to the asked maturity, sparseness and
 * triangle maximum. Its card levels draw one card set per clump, which its fill clothes at
 * sockets.
 */
const planned: SpeciesForm = {
	form: 'the holm oak grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/** The holm oak as its directed frame grows it, which carries its branch ends at sockets. */
const frame: SpeciesForm = {
	form: directed.form,
	growth: directed.growth,
	lod: directed.lod,
};

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...directed, forms: { ...(directed.forms ?? {}), planned } },
	'planned',
);

/**
 * The holm oak. The record as it stands grows the planned model, whose form words it carries; the
 * directed frame stays a form, so a page can still ask for the old clump by name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { ...(directed.forms ?? {}), planned, frame } },
	textures: files,
};
