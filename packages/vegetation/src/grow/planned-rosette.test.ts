// The planned model's rosette, read on the one species that grows it: one socket a frond at the
// growing point, whole fronds under sparseness and a cap, and a crown whose box is the fronds' own
// reach. The tree fern's record is the fixture; its pictures are judged by a review round.

import { describe, expect, it } from 'bun:test';
import { files } from '@null3d/vegetation-textures/tree-fern';
import { speciesProblems } from '../core/check';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { planned } from '../species/tree-fern/planned-record';
import type { GrowRequest } from '../stages';
import { growPlanned, planTree } from './planned';

/** Grows the tree fern at a state, with the plan the generator would hand it. */
function grow(request: GrowRequest, seed = 11, variant = 0) {
	const plan = planTree(planned, request);
	const plant = growPlanned({ record: planned, seed, variant, season: 'summer', request, plan });
	return { plan, plant };
}

/** The sockets' places, which name the same frond across states. */
function places(plant: ReturnType<typeof growPlanned>): number[] {
	const origin = plant.buds.origin;
	return Array.from({ length: plant.buds.count }, (_, b) => origin?.[b] ?? b).sort((a, b) => a - b);
}

describe('the planned rosette', () => {
	it('passes every record rule', () => {
		expect(speciesProblems(planned)).toEqual([]);
	});

	it('lays one socket a frond from one point, with every rank’s piece', () => {
		const { plant } = grow({ maturity: 1, sparse: 0 });
		// Three dozen living fronds and about sixteen dead ones, drawn within their spreads.
		expect(plant.buds.count).toBeGreaterThan(40);
		expect(plant.buds.count).toBeLessThan(56);
		const piece = plant.buds.sockets?.piece;
		expect(piece).toBeDefined();
		expect(new Set(Array.from(piece ?? [])).size).toBe(3);
		// A bud a frond at the growing point: its piece reaches above the trunk and no tip falls
		// under the ground.
		expect(plant.height).toBeGreaterThan(4);
		expect(plant.crownBase).toBeGreaterThan(0);
	});

	it('takes its crown box from the fronds, not from the trunk', () => {
		const { plant } = grow({ maturity: 1, sparse: 0 });
		// The box is the still's crown box: about one height wide, its base the skirt's lowest tip.
		const width = plant.bounds.max[0] - plant.bounds.min[0];
		expect(width / plant.height).toBeGreaterThan(0.98);
		expect(width / plant.height).toBeLessThan(1.02);
		expect(plant.crownBase / plant.height).toBeGreaterThan(0.29);
		expect(plant.crownBase / plant.height).toBeLessThan(0.34);
		expect(plant.height).toBeGreaterThan(plant.bounds.max[1] - 1e-6);
	});

	it('keeps whole fronds under sparseness, and each sparser plant is a subset', () => {
		const full = grow({ maturity: 1, sparse: 0 }).plant;
		const sparse = grow({ maturity: 1, sparse: 1 }).plant;
		expect(sparse.buds.count).toBeLessThan(full.buds.count);
		// The specification's sparsest fern keeps about four tenths of its fronds.
		expect(sparse.buds.count / full.buds.count).toBeGreaterThan(0.3);
		expect(sparse.buds.count / full.buds.count).toBeLessThan(0.5);
		const kept = new Set(places(sparse));
		for (const place of kept) expect(places(full)).toContain(place);
	});

	it('keeps the plant’s shape at the 400-triangle cap', () => {
		const full = grow({ maturity: 1, sparse: 0 }).plant;
		const capped = grow({ maturity: 1, sparse: 0, maxTriangles: 400 });
		expect(capped.plan.rankCut[4]).toBeLessThan(1);
		expect(capped.plan.expected[4]).toBeGreaterThan(0);
		expect(capped.plant.buds.count).toBeLessThan(full.buds.count);
		expect(capped.plant.buds.count).toBeGreaterThan(0);
		// The cap pays a card a frond and leaves the trunk; it never collapses the crown or drops the
		// growing point to the ground.
		expect(capped.plant.height / full.height).toBeGreaterThan(0.9);
		expect(capped.plant.crownBase).toBeGreaterThan(0);
		expect(capped.plan.triangles.fruit).toBe(0);
	});

	it('drops the dead skirt before a living frond at a cap', () => {
		const deadPiece = (planned.pieces ?? []).findIndex((piece) => piece.name === 'frond-dead');
		const counts = (plant: ReturnType<typeof growPlanned>) => {
			const piece = plant.buds.sockets?.piece ?? [];
			let dead = 0;
			for (const one of piece) if (one === deadPiece) dead++;
			return { living: piece.length - dead, dead };
		};
		const full = counts(grow({ maturity: 1, sparse: 0 }).plant);
		const capped = counts(grow({ maturity: 1, sparse: 0, maxTriangles: 400 }).plant);
		// The living fountain stays whole; the skirt is the first thing the cap gives up.
		expect(capped.living).toBe(full.living);
		expect(capped.dead).toBeLessThan(full.dead);
	});

	it('draws a first card level denser than the directed fern and inside its budget', async () => {
		await loadPlantCode(planned);
		const kit = buildKitNow(
			{ record: planned, textures: files },
			{ placeholders: 'missing', detail: 'high' },
		);
		const card = growPlantNow(kit, { seed: 11, variant: 0, near: false, detail: 'high' });
		// The directed fern's measured first card level is 2,136 triangles at the high tier. The
		// planned shell must not be thinner, and the record's own budgets hold it and the near form.
		expect(card.levels[1].triangles).toBeGreaterThanOrEqual(2_136);
		expect(card.levels[1].triangles).toBeLessThanOrEqual(15_000);
		const near = growPlantNow(kit, { seed: 11, variant: 0, near: true, detail: 'high' });
		expect(near.levels[0].triangles).toBeLessThanOrEqual(90_000);
	});

	it('grows a young plant as a rosette above the ground', () => {
		const adult = grow({ maturity: 1, sparse: 0 }).plant;
		const young = grow({ maturity: 0.1, sparse: 0 }).plant;
		expect(young.height).toBeLessThan(adult.height);
		expect(young.crownBase).toBeGreaterThan(0);
		expect(young.buds.count).toBeGreaterThan(0);
		expect(young.buds.count).toBeLessThan(adult.buds.count);
	});
});
