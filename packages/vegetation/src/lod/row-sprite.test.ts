// The row-sprite alpha coverage: a row stands under drawn foliage when one of the level's card
// texels, read through the card atlas's alpha, lies within the body rail's cell of its base. The
// measure is calibrated on two rows known by eye before it is asked about any plant: the
// hawthorn's row 44, which stands bare in the crown's ring, and the oak's row 17, which stands
// under overlapping sprays. If the pair does not separate, the measure is wrong, not the trees.
//
// Read on 18 November 2026 at detail low, seed 11, variant 0, sparseness 0:
//
// - the oak's row 17: 854,894 pictured texels; nearest 0.257 m; 1,788 within a cell, on all six
//   sides. Covered, as the eye says.
// - the hawthorn's row 44: 327,673 pictured texels; nearest 0.333 m; 4,333 within a cell, on all
//   six sides. The field cannot call it bare, though the eye does: its own card's pictured leaves
//   stand round its base, so a base point cannot separate a bare row from a covered one.
//
// The pair does not separate on the level's alpha field, so that measure is wrong for the rail.
// The picture-side measure is owed: the level's picture of the parts, read at the row's projected
// base, where a bare row shows wood or sky and a covered one shows foliage.
import { describe, expect, test } from 'bun:test';
import { loadSpecies } from '../core/registry.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate.ts';
import { PICTURED_REACH, picturedField } from './body.test-support.ts';

/** A row's base in plant space. */
function baseOf(
	plant: ReturnType<typeof growPlantNow>,
	row: number,
): readonly [number, number, number] {
	const shoots = plant.shoots;
	return [
		shoots.position[row * 3] as number,
		shoots.position[row * 3 + 1] as number,
		shoots.position[row * 3 + 2] as number,
	];
}

describe('the row-sprite alpha coverage', () => {
	test('reads the oak’s known covered row as under drawn foliage', async () => {
		const module = await loadSpecies('pedunculate-oak');
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		const plant = growPlantNow(kit, { seed: 11, variant: 0, near: true, sparse: 0 });
		const field = picturedField(kit, plant, 1);
		const nearest = field.nearest(baseOf(plant, 17));
		expect(field.texels).toBeGreaterThan(0);
		expect(nearest).not.toBeNull();
		expect(nearest as number).toBeLessThanOrEqual(PICTURED_REACH);
	}, 120_000);

	test.failing('separates the calibration pair: the hawthorn’s row 44 must read bare', async () => {
		const module = await loadSpecies('hawthorn-shrub');
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		const plant = growPlantNow(kit, { seed: 11, variant: 0, near: true, sparse: 0 });
		const field = picturedField(kit, plant, 1);
		const nearest = field.nearest(baseOf(plant, 44));
		expect(nearest === null || nearest > PICTURED_REACH).toBe(true);
	}, 120_000);
});
