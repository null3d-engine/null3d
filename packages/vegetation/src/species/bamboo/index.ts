// The bamboo: its record and its texture files, which the textures package's module for the bamboo
// names. The generated registry loads this entry as a chunk of its own.
//
// The bamboo is the planned model's first clump class, and it lands with its verdict pending: its
// gate round is owed, because the bamboo cannot pass the nine checks until the sweep and orbit
// exist. It is not a species counted done.
//
// The record states these choices, each with what it stands against:
// - The shell: the near card level draws 39,336 triangles at the record's own levels against the
//   directed clump's 48,523, 81 per cent and inside the half-to-full band; the cards alone are
//   21,978, 45 per cent, so the eye accepts the whole draw, not the cards alone.
// - The crown base: 0.307 of the height against the fit's 0.083, because the fit's base is the
//   hull's lowest foliage while the record's branching starts at 0.35.
// - The thin culm subset: 33 per cent of the culms, half the diameter and 0.6 to 0.8 of the height,
//   most at the rim, is a stated limit; the frame's width curve is read along a stem, not by the
//   stem's place.
// - The count by age and the clump's spread are class changes not yet modelled: the culm count and
//   the spread rise with maturity at a constant culm diameter, and a culm never thickens after it
//   emerges.
// - The per-place piece is a class change: the pairs change form up the culm while the planned
//   record names one piece for every socket. This record carries one fan at the twigs.
// - The reference conflict stands as the directed record states it: still 01's crown sky reads 0.16
//   against 0.13, and 02 and 18 close at 0.38 and 0.40 against 0.40.
// - The caps draw 397 / 399 / 393 at 400 through 1,992 / 1,992 / 1,996 at 2,000, inside every cap.
import { files } from '@null3d/vegetation-textures/bamboo';
import { formRecord } from '../../core/forms';
import type { SpeciesForm, SpeciesModule } from '../../core/record';
import { directed } from './directed';
import { plannedGrowthDeep } from './planned-frame';
import { PLANNED_PIECES } from './planned-pieces';

/** The bamboo as the planned grower draws it: straight to the asked state, its fan at each twig. */
const planned: SpeciesForm = {
	form: 'the bamboo planned class, straight to the asked state',
	growth: plannedGrowthDeep,
	lod: { clumpCard: [1, 1] },
};

/** The species' measured fields, without the growth the planned form states itself. */
const { forms: _forms, growth: _growth, pieces: _pieces, ...measured } = directed;

/** The record the planned form grows from, found exactly as a page asking for it would. */
const plannedRecord = formRecord(
	{
		...measured,
		growth: plannedGrowthDeep,
		pieces: PLANNED_PIECES as never,
		forms: { planned },
	},
	'planned',
);

/** The bamboo, grown as a planned clump of culms whose crown is the pair's fans. */
export const species: SpeciesModule = { record: plannedRecord, textures: files };
