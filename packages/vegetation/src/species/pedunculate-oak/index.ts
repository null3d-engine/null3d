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
	// The second card level draws six vertical faces at each clump. Its three pictures a side leave
	// the crown's clump gaps open: in a fixed four-metre patch at the level's own switch the covered
	// share fell 7.7 points from the first card level's (0.992 to 0.914). Six faces close the gap to
	// a step of 0.8 points (0.992 to 1.000), at 41,644 triangles inside the level's 44,600; four
	// faces leave the fall at 6.6 points, and a seventh face would pass the cap.
	lod: { clumpCard: [1, 1], clumpPlanes: [2, 6] },
};

/** The species' measured fields, without the growth the planned form states itself. */
const { forms: _forms, growth: _growth, ...measured } = directed;

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...measured, growth: plannedGrowth, forms: { planned } },
	'planned',
);

/**
 * The pedunculate oak. The record as it stands grows the planned model, whose form words it
 * carries, and `planned` stays a form so a page that names it grows the same default plant.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { planned } },
	textures: files,
};
