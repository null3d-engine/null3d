// The pedunculate oak: its record and its texture files, which the textures package's module for
// the oak names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/pedunculate-oak';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The oak grown by the planned model: straight to the asked maturity, sparseness and triangle
 * maximum. Its card levels draw one card set per clump, which its fill clothes at sockets, so a
 * clump carries its own baked shade.
 */
const planned: SpeciesForm = {
	form: 'the oak grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	lod: { clumpCard: [1, 1] },
};

/**
 * The record the planned form grows from, found by merging the form into the frame record exactly as
 * a page asking for it would. The record as it stands is this one.
 */
const plannedRecord: Species = formRecord(
	{ ...directed, forms: { ...(directed.forms ?? {}), planned } },
	'planned',
);

/**
 * The pedunculate oak. The record as it stands grows the planned model, whose form words it
 * carries, and `planned` stays a form so a page that names it grows the same default plant.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { ...(directed.forms ?? {}), planned } },
	textures: files,
};
