// The meadow grass: its record and its texture files, which the textures package's module for the
// grass names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/meadow-grass';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { plannedGrowth, seedlingForm } from './planned-record';
import { record as directed } from './record';

/**
 * The meadow grass grown by the planned model: straight to the asked maturity, sparseness and
 * triangle maximum. Its tuft adult is the tuft family's own plan, pieces and stool.
 */
const planned: SpeciesForm = {
	form: 'the meadow grass grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
};

/** The species' measured fields, without the growth the planned form states itself. */
const { forms: _forms, growth: _growth, ...measured } = directed;

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...measured, growth: plannedGrowth, forms: { seedling: seedlingForm, planned } },
	'planned',
);

/**
 * The meadow grass. The record as it stands grows the planned model, whose tuft adult and seedling
 * form it carries; the planned and seedling forms are the ones a page can name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { seedling: seedlingForm, planned } },
	textures: files,
};
