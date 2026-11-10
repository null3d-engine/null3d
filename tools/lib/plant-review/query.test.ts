import { describe, expect, test } from 'bun:test';
import { readPlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';

describe('the review query', () => {
	test('accepts the measured daylight above the old eight cap', () => {
		// A reference whose light no fit measures, as the sedge's soil-backed crown, needs 9.2 to
		// reach its record colour; the cap that refused it stood at 8.
		const read = (daylight: string) =>
			readPlantReviewQuery(new URLSearchParams(`species=stub&daylight=${daylight}`));
		expect(read('9.2').daylight).toBeCloseTo(9.2, 6);
		expect(read('10').daylight).toBe(10);
	});

	test('refuses a daylight above the cap', () => {
		expect(() => readPlantReviewQuery(new URLSearchParams('species=stub&daylight=10.5'))).toThrow(
			/up to 10/,
		);
	});
});
