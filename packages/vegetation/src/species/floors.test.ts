// The owner's ruling names a floor of limbs, leaves and coarseness for each broadleaf, and the
// measured phone figures describe that form. A replay that loses one species' entry changes what
// the species grows without failing anything, so each species is pinned here by its own values.
import { describe, expect, it } from 'bun:test';
import { loadSpecies } from '../core/registry';

/** The floors the ruling names, per species: limbs, leaves and coarseness. */
const RULED: Readonly<Record<string, readonly [number, number, number]>> = {
	'european-beech': [0.32, 0.38, 0.65],
	'pedunculate-oak': [0.35, 0.42, 0.6],
	'holm-oak': [0.4, 0.5, 0.55],
	'common-alder': [0.45, 0.5, 0.55],
	'common-ash': [0.45, 0.5, 0.55],
	'hawthorn-shrub': [0.5, 0.5, 0.55],
	'silver-birch': [0.45, 0.55, 0.5],
	'weeping-willow': [0.4, 0.5, 0.55],
};

describe('the ruled sparse floors', () => {
	it('holds every broadleaf at the floors the ruling names', async () => {
		for (const [id, [limbs, leaves, coarseness]] of Object.entries(RULED)) {
			const module = await loadSpecies(id as Parameters<typeof loadSpecies>[0]);
			const sparse = module.record.sparse;
			expect(sparse?.limbs, `${id} limbs`).toBe(limbs);
			expect(sparse?.leaves, `${id} leaves`).toBe(leaves);
			expect(sparse?.coarseness, `${id} coarseness`).toBe(coarseness);
		}
	});
});
