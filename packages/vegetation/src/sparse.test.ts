// Sparseness takes foliage and the branches that carried it out of one grown plant. These tests
// state its contracts over trees, a shrub, ground plants and a cactus: a sparser plant is a subset
// of every denser one, it is one body joined to its root, its counts fall, its height and trunk
// hold, the removal is even round the crown and through its height, and a change of sparseness cuts
// the plant that is kept as grown and grows nothing again.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from './asset';
import { speciesProblems } from './core/check';
import { loadSpecies } from './core/registry';
import {
	buildKitNow,
	forgetGrownPlants,
	growPlantNow,
	loadPlantCode,
	plantsGrown,
	sparseForDevice,
	variantKey,
} from './generate';
import { cardTop } from './grow/height';
import { FOLIAGE_FLOOR, GREAT_LIMB_SHARE, structuralAxes } from './grow/sparse';
import { cardKeep } from './lod/cards';
import { connectedBody } from './lod/connect';
import type { MeshInput } from './stages';

/** A species grows, meshes and thins at five values; a busy machine takes tens of seconds. */
const LONG = scaledBudget(180_000);

/** The species the contracts are stated over: three trees, a shrub, two ground plants, a cactus. */
const SPECIES = [
	'pedunculate-oak',
	'scots-pine',
	'silver-birch',
	'hawthorn-shrub',
	'sedge',
	'hosta',
	'saguaro',
] as const;

/** The sparseness values each plant is cut at, rising. */
const LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

/** The seeds each species grows from. */
const SEEDS = [11, 2027] as const;

/**
 * How far an octant's kept share may stand from the whole plant's, as a share of the octant's own
 * foliage. The largest measured over twelve species, four seeds and six sparseness values is 0.087,
 * in a sedge's octant of 116 leaves; no tree's octant passes 0.031.
 */
const OCTANT_SLACK = 0.12;

/** The fewest carriers an octant holds before its share is judged; a smaller octant is noise. */
const OCTANT_LEAST = 40;

const kits = new Map<string, SpeciesKitData>();

/** A species' kit at the low tier, built once. */
async function kitOf(id: (typeof SPECIES)[number]): Promise<SpeciesKitData> {
	let kit = kits.get(id);
	if (!kit) {
		const module = await loadSpecies(id);
		await loadPlantCode(module.record);
		kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		kits.set(id, kit);
	}
	return kit;
}

/** One plant at every sparseness value. */
function levelsOf(kit: SpeciesKitData, seed: number): PlantAsset[] {
	return LEVELS.map((sparse) => growPlantNow(kit, { seed, variant: 0, near: true, sparse }));
}

/** The meshing input of a grown variant, with an open crown: the light moves no vertex. */
function meshInput(kit: SpeciesKitData, asset: PlantAsset): MeshInput {
	const { min, max } = asset.skeleton.bounds;
	return {
		record: kit.record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		crown: {
			cells: [1, 1, 1] as const,
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail: 'low' as const,
	};
}

/** A key of some numbers of a typed array, exact to the bit. */
function keyOf(...parts: readonly ArrayLike<number>[]): string {
	return parts.map((part) => Array.from(part).join(',')).join('|');
}

/** Each row's place, turn, scale and prototype, by its index in the plant as grown. */
function rowKeys(asset: PlantAsset): Map<number, string> {
	const rows = asset.shoots;
	const out = new Map<number, string>();
	for (let r = 0; r < rows.count; r++)
		out.set(
			rows.id?.[r] ?? r,
			keyOf(
				rows.position.subarray(r * 3, r * 3 + 3),
				rows.rotation.subarray(r * 4, r * 4 + 4),
				rows.scale.subarray(r, r + 1),
				rows.prototype.subarray(r, r + 1),
			),
		);
	return out;
}

/** Each axis's nodes and radii, its kind and its order, by its index in the plant as grown. */
function axisKeys(asset: PlantAsset): Map<number, string> {
	const { axes, position, radius } = asset.skeleton;
	const out = new Map<number, string>();
	for (let a = 0; a < axes.count; a++) {
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		out.set(
			axes.origin?.[a] ?? a,
			keyOf(position.subarray(first * 3, last * 3 + 3), radius.subarray(first, last + 1), [
				axes.kind[a] as number,
				axes.order[a] as number,
				axes.parentT[a] as number,
			]),
		);
	}
	return out;
}

/** The triangles of a level's parts of one name. */
function trianglesOf(asset: PlantAsset, level: 0 | 1 | 2, name: string): number {
	let triangles = 0;
	for (const part of asset.levels[level].parts)
		if (part.name === name) triangles += part.arrays.indices.length / 3;
	return triangles;
}

/** The vertices of a level's parts of one name, each as one number of its three box steps. */
function vertexSet(asset: PlantAsset, level: 0 | 1 | 2, name: string): Set<number> {
	const out = new Set<number>();
	for (const part of asset.levels[level].parts) {
		if (part.name !== name) continue;
		const p = part.arrays.positions;
		for (let i = 0; i < p.length; i += 3)
			out.add((p[i] as number) + (p[i + 1] as number) * 65536 + (p[i + 2] as number) * 4294967296);
	}
	return out;
}

/** Where each foliage carrier of a plant stands: its shoot rows, or its end axes' tips. */
function carriers(asset: PlantAsset): Map<number, readonly [number, number, number]> {
	const out = new Map<number, readonly [number, number, number]>();
	const rows = asset.shoots;
	if (rows.count > 0) {
		for (let r = 0; r < rows.count; r++)
			out.set(rows.id?.[r] ?? r, [
				rows.position[r * 3] as number,
				rows.position[r * 3 + 1] as number,
				rows.position[r * 3 + 2] as number,
			]);
		return out;
	}
	const { axes, position } = asset.skeleton;
	const parents = new Set<number>();
	for (let a = 0; a < axes.count; a++) parents.add(axes.parent[a] as number);
	for (let a = 0; a < axes.count; a++) {
		if (parents.has(a) || (axes.parent[a] as number) < 0) continue;
		const tip = axes.last[a] as number;
		out.set(axes.origin?.[a] ?? a, [
			position[tip * 3] as number,
			position[tip * 3 + 1] as number,
			position[tip * 3 + 2] as number,
		]);
	}
	return out;
}

/** The highest point a plant draws: its top node, or the top of its highest shoot's cards. */
function drawnTop(kit: SpeciesKitData, asset: PlantAsset): number {
	let top = Number.NEGATIVE_INFINITY;
	const { position, nodeCount } = asset.skeleton;
	for (let n = 0; n < nodeCount; n++) top = Math.max(top, position[n * 3 + 1] as number);
	return Math.max(top, cardTop(kit, asset.shoots, kit.record.lod.cardGrow ?? 1));
}

for (const id of SPECIES) {
	describe(`sparseness on the ${id}`, () => {
		it(
			'cuts each sparser plant out of every denser one, joined, lighter and as tall',
			async () => {
				const kit = await kitOf(id);
				for (const seed of SEEDS) {
					const plants = levelsOf(kit, seed);
					const full = plants[0] as PlantAsset;
					const fullCarriers = carriers(full);
					const fullInput = meshInput(kit, full);
					const fullExtras = vertexSet(full, 0, 'extras');
					// The stems and great limbs, which every sparseness keeps whole.
					const great = structuralAxes(full.skeleton, kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE);
					const fullAxes = axisKeys(full);
					const fullRows = rowKeys(full);
					let before = full;
					for (let k = 1; k < plants.length; k++) {
						const plant = plants[k] as PlantAsset;
						const at = `${id} seed ${seed} sparse ${LEVELS[k]}`;
						// A subset: each row and each axis is one the denser plant holds, to the bit, so
						// nothing moved and no leaf was scaled.
						const denserRows = rowKeys(before);
						const rows = rowKeys(plant);
						for (const [row, key] of rows)
							expect([at, row, denserRows.get(row)]).toEqual([at, row, key]);
						const denserAxes = axisKeys(before);
						const axes = axisKeys(plant);
						for (const [axis, key] of axes)
							expect([at, axis, denserAxes.get(axis)]).toEqual([at, axis, key]);
						// It falls: fewer carriers, no more axes, no more wood, cards or extras.
						expect([at, carriers(plant).size < carriers(before).size]).toEqual([at, true]);
						expect([at, axes.size <= denserAxes.size]).toEqual([at, true]);
						// A card level may draw more wood for a sparser plant, since it draws the branch
						// under each card that no longer touches another, so wood is counted where every
						// axis draws.
						for (const level of [0, 1, 2] as const)
							for (const name of ['wood', 'cards', 'foliage', 'extras']) {
								if (name === 'wood' && level > 0) continue;
								expect([
									at,
									level,
									name,
									trianglesOf(plant, level, name) <= trianglesOf(before, level, name),
								]).toEqual([at, level, name, true]);
							}
						// The extras that stay hang where the plant as grown hung them.
						for (const vertex of vertexSet(plant, 0, 'extras'))
							expect([at, fullExtras.has(vertex)]).toEqual([at, true]);
						// One body: every axis leaves an axis the plant holds, every row stands on a node
						// it holds, and each level counts the roots the plant as grown counts.
						const skeleton = plant.skeleton;
						for (let a = 0; a < skeleton.axes.count; a++) {
							const parent = skeleton.axes.parent[a] as number;
							const origin = skeleton.axes.origin?.[a] ?? a;
							const grownParent = full.skeleton.axes.parent[origin] as number;
							expect([at, a, parent < a, parent < 0]).toEqual([at, a, true, grownParent < 0]);
							if (parent >= 0)
								expect([at, a, skeleton.axisOf[skeleton.axes.parentNode[a] as number]]).toEqual([
									at,
									a,
									parent,
								]);
						}
						for (let r = 0; r < plant.shoots.count; r++)
							expect([at, r, (plant.shoots.node?.[r] ?? -1) < skeleton.nodeCount]).toEqual([
								at,
								r,
								true,
							]);
						// Every level shows this same plant: a card level draws each card its share of
						// the rows keeps, none dropped for want of a branch.
						const input = meshInput(kit, plant);
						for (const level of [0, 1, 2] as const) {
							const body = connectedBody(input, level);
							const grown = connectedBody(fullInput, level);
							expect([at, level, body.components, body.reachesRoot]).toEqual([
								at,
								level,
								grown.components,
								grown.reachesRoot,
							]);
							if (level === 0) continue;
							let share = 0;
							for (let r = 0; r < plant.shoots.count; r++)
								if (cardKeep(plant.shoots.order[r] as number, level) > 0) share++;
							expect([at, level, body.cards]).toEqual([at, level, share]);
						}
						// As tall, on the same trunk and great limbs, in the same frame.
						expect([at, skeleton.height, skeleton.crownBase]).toEqual([
							at,
							full.skeleton.height,
							full.skeleton.crownBase,
						]);
						expect([at, skeleton.bounds]).toEqual([at, full.skeleton.bounds]);
						expect([at, drawnTop(kit, plant)]).toEqual([at, drawnTop(kit, full)]);
						for (let a = 0; a < great.length; a++)
							if (great[a]) expect([at, a, axes.get(a)]).toEqual([at, a, fullAxes.get(a)]);
						// Even round the crown and through its height: each octant about the middle of the
						// grown plant's foliage keeps the whole plant's share of its own.
						const kept = carriers(plant);
						const share = kept.size / fullCarriers.size;
						const middle: [number, number, number] = [0, 0, 0];
						for (const place of fullCarriers.values()) {
							middle[0] += place[0] / fullCarriers.size;
							middle[1] += place[1] / fullCarriers.size;
							middle[2] += place[2] / fullCarriers.size;
						}
						const grownIn = new Array<number>(8).fill(0);
						const keptIn = new Array<number>(8).fill(0);
						for (const [carrier, place] of fullCarriers) {
							const octant =
								(place[0] > middle[0] ? 1 : 0) +
								(place[1] > middle[1] ? 2 : 0) +
								(place[2] > middle[2] ? 4 : 0);
							grownIn[octant] = (grownIn[octant] as number) + 1;
							if (kept.has(carrier)) keptIn[octant] = (keptIn[octant] as number) + 1;
						}
						for (let octant = 0; octant < 8; octant++) {
							const grown = grownIn[octant] as number;
							if (grown < OCTANT_LEAST) continue;
							const off = Math.abs((keptIn[octant] as number) / grown - share);
							expect([at, octant, off <= OCTANT_SLACK]).toEqual([at, octant, true]);
						}
						before = plant;
					}
					// The sparsest plant keeps the floor's share of its carriers.
					const floor = kit.record.sparse?.foliage ?? FOLIAGE_FLOOR;
					const sparsest = carriers(plants[plants.length - 1] as PlantAsset).size;
					expect([id, seed, sparsest >= Math.round(fullCarriers.size * floor)]).toEqual([
						id,
						seed,
						true,
					]);
					expect([id, seed, sparsest <= Math.round(fullCarriers.size * floor) + 32]).toEqual([
						id,
						seed,
						true,
					]);
					expect(fullRows.size).toBe(full.shoots.count);
				}
			},
			LONG,
		);

		it(
			'grows once, and gives the same bytes from a kept plant and from a new growth',
			async () => {
				const kit = await kitOf(id);
				forgetGrownPlants();
				const options = { seed: 5, variant: 1, near: false } as const;
				const started = performance.now();
				const full = growPlantNow(kit, options);
				const grew = performance.now() - started;
				const grown = plantsGrown();
				// A change of sparseness cuts the kept plant: no growth, and less time than the growth.
				const cutStarted = performance.now();
				const half = growPlantNow(kit, { ...options, sparse: 0.5 });
				const cut = performance.now() - cutStarted;
				const sparsest = growPlantNow(kit, { ...options, sparse: 1 });
				expect(plantsGrown()).toBe(grown);
				expect([id, cut < grew]).toEqual([id, true]);
				// The same bytes again, from the kept plant and from a growth that starts at the seed.
				expect(plantAssetDigest(growPlantNow(kit, { ...options, sparse: 0.5 }))).toBe(
					plantAssetDigest(half),
				);
				forgetGrownPlants();
				expect(plantAssetDigest(growPlantNow(kit, { ...options, sparse: 1 }))).toBe(
					plantAssetDigest(sparsest),
				);
				expect(plantsGrown()).toBe(grown + 1);
				expect(plantAssetDigest(growPlantNow(kit, { ...options, sparse: 0 }))).toBe(
					plantAssetDigest(full),
				);
				expect(plantAssetDigest(growPlantNow(kit, options))).toBe(plantAssetDigest(full));
			},
			LONG,
		);
	});
}

describe('the sparseness option', () => {
	it('keys a sparser plant apart from the plant as grown', async () => {
		const kit = await kitOf('pedunculate-oak');
		const grown = variantKey(kit, { seed: 11, variant: 0 });
		expect(variantKey(kit, { seed: 11, variant: 0, sparse: 0 })).toBe(grown);
		expect(variantKey(kit, { seed: 11, variant: 0, sparse: 1 })).not.toBe(grown);
		expect(variantKey(kit, { seed: 11, variant: 0, sparse: 0.5 })).not.toBe(
			variantKey(kit, { seed: 11, variant: 0, sparse: 1 }),
		);
		// A cut piece grows as it is, so its key holds no sparseness.
		const piece = { seed: 11, variant: 0, cutting: { part: 'branch' } } as const;
		expect(variantKey(kit, { ...piece, sparse: 1 })).toBe(variantKey(kit, piece));
	});

	it('refuses a sparseness outside 0 to 1', async () => {
		const kit = await kitOf('hosta');
		expect(() => growPlantNow(kit, { seed: 11, variant: 0, sparse: 1.5 })).toThrow(/sparse is 1.5/);
		expect(() => growPlantNow(kit, { seed: 11, variant: 0, sparse: -0.1 })).toThrow(
			/sparse is -0.1/,
		);
	});

	it('gives phones and tablets the sparsest form and desktops the plant as grown', () => {
		expect(sparseForDevice('phone')).toBe(1);
		expect(sparseForDevice('tablet')).toBe(1);
		expect(sparseForDevice('desktop')).toBe(0);
	});

	it('checks a record floors: a foliage share from 0 to 1, a limb share above 0', async () => {
		const { record } = await loadSpecies('pedunculate-oak');
		expect(speciesProblems({ ...record, sparse: { foliage: 0.2, limbs: 0.4 } })).toEqual([]);
		const problems = speciesProblems({ ...record, sparse: { foliage: 1.2, limbs: 0 } }).join('\n');
		expect(problems).toMatch(/sparse\.foliage is 1\.2/);
		expect(problems).toMatch(/sparse\.limbs is 0/);
	});
});
