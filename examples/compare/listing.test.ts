// The examples page lists the comparisons from listing.ts and runs them from comparisons.ts, so the
// two must name the same comparisons in the same order.
import { describe, expect, it } from 'bun:test';
import { COMPARISONS } from './comparisons';
import { COMPARISON_LISTINGS } from './listing';

describe('comparison listing', () => {
	it('lists every comparison, in the order of the full entries, with their titles', () => {
		expect(COMPARISONS.map(({ name, title }) => ({ name, title }))).toEqual(
			COMPARISON_LISTINGS.map(({ name, title }) => ({ name, title })),
		);
	});
});
