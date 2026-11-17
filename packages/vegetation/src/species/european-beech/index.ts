// The European beech: its record and its texture files, which the textures package's module for
// the beech names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/european-beech';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The European beech grown by the planned model: straight to the asked maturity, sparseness and
 * triangle maximum. Its card levels draw one card set per clump, which its fill clothes at sockets.
 */
const planned: SpeciesForm = {
	form: 'the beech grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/** The European beech as its directed frame grows it, which carries its branch ends at sockets. */
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
 * The European beech. The record as it stands grows the planned model, whose form words it carries;
 * the directed frame stays a form, so a page can still ask for the old tree by name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { ...(directed.forms ?? {}), planned, frame } },
	textures: files,
};
