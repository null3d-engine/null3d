// The per-level allocation shares a level's maximum across its parts by each part's visible share,
// so a part that carries more of the plant's outline gets more triangles than one that spends many
// at the plant's best look. A level whose parts already fit keeps them as they are, and the parts
// add to no more than the maximum.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PartTriangles, SpeciesKitData } from '../asset';
import { loadSpecies } from '../core/registry';
import { lightCrown } from '../crown/visibility';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { GREAT_LIMB_SHARE, woodParts } from '../grow/sparse';
import {
	allocateLevel,
	type BudgetInput,
	levelBuild,
	levelWithin,
	partTotal,
	referenceTriangles,
	visibleShares,
} from './budget';

/** A species grows once and serves every test in the file; a busy machine takes tens of seconds. */
const LONG = scaledBudget(120_000);

/** The parts of a level. */
const PARTS = ['trunk', 'limbs', 'branches', 'twigs', 'leaves', 'extras'] as const;

/** A plant at its best look, whose parts do not fit the maxima these tests try. */
const REFERENCE: PartTriangles = {
	trunk: 400,
	limbs: 300,
	branches: 200,
	twigs: 100,
	leaves: 900,
	extras: 100,
};

/** The visible shares of that plant: the leaves carry most of its outline. */
const SHARES: PartTriangles = {
	trunk: 0.02,
	limbs: 0.03,
	branches: 0.05,
	twigs: 0.05,
	leaves: 0.8,
	extras: 0.05,
};

/** The oak's kit, built once. */
let kitPromise: Promise<SpeciesKitData> | undefined;

function oakKit(): Promise<SpeciesKitData> {
	if (!kitPromise)
		kitPromise = (async () => {
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			return buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		})();
	return kitPromise;
}

/** The oak as the budget reads it, grown once. */
let inputPromise: Promise<BudgetInput> | undefined;

function oakInput(): Promise<BudgetInput> {
	if (!inputPromise)
		inputPromise = (async () => {
			const kit = await oakKit();
			const asset = growPlantNow(kit, { seed: 11, variant: 0, sparse: 0.5 });
			const dress = {
				record: kit.record,
				seed: 11,
				variant: 0,
				season: asset.season,
				kit,
				skeleton: asset.skeleton,
				coarseness: asset.coarseness,
			};
			const rows = {
				...asset.shoots,
				sky: asset.shoots.sky.slice(),
				bent: asset.shoots.bent.slice(),
			};
			const mesh = { ...dress, rows, crown: lightCrown(dress, rows), detail: kit.detail };
			const parts = woodParts(asset.skeleton, kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE);
			return { mesh, parts, wood: true };
		})();
	return inputPromise;
}

describe('a level allocation', () => {
	it('gives a part with a larger visible share more triangles', () => {
		const allowed = allocateLevel(1_000, REFERENCE, SHARES);
		expect(allowed.leaves).toBeGreaterThan(allowed.branches);
		expect(allowed.branches).toBeGreaterThan(allowed.limbs);
		expect(allowed.limbs).toBeGreaterThan(allowed.trunk);
	});

	it('keeps the parts within the maximum', () => {
		for (const max of [1, 7, 30, 500, 1_000, 1_999]) {
			const allowed = allocateLevel(max, REFERENCE, SHARES);
			expect([max, partTotal(allowed) <= max]).toEqual([max, true]);
			for (const part of PARTS) expect([max, part, allowed[part] >= 0]).toEqual([max, part, true]);
		}
	});

	it('leaves a plant whose parts all fit unchanged', () => {
		const total = partTotal(REFERENCE);
		expect(allocateLevel(total, REFERENCE, SHARES)).toEqual(REFERENCE);
		expect(allocateLevel(total * 1_000, REFERENCE, SHARES)).toEqual(REFERENCE);
	});

	it(
		'shares a planned oak by its outline, and records where the outline outweighs its triangles',
		async () => {
			const input = await oakInput();
			const reference = referenceTriangles(input);
			const shares = visibleShares(input, reference);
			const whole = partTotal(reference);
			// The planned oak's sparse crown shows more of its wood and less of its shoots in the
			// outline than its best look spends on them: the outline reads 0.1016 wood and 0.7716
			// shoots against the triangles' 0.0709 and 0.8022. The rule divides a capped level by the
			// outline, so the wood takes the larger part here. The frame oak had the opposite relation,
			// since its leaves dominated its outline; the old strict inequality stated that plant's
			// shape, not the rule, and pinning it of the planned oak would test another plant.
			expect(partTotal(shares)).toBeCloseTo(1, 6);
			expect(shares.trunk).toBeCloseTo(0.033, 3);
			expect(shares.limbs).toBeCloseTo(0.031, 3);
			expect(shares.branches).toBeCloseTo(0.038, 3);
			expect(shares.twigs).toBeCloseTo(0.192, 3);
			expect(shares.leaves).toBeCloseTo(0.58, 3);
			expect(shares.extras).toBeCloseTo(0.127, 3);
			expect(shares.trunk + shares.limbs + shares.branches).toBeCloseTo(0.1016, 3);
			expect((reference.trunk + reference.limbs + reference.branches) / whole).toBeCloseTo(
				0.0709,
				3,
			);
			// The allocation divides the room the crown does not take by these weights, so each part's
			// own allowance is its outline share of that room, within the one triangle a floor loses.
			const max = 50_000;
			const allowed = allocateLevel(max, reference, shares);
			const rest =
				allowed.trunk + allowed.limbs + allowed.branches + allowed.twigs + allowed.extras;
			const wholeRest =
				shares.trunk + shares.limbs + shares.branches + shares.twigs + shares.extras;
			expect(allowed.leaves).toBe(max - rest);
			for (const part of ['trunk', 'limbs', 'branches', 'twigs', 'extras'] as const)
				expect([part, Math.abs(allowed[part] - (rest * shares[part]) / wholeRest) <= 1]).toEqual([
					part,
					true,
				]);
		},
		LONG,
	);

	it(
		'holds every part of a capped oak within its allowance',
		async () => {
			const kit = await oakKit();
			const max = 2_000;
			const plant = growPlantNow(kit, { seed: 11, variant: 0, sparse: 0.5, maxTriangles: max });
			const allowed = plant.stats.allowed;
			expect(allowed).toBeDefined();
			for (const level of [0, 1, 2] as const) {
				const parts = plant.stats.parts[level];
				expect([level, partTotal(parts) <= max]).toEqual([level, true]);
				for (const part of PARTS)
					expect([level, part, parts[part] <= (allowed?.[level][part] ?? 0)]).toEqual([
						level,
						part,
						true,
					]);
			}
		},
		LONG,
	);

	it(
		'draws a level as it stands when every part fits under the maximum',
		async () => {
			const input = await oakInput();
			const reference = referenceTriangles(input);
			const plain = levelBuild(input, 1);
			const within = levelWithin(input, 1, partTotal(reference) * 1_000, reference);
			expect(within.triangles).toEqual(plain.triangles);
		},
		LONG,
	);
});
