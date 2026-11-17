// The silver birch: its record and its texture files, which the textures package's module for the
// birch names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/silver-birch';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The silver birch grown by the planned model: straight to the asked maturity, sparseness and
 * triangle maximum. Its card levels draw one card set per clump, which its fill clothes at sockets.
 */
const planned: SpeciesForm = {
	form: 'the birch grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/** The silver birch as its directed frame grows it, which carries its hanging strands at sockets. */
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
 * The silver birch. The record as it stands grows the planned model, whose form words it carries;
 * the directed frame stays a form, so a page can still ask for the old tree by name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { ...(directed.forms ?? {}), planned, frame } },
	textures: files,
};
