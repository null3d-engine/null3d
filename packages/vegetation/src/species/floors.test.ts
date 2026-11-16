// Each broadleaf, and the bracken, names the share of its foliage that its sparsest form keeps. A
// replay that loses one species' entry changes what the species draws without failing anything, so
// each species is pinned here by its own value.
import { describe, expect, it } from 'bun:test';
import { loadSpecies } from '../core/registry';

/** The share of its foliage each species' sparsest form keeps. */
const FLOORS: Readonly<Record<string, number>> = {
	'european-beech': 0.09,
	'pedunculate-oak': 0.08,
	'holm-oak': 0.31,
	'common-alder': 0.14,
	'common-ash': 0.26,
	'hawthorn-shrub': 0.11,
	'silver-birch': 0.11,
	'weeping-willow': 0.16,
	bracken: 0.4,
};

describe('the sparse floors', () => {
	it('holds every species at the foliage share its record names', async () => {
		for (const [id, foliage] of Object.entries(FLOORS)) {
			const module = await loadSpecies(id as Parameters<typeof loadSpecies>[0]);
			expect(module.record.sparse?.foliage, `${id} foliage`).toBe(foliage);
		}
	});
});
