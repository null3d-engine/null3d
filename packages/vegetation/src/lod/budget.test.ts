// A triangle maximum draws one plant in no more triangles than a page allows. These tests state its
// contracts over every species the registry ships, uncapped and at eight maxima, at three sparseness
// values: no level draws more than the maximum, each part stays within its allowance, the plant is
// one body with every card joined to the wood, a growth gives the same bytes twice, and the capped
// plant's outline overlaps the uncapped plant's by at least a stated share at each maximum.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { shootTriangles } from '../coarseness';
import { loadSpecies, speciesIds } from '../core/registry';
import {
	buildKitNow,
	forgetGrownPlants,
	growNearWoodNow,
	growPlantNow,
	loadPlantCode,
	variantKey,
} from '../generate';
import { bodyFill } from './body.test-support';
import { partTotal } from './budget';
import { SEED_REACH } from './cards';
import { outlineMatte, outlineOverlap } from './outline.test-support';

/** A species grows once and is cut and capped many times; a busy machine takes tens of seconds. */
const LONG = scaledBudget(240_000);

/** The species the contracts are stated over: every species the registry ships, as it ships it. */
const SPECIES = speciesIds();

/** The maxima each plant is capped at, falling; none stands for the plant's best look. */
const MAXIMA = [1_000_000, 250_000, 50_000, 10_000, 2_000, 500, 100, 30] as const;

/** The sparseness values each maximum is tried at. */
const LEVELS = [0, 0.5, 1] as const;

/**
 * The least share of the uncapped plant's outline that a capped plant's nearest level overlaps, for
 * each maximum in turn: for a plant with wood and shoot rows first, then for a ground plant, whose
 * every leaf is a mesh of its own. Each is the lowest overlap measured over these species and
 * sparseness values, less a margin of 0.03. The lowest are the sparsest plants, whose outline is
 * mostly thin wood, and a ground plant under a few hundred triangles, which keeps a handful of
 * leaves. A stalk is a line with no area, so the matte does not count it.
 */
const FLOORS: readonly (readonly [woody: number, ground: number])[] = [
	[0.95, 0.97],
	[0.95, 0.97],
	[0.73, 0.84],
	[0.5, 0.53],
	[0.3, 0.39],
	[0.26, 0.21],
	[0.17, 0.03],
	[0.09, 0],
];

/** The side of the wood's cells, in metres, to see whether the level's wood is one body. */
const BODY_CELL = 0.4;

/**
 * The distance in metres from a card's point to a joined point within which the card's level holds
 * it, so a card the join holds does not read as free. Wood keeps the finer cell, since a gap between
 * wood pieces of the join's reach shows at every distance.
 */
function cardReach(level: 0 | 1 | 2): number {
	return level === 0 ? BODY_CELL : (SEED_REACH[level - 1] as number);
}

/** The triangles of a level's parts of one name. */
function trianglesOf(asset: PlantAsset, level: 0 | 1 | 2, name: string): number {
	let triangles = 0;
	for (const part of asset.levels[level].parts)
		if (part.name === name) triangles += part.arrays.indices.length / 3;
	return triangles;
}

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

/** The overlap of each species at each maximum and sparseness, which the last test prints. */
const table = new Map<string, number>();

for (const id of SPECIES) {
	describe(`a triangle maximum on the ${id}`, () => {
		// One test a sparseness value, so a large plant's run of eight maxima fits a job of its own.
		for (const sparse of LEVELS)
			it(
				`keeps every level within the maximum, each part within its allowance, and one body, at sparseness ${sparse}`,
				async () => {
					const kit = await kitOf(id);
					// Every check that fails, with its figure, so one run shows them all.
					const problems: string[] = [];
					const check = (ok: boolean, what: string) => {
						if (!ok) problems.push(what);
					};
					const base = { seed: 11, variant: 0, near: true, sparse } as const;
					const full = growPlantNow(kit, base);
					const matte = outlineMatte(kit, full, 0);
					// A plant with wood and shoot rows draws its leaves as cards under a maximum; any other
					// draws its own mesh of leaves.
					const woody =
						full.shoots.count > 0 && full.levels[0].parts.some((part) => part.name === 'wood');
					// The best look counts every part, and its parts add up to what the levels hold.
					check(
						full.stats.allowed === undefined,
						`${id} sparse ${sparse}: the best look has allowances`,
					);
					const fullParts = partTotal(full.stats.parts[0]);
					const fullCount = full.levels[0].triangles + shootTriangles(kit, full.shoots, kit.detail);
					check(
						fullParts === fullCount,
						`${id} sparse ${sparse} none: parts ${fullParts} against the levels' ${fullCount}`,
					);
					// The best look is one body too: its wood within the fine cell, and its cards within
					// the reach that the level's own join allows.
					for (const level of [1, 2] as const) {
						const parts = full.stats.parts[level];
						if (parts.trunk === 0) continue;
						const wood = bodyFill(kit, full, level, BODY_CELL, false, []);
						const cards = bodyFill(kit, full, level, BODY_CELL, false, ['cards'], cardReach(level));
						check(
							wood.freeWood === 0 && cards.freeLeaves === 0,
							`${id} sparse ${sparse} none level ${level}: ${wood.freeWood} free wood, ${cards.freeLeaves} free leaves`,
						);
					}
					for (const max of MAXIMA) {
						const at = `${id} sparse ${sparse} max ${max}`;
						const plant = growPlantNow(kit, { ...base, maxTriangles: max });
						const allowed = plant.stats.allowed;
						check(allowed !== undefined && plant.maxTriangles === max, `${at}: no allowances`);
						for (const level of [0, 1, 2] as const) {
							const parts = plant.stats.parts[level];
							// The count is the level's own meshes and, at the nearest, its shoot rows at
							// the tier they draw at.
							const rows =
								level === 0 && plant.shootDetail !== 'none'
									? shootTriangles(kit, plant.shoots, plant.shootDetail ?? kit.detail)
									: 0;
							const total = partTotal(parts);
							check(
								total === plant.levels[level].triangles + rows,
								`${at} level ${level}: parts ${total} against the level's ${plant.levels[level].triangles + rows}`,
							);
							check(total <= max, `${at} level ${level}: ${total} triangles`);
							for (const part of [
								'trunk',
								'limbs',
								'branches',
								'twigs',
								'leaves',
								'extras',
							] as const)
								check(
									parts[part] <= (allowed?.[level][part] ?? 0),
									`${at} level ${level}: ${part} ${parts[part]} over its allowance ${allowed?.[level][part] ?? 0}`,
								);
							// One body: limbs and branches only on a trunk, and every card cluster joined to
							// the wood the level draws.
							if (parts.limbs + parts.branches > 0)
								check(parts.trunk > 0, `${at} level ${level}: limbs or branches with no trunk`);
							const joins = plant.stats.clusters?.[level];
							if (parts.trunk > 0)
								check(joins?.free === 0, `${at} level ${level}: ${joins?.free} free clusters`);
							// The level's own meshes show it: a fill from the trunk's foot reaches every
							// piece of wood in the fine cell, and every card within the level's own join
							// reach.
							if (joins && joins.clusters > 0 && parts.trunk > 0) {
								const wood = bodyFill(kit, plant, level, BODY_CELL, false, []);
								const cards = bodyFill(
									kit,
									plant,
									level,
									BODY_CELL,
									false,
									['cards'],
									cardReach(level),
								);
								check(
									wood.freeWood === 0 && cards.freeLeaves === 0,
									`${at} level ${level}: ${wood.freeWood} free wood, ${cards.freeLeaves} free leaves`,
								);
							}
						}
						// The nearest wood that arrives later is the wood the capped level holds.
						const later = growNearWoodNow(kit, { ...base, maxTriangles: max });
						let wood = 0;
						for (const part of later) wood += part.arrays.indices.length / 3;
						const held = trianglesOf(plant, 0, 'wood');
						check(wood === held, `${at}: later wood ${wood} against the level's ${held}`);
						// The outline holds its share of the uncapped plant's.
						const overlap = outlineOverlap(matte, outlineMatte(kit, plant, 0));
						table.set(`${id}|${sparse}|${max}`, overlap);
						const floor = (FLOORS[MAXIMA.indexOf(max)] as readonly [number, number])[woody ? 0 : 1];
						check(overlap >= floor, `${at}: overlap ${overlap.toFixed(3)} under ${floor}`);
					}
					expect(problems).toEqual([]);
				},
				LONG,
			);

		it(
			'gives the same bytes twice, and the uncapped plant under a maximum it never reaches',
			async () => {
				const kit = await kitOf(id);
				const options = {
					seed: 5,
					variant: 1,
					near: true,
					sparse: 0.5,
					maxTriangles: 2_000,
				} as const;
				const first = plantAssetDigest(growPlantNow(kit, options));
				expect(plantAssetDigest(growPlantNow(kit, options))).toBe(first);
				forgetGrownPlants();
				expect(plantAssetDigest(growPlantNow(kit, options))).toBe(first);
				const { maxTriangles: _max, ...plain } = options;
				expect(plantAssetDigest(growPlantNow(kit, { ...plain, maxTriangles: 1e12 }))).toBe(
					plantAssetDigest(growPlantNow(kit, plain)),
				);
			},
			LONG,
		);
	});
}

describe('the triangle maximum option', () => {
	it('keys a capped plant apart from the plant at its best look', async () => {
		const kit = await kitOf('hosta');
		const grown = variantKey(kit, { seed: 11, variant: 0 });
		expect(variantKey(kit, { seed: 11, variant: 0, maxTriangles: 500 })).not.toBe(grown);
		expect(variantKey(kit, { seed: 11, variant: 0, maxTriangles: 500 })).not.toBe(
			variantKey(kit, { seed: 11, variant: 0, maxTriangles: 100 }),
		);
	});

	it('refuses a maximum that is no positive count', async () => {
		const kit = await kitOf('hosta');
		for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => growPlantNow(kit, { seed: 11, variant: 0, maxTriangles: max })).toThrow(
				/maxTriangles is/,
			);
	});

	it('prints the overlap of each capped plant with the plant at its best look', () => {
		const lines = [`| Species | Sparse | ${MAXIMA.join(' | ')} |`];
		for (const id of SPECIES)
			for (const sparse of LEVELS)
				lines.push(
					`| ${id} | ${sparse} | ${MAXIMA.map((max) => table.get(`${id}|${sparse}|${max}`)?.toFixed(3) ?? '-').join(' | ')} |`,
				);
		console.log(lines.join('\n'));
		// A run may pick some species and sparseness values; each one that ran gave every cell of its
		// row.
		expect(table.size % MAXIMA.length).toBe(0);
	});
});
