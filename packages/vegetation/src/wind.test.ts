import { describe, expect, test } from 'bun:test';
import { builtInSpecies } from './builtin';
import { generatePlant, WIND_STRIDE } from './generate';
import { growSkeleton } from './skeleton';
import type { Species } from './species';

const oak = builtInSpecies('oak') as Species;

describe('the wind data', () => {
	test('holds one record for each branch, sixteen floats each', () => {
		const asset = generatePlant(oak, { seed: 4 });
		const skeleton = growSkeleton(oak, 4, 0);
		expect(asset.wind.stride).toBe(WIND_STRIDE);
		expect(asset.wind.branches).toBe(skeleton.branches.length);
		expect(asset.wind.pivots.length).toBe(asset.wind.branches * WIND_STRIDE);
	});

	test('names a parent above each branch, and the root first', () => {
		const asset = generatePlant(oak, { seed: 4 });
		const pivots = asset.wind.pivots;
		for (let branch = 0; branch < asset.wind.branches; branch++) {
			const at = branch * WIND_STRIDE;
			const parent = pivots[at + 6] as number;
			expect(parent).toBeLessThan(branch);
			expect(pivots[at + 11] as number).toBeGreaterThan(0);
			expect(pivots[at + 7] as number).toBeGreaterThanOrEqual(0);
			expect(pivots[at + 7] as number).toBeLessThanOrEqual(1);
			const axis = Math.hypot(
				pivots[at + 3] as number,
				pivots[at + 4] as number,
				pivots[at + 5] as number,
			);
			expect(axis).toBeCloseTo(1, 4);
		}
		expect(pivots[6]).toBe(-1);
	});

	test('gives a rosette one record at its base', () => {
		const fern = builtInSpecies('fern') as Species;
		const asset = generatePlant(fern, { seed: 2 });
		expect(asset.wind.branches).toBe(1);
		expect(asset.wind.pivots[6]).toBe(-1);
		expect(asset.wind.pivots[4]).toBe(1);
	});

	test('packs a branch index and a stiffness into the vertex colors', () => {
		for (const id of ['oak', 'conifer', 'shrub', 'fern', 'meadow-grass']) {
			const species = builtInSpecies(id) as Species;
			const asset = generatePlant(species, { seed: 6 });
			for (const level of asset.levels) {
				for (const part of level.parts) {
					const colors = part.arrays.colors;
					for (let v = 0; v < colors.length / 4; v++) {
						expect(colors[v * 4] as number).toBeLessThan(asset.wind.branches);
						expect(colors[v * 4 + 1] as number).toBeLessThanOrEqual(255);
						expect(colors[v * 4 + 2] as number).toBeLessThanOrEqual(255);
						expect(colors[v * 4 + 3] as number).toBeLessThanOrEqual(255);
					}
				}
			}
		}
	});

	test('drops the flutter phase as levels coarsen, because fewer cards remain', () => {
		const asset = generatePlant(oak, { seed: 6 });
		const leaves = (level: number) =>
			asset.levels[level]?.parts.find((part) => part.name === 'leaves');
		const base = leaves(0)?.arrays.positions.length as number;
		const coarse = leaves(2)?.arrays.positions.length as number;
		expect(coarse).toBeLessThan(base);
	});
});
