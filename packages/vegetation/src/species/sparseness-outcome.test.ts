// What the sparseness parameter does to a planned plant: it takes foliage and the branches that
// carried it out, and it does not move the tree. The contracts here are stated over the plants that
// grow by planning, since a planned plant grows each state directly rather than cutting one grown
// plant, so the state's own numbers are what a caller reads.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { SpeciesKitData } from '../asset';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { partTotal } from '../lod/budget';

/** A species grows at five sparseness values; a busy machine takes tens of seconds. */
const LONG = scaledBudget(240_000);

/** The sparseness values, rising. */
const LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * The plants the contracts are stated over, with the figures they were measured at. At low detail,
 * seed 11 and variant 0, the sparsest near level holds this share of the densest one's triangles:
 * the pedunculate oak 0.108, the silver birch 0.188 and the hawthorn shrub 0.132.
 */
const PLANTS = ['pedunculate-oak', 'silver-birch', 'hawthorn-shrub'] as const;

/** One planned species' kit, loaded once for the five grows. */
async function kitOf(id: (typeof PLANTS)[number]): Promise<SpeciesKitData> {
	const module = await loadSpecies(id);
	await loadPlantCode(module.record);
	return buildKitNow(module, { placeholders: 'missing', detail: 'low' });
}

describe('the sparseness of a planned plant', () => {
	for (const id of PLANTS) {
		it(
			`${id}: thins every level and every step, and holds the plant's height and its crown's box`,
			async () => {
				const kit = await kitOf(id);
				const states = LEVELS.map((sparse) =>
					growPlantNow(kit, { seed: 11, variant: 0, near: true, sparse }),
				);
				const [densest] = states as [(typeof states)[number]];
				const boundsOf = (plant: (typeof states)[number]) => [
					plant.skeleton.bounds.max[0] - plant.skeleton.bounds.min[0],
					plant.skeleton.bounds.max[2] - plant.skeleton.bounds.min[2],
				];
				for (const [index, plant] of states.entries()) {
					const at = `sparse ${LEVELS[index]}`;
					// The tree does not move: the same height and the same crown box at every value.
					expect([at, plant.skeleton.height]).toEqual([at, densest.skeleton.height]);
					expect([at, ...boundsOf(plant)]).toEqual([at, ...boundsOf(densest)]);
					// Every level draws fewer triangles than the state before it, and the wood thins too.
					if (index > 0) {
						const before = states[index - 1] as (typeof states)[number];
						for (const level of [0, 1, 2] as const)
							expect([
								at,
								level,
								partTotal(plant.stats.parts[level]) < partTotal(before.stats.parts[level]),
							]).toEqual([at, level, true]);
						expect([at, plant.skeleton.axes.count < before.skeleton.axes.count]).toEqual([
							at,
							true,
						]);
					}
				}
				// The sparsest near level holds at most a quarter of the densest one's triangles, which
				// is under the measured 0.188 the three plants' comment names.
				const sparsest = states[LEVELS.length - 1] as (typeof states)[number];
				expect([
					partTotal(sparsest.stats.parts[0]) / partTotal(densest.stats.parts[0]) <= 0.25,
				]).toEqual([true]);
				// A crown that still draws: the sparsest leaves and twigs are not empty.
				expect([sparsest.stats.parts[0].leaves > 0]).toEqual([true]);
			},
			LONG,
		);
	}
});
