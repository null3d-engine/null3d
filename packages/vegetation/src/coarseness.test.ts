// Coarseness on the self-organizing grower's oak with the leaf package's oak shoots: the same bytes
// at every setting, the silhouette within 0.05 of the plant as grown at eight angles, triangles and
// bytes that fall at every step, a triangle target met within 10 per cent, and the plant as grown
// and every stand-in unchanged.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { type MeshArrays, plantAssetDigest, type ShootRows, type SpeciesKitData } from './asset';
import { checkCoarseness, coarsenessFor, nearTriangles, shootTriangles } from './coarseness';
import { speciesBox } from './core/box';
import { type MacroSkeleton, skeletonBuffers } from './core/graph';
import { hashBytes, unitAt } from './core/hash';
import type { Species } from './core/record';
import { standInSpecies } from './core/stand-in';
import { DETAILS, type Detail, spreadAt } from './core/types';
import { buildKitNow, growPlantNow, loadPlantCode, variantKey } from './generate';
import { coarsenSkeleton } from './grow/coarsen';
import {
	envelopeSilhouette,
	envelopeVolume,
	plantSilhouette,
	silhouetteFrame,
	silhouetteIoU,
} from './grow/envelope';
import { oakRecord as grownOak } from './grow/oak.fixture';
import { growSelfOrganizing } from './grow/self-organizing';
import { placeShoots } from './leaf/instancer';
import { builder } from './leaf/leaf-mesh';
import { oakRecord as leafOak, OAK_MANIFEST } from './leaf/oak.test-support';
import { shootPrototypes } from './leaf/shoot';
import { bakeCards } from './lod/card-bake';
import { cardMesh } from './lod/cards';
import { quantiseParts, TEXTURE_UV_STEPS, WOOD_UV_STEPS } from './lod/quantise';
import type { DressInput, MeshInput, MeshLevel } from './stages';
import { woodTriangles } from './wood/estimate';
import { cappedAxes, meshWood } from './wood/wood-mesh';
import { testRecord } from './wood/wood-test-tree';

const DETAIL: Detail = 'high';
const SEED = 11;

/** G1's oak with L1's oak shoots and leaves and W1's test bark. */
const record: Species = {
	...grownOak,
	shoots: leafOak().shoots,
	foliage: leafOak().foliage,
	bark: testRecord().bark,
	base: testRecord().base,
};

/** The oak's kit at the high tier: its leaves, its prototypes and their card cells. */
function oakKit(): SpeciesKitData {
	const leaves = DETAILS.map((tier) => builder.leaves(record, OAK_MANIFEST, tier));
	const uncarded = shootPrototypes(record, OAK_MANIFEST, leaves);
	const { atlas, cells } = bakeCards(record, OAK_MANIFEST, DETAIL, uncarded);
	return {
		record,
		manifest: OAK_MANIFEST,
		key: 'coarseness-test',
		detail: DETAIL,
		box: speciesBox(record),
		prototypes: uncarded.map((p, k) => ({ ...p, card: cells[k] ?? { planes: [] } })),
		leaves: leaves[DETAILS.indexOf(DETAIL)] ?? [],
		cards: atlas,
		header: new Float32Array(0),
		placeholders: false,
	};
}

const kit = oakKit();
const grown = [0, 1].map((variant) =>
	growSelfOrganizing({ record, seed: SEED, variant, season: 'summer' }),
);

/** The oak of a variant dressed at a coarseness: its pruned skeleton and its rows. */
function dressed(variant: number, coarseness: number): { input: DressInput; rows: ShootRows } {
	const input: DressInput = {
		record,
		seed: SEED,
		variant,
		season: 'summer',
		kit,
		skeleton: coarsenSkeleton(grown[variant] as MacroSkeleton, coarseness),
		coarseness,
	};
	return { input, rows: placeShoots(input) };
}

/** The meshing input, with an open crown: the sky only moves vertex bytes, never their count. */
function meshInput(input: DressInput, rows: ShootRows): MeshInput {
	const { min, max } = input.skeleton.bounds;
	return {
		...input,
		rows,
		crown: {
			cells: [1, 1, 1],
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail: DETAIL,
	};
}

/** A hash of typed arrays. */
function digest(views: readonly ArrayBufferView[]): number {
	let hash = 0;
	for (const v of views)
		hash = hashBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), hash);
	return hash;
}

const rowViews = (rows: ShootRows) => [
	rows.prototype,
	rows.position,
	rows.rotation,
	rows.scale,
	rows.record,
	rows.phase,
	rows.order,
];
const meshViews = (mesh: MeshArrays) => [
	mesh.positions,
	mesh.normals,
	mesh.uvs,
	mesh.uvs1,
	mesh.colors,
	mesh.indices,
];

/** Bytes of a mesh once quantised into its parts. */
function partBytes(mesh: MeshArrays, uvSteps: number): number {
	let bytes = 0;
	for (const part of quantiseParts(mesh, kit.box, uvSteps))
		for (const array of [
			part.positions,
			part.normals,
			part.uvs,
			part.uvs1,
			part.colors,
			part.indices,
		])
			bytes += array.byteLength;
	return bytes;
}

/** Bytes of a shoot row table. */
const rowBytes = (rows: ShootRows) => rowViews(rows).reduce((sum, v) => sum + v.byteLength, 0);

describe('coarseness on the oak', () => {
	it('grows the same bytes twice at every setting', () => {
		for (const c of [0.25, 0.5, 1]) {
			const a = dressed(0, c);
			const b = dressed(0, c);
			expect(digest(skeletonBuffers(b.input.skeleton).map((x) => new Uint8Array(x)))).toBe(
				digest(skeletonBuffers(a.input.skeleton).map((x) => new Uint8Array(x))),
			);
			expect(digest(rowViews(b.rows))).toBe(digest(rowViews(a.rows)));
		}
		const a = dressed(0, 0.5);
		const wood = digest(meshViews(meshWood(meshInput(a.input, a.rows), 1)));
		const again = dressed(0, 0.5);
		expect(digest(meshViews(meshWood(meshInput(again.input, again.rows), 1)))).toBe(wood);
	});

	it('changes nothing at 0: the skeleton, the rows and the wood are as grown', () => {
		const skeleton = grown[0] as MacroSkeleton;
		expect(coarsenSkeleton(skeleton, 0)).toBe(skeleton);
		const plain: DressInput = { record, seed: SEED, variant: 0, season: 'summer', kit, skeleton };
		const zero = { ...plain, coarseness: 0 };
		const rows = placeShoots(plain);
		expect(digest(rowViews(placeShoots(zero)))).toBe(digest(rowViews(rows)));
		expect(digest(meshViews(meshWood(meshInput(zero, rows), 1)))).toBe(
			digest(meshViews(meshWood(meshInput(plain, rows), 1))),
		);
	});

	it('keeps its silhouette in its envelope within 0.05 of the plant as grown, at eight angles', () => {
		const lengths = kit.prototypes.map((p) => p.length);
		for (const variant of [0, 1]) {
			const salt = record.seedSalt >>> 0;
			const height = spreadAt(record.size.height, unitAt(SEED, salt, variant, 1));
			const turn = unitAt(SEED, salt, variant, 2) * 2 * Math.PI;
			const volume = envelopeVolume(
				record.envelope as NonNullable<Species['envelope']>,
				height,
				turn,
			);
			const frame = silhouetteFrame(volume, height);
			const fit = (c: number) => {
				const { input, rows } = dressed(variant, c);
				return [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
					silhouetteIoU(
						plantSilhouette(input.skeleton, rows, lengths, (k * Math.PI) / 4, frame),
						envelopeSilhouette(
							volume,
							(k * Math.PI) / 4,
							frame,
							input.skeleton.radius[0] as number,
						),
					),
				);
			};
			const full = fit(0);
			for (const c of [0.5, 1])
				fit(c).forEach((iou, k) => {
					expect(iou).toBeGreaterThanOrEqual((full[k] as number) - 0.05);
				});
		}
	});

	it(
		'holds fewer triangles and bytes at every step, at every level',
		() => {
			let before: number[] | undefined;
			for (const c of [0, 0.25, 0.5, 0.75, 1]) {
				const { input, rows } = dressed(0, c);
				const mesh = meshInput(input, rows);
				const wood = ([0, 1, 2] as const).map((level: MeshLevel) => meshWood(mesh, level));
				const cards = ([1, 2] as const).map((level) => cardMesh(mesh, level));
				const [near, first, second] = wood as [MeshArrays, MeshArrays, MeshArrays];
				const [cards1, cards2] = cards as [MeshArrays, MeshArrays];
				const triangles = (m: MeshArrays) => m.indices.length / 3;
				// The quick count of the wood stands within 10 per cent of the mesher's.
				expect(Math.abs(woodTriangles(mesh, 0) / triangles(near) - 1)).toBeLessThan(0.1);
				const figures = [
					triangles(near) + shootTriangles(kit, rows, DETAIL),
					triangles(first) + triangles(cards1),
					triangles(second) + triangles(cards2),
					partBytes(near, WOOD_UV_STEPS) + rowBytes(rows),
					partBytes(first, WOOD_UV_STEPS) + partBytes(cards1, TEXTURE_UV_STEPS),
					partBytes(second, WOOD_UV_STEPS) + partBytes(cards2, TEXTURE_UV_STEPS),
				];
				if (before)
					figures.forEach((figure, k) => {
						expect(figure).toBeLessThan(before?.[k] as number);
					});
				before = figures;
			}
		},
		scaledBudget(30_000),
	);

	it('meets a triangle target within 10 per cent', () => {
		const skeleton = grown[0] as MacroSkeleton;
		const growth = { record, seed: SEED, variant: 0, season: 'summer' as const, skeleton };
		for (const target of [15_000_000, 6_000_000]) {
			const c = coarsenessFor(kit, growth, DETAIL, { triangles: target });
			expect(c).toBeGreaterThan(0);
			expect(c).toBeLessThan(1);
			expect(coarsenessFor(kit, growth, DETAIL, { triangles: target })).toBe(c);
			const { input, rows } = dressed(0, c);
			const near = meshWood(meshInput(input, rows), 0);
			const triangles = near.indices.length / 3 + shootTriangles(kit, rows, DETAIL);
			expect(Math.abs(triangles / target - 1)).toBeLessThan(0.1);
		}
		expect(coarsenessFor(kit, growth, DETAIL, { triangles: 1e9 })).toBe(0);
		expect(coarsenessFor(kit, growth, DETAIL, { triangles: 1000 })).toBe(1);
		expect(coarsenessFor({ ...kit, coarseness: 0.4 }, growth, DETAIL, {})).toBe(0.4);
	});
});

describe('the section sparsity', () => {
	const wood = (sections: number, level: MeshLevel) => {
		const { input, rows } = dressed(0, 0);
		const mesh = meshInput({ ...input, sections }, rows);
		return {
			mesh,
			triangles: meshWood(mesh, level).indices.length / 3,
			estimate: woodTriangles(mesh, level),
		};
	};

	it('thins every level as it rises, leaving the full form exact at zero', () => {
		for (const level of [0, 1, 2] as const) {
			const none = wood(0, level).triangles;
			const half = wood(0.5, level).triangles;
			const most = wood(1, level).triangles;
			expect(half).toBeLessThan(none);
			expect(most).toBeLessThan(half);
		}
		const { input, rows } = dressed(0, 0);
		const plain = meshInput(input, rows);
		const zero = meshInput({ ...input, sections: 0 }, rows);
		expect(digest(meshViews(meshWood(zero, 2)))).toBe(digest(meshViews(meshWood(plain, 2))));
	});

	it('draws the far level of the oak in a quarter of its triangles or fewer', () => {
		// The oak's far level keeps its stem and six great limbs, so its floor is their prisms.
		const full = wood(0, 2).triangles;
		const fewest = wood(1, 2).triangles;
		expect(fewest).toBeLessThan(full / 4);
		expect(fewest).toBeGreaterThan(20);
	});

	it('holds its quick count of the nearest level within ten per cent at the sparsest sections', () => {
		const one = wood(1, 0);
		expect(Math.abs(one.estimate / one.triangles - 1)).toBeLessThan(0.1);
	});

	it('caps a far level at three axes, and keeps the ones that carry the most crown', () => {
		const { input } = dressed(0, 0);
		const keep = record.lod.woodOrders[1] ?? 255;
		const dropped = cappedAxes(input.skeleton, keep, 2, 1);
		const axes = input.skeleton.axes;
		let keptCount = 0;
		for (let a = 0; a < axes.count; a++)
			if ((axes.order[a] as number) <= keep && dropped?.[a] !== 1) keptCount++;
		expect(keptCount).toBeLessThanOrEqual(3);
		// The sparsest level keeps fewer axes than the half level, and the full level keeps all.
		const half = cappedAxes(input.skeleton, keep, 2, 0.5);
		let halfCount = 0;
		for (let a = 0; a < axes.count; a++)
			if ((axes.order[a] as number) <= keep && half?.[a] !== 1) halfCount++;
		expect(halfCount).toBeGreaterThanOrEqual(keptCount);
		expect(cappedAxes(input.skeleton, keep, 2, 0)).toBeUndefined();
	});

	it('keys a variant by its sections, and the plant as grown as before', () => {
		const options = { seed: 1, variant: 0 };
		const key = variantKey(kit, options);
		expect(variantKey(kit, { ...options, sections: 0 })).toBe(key);
		expect(variantKey(kit, { ...options, sections: 0.25 })).not.toBe(key);
	});
});

describe('the coarseness options', () => {
	it('leave a stand-in as it is at every setting', async () => {
		const stub = standInSpecies('stub');
		await loadPlantCode(stub.record);
		const stubKit = buildKitNow(stub, { placeholders: true });
		const base = { seed: 7, variant: 0, near: true };
		const plain = growPlantNow(stubKit, base);
		for (const options of [{ coarseness: 0 }, { coarseness: 0.8 }, { triangles: 100 }]) {
			const asset = growPlantNow(stubKit, { ...base, ...options });
			expect(asset.coarseness).toBe(0);
			expect(plantAssetDigest(asset)).toBe(plantAssetDigest(plain));
			expect(nearTriangles(stubKit, asset)).toBe(nearTriangles(stubKit, plain));
		}
	});

	it('key a variant by its coarseness, and the plant as grown as before', () => {
		const options = { seed: 1, variant: 0 };
		const key = variantKey(kit, options);
		expect(variantKey(kit, { ...options, coarseness: 0 })).toBe(key);
		expect(variantKey(kit, { ...options, coarseness: 0.5 })).not.toBe(key);
		expect(variantKey(kit, { ...options, triangles: 1e6 })).not.toBe(key);
		expect(variantKey({ ...kit, coarseness: 0.5 }, options)).toBe(
			variantKey(kit, { ...options, coarseness: 0.5 }),
		);
	});

	it('refuse a coarseness outside 0 to 1, a target that is no count, and both at once', () => {
		expect(() => checkCoarseness({ coarseness: 1.5 })).toThrow(/outside 0 to 1/);
		expect(() => checkCoarseness({ coarseness: Number.NaN })).toThrow(/outside 0 to 1/);
		expect(() => checkCoarseness({ triangles: -5 })).toThrow(/positive number/);
		expect(() => checkCoarseness({ coarseness: 0.5, triangles: 1000 })).toThrow(/not both/);
		expect(checkCoarseness({ coarseness: 1 })).toEqual({ coarseness: 1 });
	});
});
