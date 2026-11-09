// The bands of distance that a fixed plant's levels draw in: each level hands over to the next
// with the next at full coverage before its own edge thins, so no pixel drops out of both.
import { describe, expect, it } from 'bun:test';
import type { PlantAsset } from '../asset';
import { EDGE_BAND } from './hand-over';
import { levelBands } from './static-shoots';

/** An asset with three levels of the given starts, and shoot rows or none. */
function asset(froms: readonly number[], parts: readonly number[], shoots: number): PlantAsset {
	return {
		levels: froms.map((from, k) => ({
			from,
			parts: Array.from({ length: parts[k] as number }, () => ({ name: 'wood' })),
		})),
		shoots: { count: shoots },
	} as unknown as PlantAsset;
}

describe('the level bands of a fixed plant', () => {
	it('starts each level at its own distance and the first card level at the shoots', () => {
		const bands = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1.5, 400);
		expect(bands.map((b) => b.from)).toEqual([0, 12, 120]);
		expect(bands[2]?.to).toBe(400);
	});

	it('keeps each level whole until the next has faded in, then thins it out', () => {
		const bands = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1.5, 400);
		for (let k = 0; k + 1 < bands.length; k++) {
			const band = bands[k] as { from: number; to: number };
			const next = bands[k + 1] as { from: number; to: number };
			// The next level's fade-in ends where this level's fade-out begins, and not after it.
			expect(next.from * (1 + EDGE_BAND)).toBeLessThanOrEqual(band.to / (1 + EDGE_BAND) + 1e-9);
			expect(band.to).toBeGreaterThan(next.from);
		}
	});

	it('runs a level on to the next level with parts, or to the impostor', () => {
		// The middle level is empty, so the first hands over to the last.
		const bands = levelBands(asset([0, 30, 80], [2, 0, 2], 0), 12, 1, 400);
		expect(bands[0]?.to).toBeCloseTo(80 * (1 + EDGE_BAND) ** 2, 9);
		// A cutting has the nearest level alone and draws at every distance.
		const cut = levelBands(asset([0, 30, 80], [2, 0, 0], 0), 12, 1, Number.POSITIVE_INFINITY);
		expect(cut[0]?.to).toBe(Number.POSITIVE_INFINITY);
		// The handover never reaches past the impostor's distance.
		const short = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1, 82);
		expect(short[1]?.to).toBe(82);
	});
});
