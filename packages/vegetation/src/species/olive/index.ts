// The olive: its record and its texture files, which the textures package's module for the olive
// names. The generated registry loads this entry as a chunk of its own.
import { files } from '@null3d/vegetation-textures/olive';
import { formRecord } from '../../core/forms';
import type { Species, SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowth } from './planned-record';

/**
 * The olive grown by the planned model: straight to the asked maturity, sparseness and triangle
 * maximum. Its card levels draw one card set per clump, which its fill clothes at sockets.
 */
const planned: SpeciesForm = {
	form: 'the olive grown straight to the asked state, at any maturity, sparseness or maximum',
	growth: plannedGrowth,
	// Each clump stands for a spray's whole mass, so the crown's few masses take the cover the
	// near level's branch ends make: the cards grow about their middles as far as the leaf hull
	// allows.
	//
	// The faces and the cover are read from the leaf form's own covered share, not chosen: the
	// crown's plates leave the gaps their clumps leave, and more faces at each clump's middle close
	// them. The measured series at the whole view puts the crossing's step at two points for the
	// sixteen faces alone and one point with the cover of 1.1, where the leaf form reads 0.18 of
	// open sky and the crossing 0.17; a cover of 1.15 over-closes it. The second level keeps twelve
	// faces, the most its 12,293-triangle cap pays; sixteen would cost 15,309.
	lod: { clumpCard: [1, 1], cardGrow: 1.4, clumpPlanes: [16, 12], cardCover: 1.1 },
};

/** The species' measured fields, without the growth the planned form states itself. */
const { forms: _forms, growth: _growth, ...measured } = directed;

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord: Species = formRecord(
	{ ...measured, growth: plannedGrowth, forms: { planned } },
	'planned',
);

/**
 * The olive. The record as it stands grows the planned model, whose form words it carries; the
 * planned form is the only one a page can name.
 */
export const species: SpeciesModule = {
	record: { ...plannedRecord, forms: { planned } },
	textures: files,
};
