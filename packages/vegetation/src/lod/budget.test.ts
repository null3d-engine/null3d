// A level's triangle budget: a page sets a target for each level, the plant keeps the form its
// sparse level grew, and the level's cards, wood and extras fit inside the target. The cards thin in
// their space-filling order and grow to hold the crown; a level with no target keeps the form.
import { describe, expect, it } from 'bun:test';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode, variantKey } from '../generate';
import type { MeshInput } from '../stages';
import { cardPlan, checkBudgets, checkExtrasShare, partShares } from './budget';
import { cardKeep, cardRowTriangles } from './cards';

const SEED = 11;

async function oakKit() {
	const module = await loadSpecies('pedunculate-oak');
	await loadPlantCode(module.record);
	return buildKitNow(module, { placeholders: 'missing', detail: 'low' });
}

/** The levels' triangles of an oak grown with a budget for the two card levels. */
async function grown(budget: number) {
	const kit = await oakKit();
	const asset = growPlantNow(kit, {
		seed: SEED,
		variant: 0,
		sparse: 1,
		budgets: [0, budget, budget],
	});
	const input = {
		record: kit.record,
		seed: SEED,
		variant: 0,
		season: 'summer',
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		detail: 'low',
	} as unknown as MeshInput;
	return { kit, asset, input };
}

describe('a level triangle budget', () => {
	it('keeps the form when no level asks for a budget', async () => {
		const kit = await oakKit();
		const plain = growPlantNow(kit, { seed: SEED, variant: 0, sparse: 1 });
		const zero = growPlantNow(kit, {
			seed: SEED,
			variant: 0,
			sparse: 1,
			budgets: [0, 0, 0],
		});
		expect(zero.stats.triangles).toEqual(plain.stats.triangles);
		expect(zero.stats.bytes).toBe(plain.stats.bytes);
	});

	it('fits each card level inside its target', async () => {
		for (const budget of [30, 100, 300]) {
			const { asset } = await grown(budget);
			expect(asset.levels[1]?.triangles).toBeLessThanOrEqual(budget);
			expect(asset.levels[2]?.triangles).toBeLessThanOrEqual(budget);
		}
	});

	it('thins the cards below the form and grows them to hold the crown', async () => {
		const { asset, input } = await grown(300);
		const form = growPlantNow(await oakKit(), { seed: SEED, variant: 0, sparse: 1 });
		for (const level of [1, 2] as const) {
			let own = 0;
			for (let r = 0; r < asset.shoots.count; r++)
				if (cardKeep(asset.shoots.order[r] as number, level) > 0) own++;
			const perRow = cardRowTriangles(input, 0);
			const triangles = (asset.levels[level]?.parts ?? [])
				.filter((part) => part.name === 'cards')
				.reduce((sum, part) => sum + part.arrays.indices.length / 3, 0);
			const kept = Math.round(triangles / perRow);
			expect(kept).toBeLessThan(own);
			const plan = cardPlan(input, level, triangles);
			expect(plan.grow).toBeCloseTo((level === 2 ? Math.SQRT2 : 1) * Math.sqrt(own / plan.kept), 6);
			// The kept rows spread through the space-filling order, so their cards do not gather in
			// one part of the crown.
			const span = Math.max(...plan.orders) - Math.min(...plan.orders);
			expect(span).toBeGreaterThan(own * 0.5);
			const formCards = (form.levels[level]?.parts ?? [])
				.filter((part) => part.name === 'cards')
				.reduce((sum, part) => sum + part.arrays.indices.length / 3, 0);
			expect(triangles).toBeLessThan(formCards);
		}
	});

	it('splits the outline between the cards and the wood, which add to one', async () => {
		const { input } = await grown(300);
		const shares = partShares(input);
		expect(shares.cards + shares.wood).toBeCloseTo(1, 6);
		expect(shares.cards).toBeGreaterThan(shares.wood);
		expect(shares.wood).toBeGreaterThan(0.02);
	});

	it('keys its own asset, and refuses a budget that is not a count', async () => {
		const kit = await oakKit();
		const a = variantKey(kit, { seed: SEED, variant: 0, sparse: 1, budgets: [0, 300, 300] });
		const b = variantKey(kit, { seed: SEED, variant: 0, sparse: 1, budgets: [0, 100, 100] });
		expect(a).not.toBe(b);
		expect(variantKey(kit, { seed: SEED, variant: 0, sparse: 1 })).not.toBe(a);
		expect(
			variantKey(kit, {
				seed: SEED,
				variant: 0,
				sparse: 1,
				budgets: [0, 300, 300],
				extrasShare: 1,
			}),
		).not.toBe(a);
		expect(() => checkBudgets([0, -1, 300])).toThrow(/not a count/);
		expect(() => checkBudgets([0, Number.NaN, 300])).toThrow(/not a count/);
		expect(() => checkBudgets([0, 30, 300])).not.toThrow();
		expect(() => checkExtrasShare(1.2)).toThrow(/not a share/);
		expect(() => checkExtrasShare(-0.1)).toThrow(/not a share/);
		expect(() => checkExtrasShare(Number.NaN)).toThrow(/not a share/);
		expect(() => checkExtrasShare(1)).not.toThrow();
		expect(() => checkExtrasShare(undefined)).not.toThrow();
	});

	it('draws a species extras when the page gives them a share that holds them', async () => {
		const module = await loadSpecies('silver-birch');
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		const extrasOf = (asset: ReturnType<typeof growPlantNow>) =>
			(asset.levels[1]?.parts ?? [])
				.filter((part) => part.name === 'extras')
				.reduce((sum, part) => sum + part.arrays.indices.length / 3, 0);
		const dropped = growPlantNow(kit, {
			seed: SEED,
			variant: 0,
			sparse: 1,
			budgets: [0, 2000, 2000],
		});
		const kept = growPlantNow(kit, {
			seed: SEED,
			variant: 0,
			sparse: 1,
			budgets: [0, 2000, 2000],
			extrasShare: 1,
		});
		expect(extrasOf(dropped)).toBe(0);
		expect(extrasOf(kept)).toBeGreaterThan(0);
		expect(kept.levels[1]?.triangles).toBeLessThanOrEqual(2000);
	});
});
