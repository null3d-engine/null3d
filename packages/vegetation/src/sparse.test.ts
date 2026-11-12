// The sparse form: one level moves the wood, the leaves and the coarseness together toward the
// floors a species records, and a page cannot reach past those floors with its own shares.
import { describe, expect, it } from 'bun:test';
import { speciesProblems } from './core/check';
import type { Species } from './core/record';
import { loadSpecies } from './core/registry';
import {
	buildKitNow,
	growPlantNow,
	LEAVES_LEAST,
	loadPlantCode,
	SPARSE_LEAST,
	sparseForDevice,
	withLeaves,
	withLimbs,
	withSparse,
} from './generate';
import { connectedBody } from './lod/connect';
import type { MeshInput } from './stages';

/** The oak's record with sparse floors, so the shares have somewhere to stop. */
async function floored(): Promise<Species> {
	const { record } = await loadSpecies('pedunculate-oak');
	return { ...record, sparse: { limbs: 0.3, leaves: 0.2, coarseness: 0.6 } };
}

describe('the sparse form', () => {
	it('leaves a record with no floors as it stands', async () => {
		const { record } = await loadSpecies('pedunculate-oak');
		const { sparse: _floors, ...bare } = record;
		const options = { seed: 11, variant: 0, sparse: 1 } as const;
		expect(withSparse(bare, options)).toBe(options);
	});

	it('leaves a level of zero as the record gives it', async () => {
		const record = await floored();
		const options = { seed: 11, variant: 0, sparse: 0, leaves: 0.8 } as const;
		expect(withSparse(record, options)).toBe(options);
	});

	it('moves the three shares to the floors at level one', async () => {
		const record = await floored();
		const grown = withSparse(record, { seed: 11, variant: 0, sparse: 1 });
		expect(grown.leaves).toBeCloseTo(0.2, 10);
		expect(grown.limbs).toBeCloseTo(0.3, 10);
		// The shared constant raises every species' coarseness floor above its own.
		expect(grown.coarseness).toBeCloseTo(0.85, 10);
	});

	it('moves the three shares halfway at level a half', async () => {
		const record = await floored();
		const grown = withSparse(record, { seed: 11, variant: 0, sparse: 0.5 });
		expect(grown.leaves).toBeCloseTo(0.6, 10);
		expect(grown.limbs).toBeCloseTo(0.65, 10);
		expect(grown.coarseness).toBeCloseTo(0.425, 10);
	});

	it('keeps a coarseness the page has already set above the level', async () => {
		const record = await floored();
		const grown = withSparse(record, { seed: 11, variant: 0, sparse: 0.25, coarseness: 0.9 });
		expect(grown.coarseness).toBeCloseTo(0.9, 10);
	});

	it('refuses a level above one', async () => {
		const record = await floored();
		expect(() => withSparse(record, { seed: 11, variant: 0, sparse: 1.5 })).toThrow(
			/sparse is 1.5/,
		);
	});

	it('takes the sparse shares below the bound a page may ask for', async () => {
		const record = await floored();
		expect(() => withLeaves(record, 0.2)).toThrow();
		expect(() => withLimbs(record, 0.3)).toThrow();
		expect(() => withLeaves(record, 0.2, SPARSE_LEAST)).not.toThrow();
		expect(() => withLimbs(record, 0.3, SPARSE_LEAST)).not.toThrow();
		expect(LEAVES_LEAST).toBeGreaterThan(SPARSE_LEAST);
	});

	it("moves the section sparsity to the floor at level one, and keeps a page's own above it", async () => {
		const record = await floored();
		const floor = record.sparse as NonNullable<Species['sparse']>;
		const withSections: Species = { ...record, sparse: { ...floor, sections: 0.7 } };
		expect(withSparse(withSections, { seed: 11, variant: 0, sparse: 1 }).sections).toBeCloseTo(
			0.7,
			10,
		);
		expect(withSparse(withSections, { seed: 11, variant: 0, sparse: 0.5 }).sections).toBeCloseTo(
			0.35,
			10,
		);
		expect(
			withSparse(withSections, { seed: 11, variant: 0, sparse: 1, sections: 0.9 }).sections,
		).toBeCloseTo(0.9, 10);
		// A record with no section floor keeps the sections its coarseness gives.
		expect(withSparse(record, { seed: 11, variant: 0, sparse: 1 }).sections).toBe(0);
	});

	it('refuses a section sparsity outside 0 to 1', async () => {
		const record = await floored();
		expect(() => withSparse(record, { seed: 11, variant: 0, sections: 1.2 })).toThrow(
			/sections is 1.2/,
		);
		const floor = record.sparse as NonNullable<Species['sparse']>;
		expect(speciesProblems({ ...record, sparse: { ...floor, sections: 1.2 } })).toContain(
			'sparse.sections is 1.2; a share lies from 0 to 1',
		);
	});

	it('gives phones and tablets the light form and desktops the record', () => {
		expect(sparseForDevice('phone')).toBe(1);
		expect(sparseForDevice('tablet')).toBe(1);
		expect(sparseForDevice('desktop')).toBe(0);
	});

	it('rejects floors outside their ranges', async () => {
		const record = await floored();
		const problems = speciesProblems({
			...record,
			sparse: { limbs: 0.02, leaves: 1.2, coarseness: 1.5 },
		});
		expect(problems.join('\n')).toMatch(/sparse\.limbs is 0\.02/);
		expect(problems.join('\n')).toMatch(/sparse\.leaves is 1\.2/);
		expect(problems.join('\n')).toMatch(/sparse\.coarseness is 1\.5/);
	});

	it('accepts floors inside their ranges', async () => {
		const record = await floored();
		expect(speciesProblems(record)).toEqual([]);
	});
});

describe('a sparse form is one connected body', () => {
	it('keeps one component that reaches the root at every level and sparse setting', async () => {
		const module = await loadSpecies('pedunculate-oak');
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
		for (const sparse of [0, 0.25, 0.5, 0.75, 1]) {
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: false, sparse });
			const { min, max } = asset.skeleton.bounds;
			const crown = {
				cells: [1, 1, 1] as const,
				min,
				cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
				sky: new Float32Array([1]),
			};
			const input = {
				skeleton: asset.skeleton,
				record: kit.record,
				detail: 'high' as const,
				coarseness: asset.coarseness,
				rows: asset.shoots,
				crown,
				seed: 11,
				variant: 0,
				season: asset.season,
				kit,
			} as unknown as MeshInput;
			for (const level of [0, 1, 2] as const) {
				const body = connectedBody(input, level);
				expect([sparse, level, body.components]).toEqual([sparse, level, 1]);
				expect([sparse, level, body.reachesRoot]).toEqual([sparse, level, true]);
				// The card levels keep cards, all joined: a level that drops them all would pass
				// the count for the wrong reason.
				if (level > 0) expect([sparse, level, body.cards > 0]).toEqual([sparse, level, true]);
			}
		}
	});
});
