// The bands of distance that a fixed plant's levels draw in: each level hands over to the next
// with the next at full coverage before its own edge thins, so no pixel drops out of both.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset } from '../asset';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { dequantisePosition } from '../lod/quantise';
import { EDGE_BAND } from './hand-over';
import { plantBoundingRadius } from './material';
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

describe("a fixed plant's sphere", () => {
	it(
		'holds everything its variant draws, inside the species box',
		async () => {
			const module = await loadSpecies('hawthorn-shrub');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
			const plant = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const radius = plantBoundingRadius(kit, plant);
			// Every vertex of every level, and every shoot row's reach, stands inside it.
			let farthest = 0;
			const at: [number, number, number] = [0, 0, 0];
			for (const level of plant.levels)
				for (const part of level.parts)
					for (let i = 0; i < part.arrays.positions.length / 3; i++) {
						dequantisePosition(part.arrays.positions, i, kit.box, at);
						farthest = Math.max(farthest, Math.hypot(...at));
					}
			const rows = plant.shoots;
			for (let r = 0; r < rows.count; r++)
				farthest = Math.max(
					farthest,
					Math.hypot(
						rows.position[r * 3] as number,
						rows.position[r * 3 + 1] as number,
						rows.position[r * 3 + 2] as number,
					) +
						(kit.prototypes[rows.prototype[r] as number]?.radius ?? 0) * (rows.scale[r] as number),
				);
			expect(farthest).toBeLessThanOrEqual(radius);
			// The species box holds every variant with room to spare, so its corner is farther.
			let corner = 0;
			for (const x of [kit.box.min[0], kit.box.max[0]])
				for (const y of [kit.box.min[1], kit.box.max[1]])
					for (const z of [kit.box.min[2], kit.box.max[2]])
						corner = Math.max(corner, Math.hypot(x, y, z));
			expect(radius).toBeLessThan(corner);
		},
		scaledBudget(60_000),
	);
});
