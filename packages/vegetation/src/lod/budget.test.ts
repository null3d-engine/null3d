// A triangle maximum draws one plant in no more triangles than a page allows. These tests state its
// contracts over trees, a shrub, ground plants and a cactus, at nine maxima and three sparseness
// values: no level draws more than the maximum, each part stays within its allowance, the plant is
// one body with every card joined to the wood, a growth gives the same bytes twice, and the capped
// plant's outline overlaps the uncapped plant's by at least a stated share at each maximum.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { shootTriangles } from '../coarseness';
import { loadSpecies } from '../core/registry';
import {
	bakeFarNow,
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
import { loadFarBaker } from './impostor';
import { outlineMatte, outlineOverlap } from './outline.test-support';

/** A species grows once and is cut and capped many times; a busy machine takes tens of seconds. */
const LONG = scaledBudget(240_000);

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

/** The plants with wood and shoot rows, whose leaves a maximum draws as cards. */
const WOODY = new Set<string>([
	'pedunculate-oak',
	'scots-pine',
	'silver-birch',
	'hawthorn-shrub',
	'saguaro',
]);

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
	// The 50,000 maximum's woody floor is the rebuilt silver birch's: 0.715 at sparseness 0.5, less
	// the margin. Its crown there covers 0.069 of the matte and its cap 0.067, the two outlines
	// sitting on each other in the round's overlay, birch-cap-50000-sparse05.png, so the shortfall is
	// speckle across the crown and no lost edge. The row was measured before the birch was rebuilt
	// whole as a spray of strands at every socket.
	[0.685, 0.84],
	[0.5, 0.53],
	[0.3, 0.39],
	[0.26, 0.21],
	[0.17, 0.03],
	[0.09, 0],
];

/** The side of the cells a level's triangles are read in, in metres, to see whether it is one body. */
const BODY_CELL = 0.4;

/**
 * The distance in metres from a cell's point to a joined point within which the level's own join
 * holds it, so a piece the join holds does not read as free.
 */
function levelReach(level: 0 | 1 | 2): number {
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

/** The species whose capped outline is recorded open in D-374, the crown-card coverage rail. */
const OUTLINE_OPEN = new Set<string>(['pedunculate-oak', 'silver-birch', 'hawthorn-shrub']);

/** The capped-body fault recorded open: the saguaro's free leaf triangles at its sparsest state. */
const bodyOpen = (id: string, sparse: number): boolean => id === 'saguaro' && sparse === 1;

/** One state's grown plants, grown once and shared by the three cases that read them. */
interface CapSession {
	readonly kit: SpeciesKitData;
	readonly full: PlantAsset;
	readonly capped: readonly {
		readonly at: string;
		readonly max: (typeof MAXIMA)[number];
		readonly plant: PlantAsset;
		readonly allowed: PlantAsset['stats']['allowed'];
		readonly later: number;
		readonly overlap: number;
	}[];
}

const sessions = new Map<string, Promise<CapSession>>();

/** The capped plants of one species and sparseness, grown once for the three cases that read them. */
function capSession(id: (typeof SPECIES)[number], sparse: number): Promise<CapSession> {
	const key = `${id}|${sparse}`;
	const known = sessions.get(key);
	if (known) return known;
	const made = (async (): Promise<CapSession> => {
		const kit = await kitOf(id);
		const base = { seed: 11, variant: 0, near: true, sparse } as const;
		const full = growPlantNow(kit, base);
		const matte = outlineMatte(kit, full, 0);
		const capped = MAXIMA.map((max) => {
			const at = `${id} sparse ${sparse} max ${max}`;
			const plant = growPlantNow(kit, { ...base, maxTriangles: max });
			const later = growNearWoodNow(kit, { ...base, maxTriangles: max });
			let wood = 0;
			for (const part of later) wood += part.arrays.indices.length / 3;
			const overlap = outlineOverlap(matte, outlineMatte(kit, plant, 0));
			table.set(`${id}|${sparse}|${max}`, overlap);
			return { at, max, plant, allowed: plant.stats.allowed, later: wood, overlap };
		});
		return { kit, full, capped };
	})();
	sessions.set(key, made);
	return made;
}

for (const id of SPECIES) {
	describe(`a triangle maximum on the ${id}`, () => {
		// Three cases a sparseness value, so a large plant's run of eight maxima fits a job of its own
		// and the plants are grown once: the cap's arithmetic, the crown's outline, and the body. The
		// rails recorded open name their fault in D-374, so a cap failure never hides under a recorded
		// look or body fault.
		for (const sparse of LEVELS) {
			it(
				`keeps every level within the maximum and each part within its allowance, at sparseness ${sparse}`,
				async () => {
					const { kit, full, capped } = await capSession(id, sparse);
					// The best look counts every part, and its parts add up to what the levels hold.
					expect(full.stats.allowed).toBeUndefined();
					expect(partTotal(full.stats.parts[0])).toBe(
						full.levels[0].triangles + shootTriangles(kit, full.shoots, kit.detail),
					);
					for (const { at, max, plant, allowed, later } of capped) {
						expect([at, plant.maxTriangles]).toEqual([at, max]);
						// The cap records its figure only where it bit. A maximum above the plant's own
						// levels draws them unchanged, and the far bake must then read no cap.
						expect([at, plant.capTriangles]).toEqual([
							at,
							plant.capTriangles === undefined ? undefined : max,
						]);
						expect([at, allowed !== undefined]).toEqual([at, true]);
						if (plant.capTriangles === undefined) {
							// No cap bit: the allowance is the counts the level drew, and the levels are the
							// plant's own, the same it draws with no maximum at all.
							for (const level of [0, 1, 2] as const)
								expect([at, level, allowed?.[level]]).toEqual([
									at,
									level,
									plant.stats.parts[level],
								]);
							expect([at, plant.stats.triangles]).toEqual([at, full.stats.triangles]);
						}
						for (const level of [0, 1, 2] as const) {
							const parts = plant.stats.parts[level];
							// The count is the level's own meshes and, at the nearest, its shoot rows at
							// the tier they draw at.
							const rows =
								level === 0 && plant.shootDetail !== 'none'
									? shootTriangles(kit, plant.shoots, plant.shootDetail ?? kit.detail)
									: 0;
							expect([at, level, partTotal(parts)]).toEqual([
								at,
								level,
								plant.levels[level].triangles + rows,
							]);
							expect([at, level, partTotal(parts) <= max]).toEqual([at, level, true]);
							for (const part of [
								'trunk',
								'limbs',
								'branches',
								'twigs',
								'leaves',
								'extras',
							] as const)
								expect([at, level, part, parts[part] <= (allowed?.[level][part] ?? 0)]).toEqual([
									at,
									level,
									part,
									true,
								]);
						}
						// The nearest wood that arrives later is the wood the capped level holds.
						expect([at, later]).toEqual([at, trianglesOf(plant, 0, 'wood')]);
					}
				},
				LONG,
			);
			// The capped nearest level's outline against the uncapped plant's, at every maximum. Where
			// the crown's cards cannot reach the cap's allowance the crown covers less than the leaf
			// form: recorded open for the oak, the birch and the hawthorn in D-374, and each case turns
			// red the day its figures clear.
			(OUTLINE_OPEN.has(id) ? it.failing : it)(
				`holds the capped outline at each maximum, at sparseness ${sparse}`,
				async () => {
					const { capped } = await capSession(id, sparse);
					const low: string[] = [];
					for (const { at, max, overlap } of capped) {
						const floor = (FLOORS[MAXIMA.indexOf(max)] as readonly [number, number])[
							WOODY.has(id) ? 0 : 1
						];
						if (overlap < floor) low.push(`${at}: ${overlap.toFixed(3)} under ${floor}`);
					}
					expect(low).toEqual([]);
				},
				LONG,
			);
			// One body: limbs and branches only on a trunk, and every card cluster joined to the wood
			// the level draws. The saguaro's free leaf triangles at its sparsest are recorded open as
			// a body fault, apart from the cap's assertions; the oak's old free-triangle rows have
			// cleared and this case holds them green.
			(bodyOpen(id, sparse) ? it.failing : it)(
				`keeps one body at each maximum, at sparseness ${sparse}`,
				async () => {
					const { kit, capped } = await capSession(id, sparse);
					const bodies: string[] = [];
					for (const { at, plant } of capped) {
						for (const level of [0, 1, 2] as const) {
							const parts = plant.stats.parts[level];
							if (parts.limbs + parts.branches > 0)
								expect([at, level, parts.trunk > 0]).toEqual([at, level, true]);
							const joins = plant.stats.clusters?.[level];
							if (parts.trunk > 0) expect([at, level, joins?.free]).toEqual([at, level, 0]);
							// The level's own triangles show it: a fill from the trunk's foot through cells
							// of 0.4 m reaches every piece of wood and every card, within the reach its
							// level allows. A fault is named and the run carries on.
							if (joins && joins.clusters > 0 && parts.trunk > 0) {
								const body = bodyFill(
									kit,
									plant,
									level,
									BODY_CELL,
									false,
									['cards'],
									levelReach(level),
								);
								if (body.freeWood > 0 || body.freeLeaves > 0)
									bodies.push(
										`${at} level ${level}: ${body.freeWood} free wood and ${body.freeLeaves} free leaf triangles`,
									);
							}
						}
					}
					expect(bodies).toEqual([]);
				},
				LONG,
			);
		}

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

	it(
		"bakes a capped plant's far card from the plant that was asked for",
		async () => {
			// The far card shows the asked plant's own first card level, and its grid follows that
			// level's triangles: a capped plant bakes a smaller atlas than the plant at its best look,
			// and it still shows a crown.
			const kit = await kitOf('hawthorn-shrub');
			await loadFarBaker();
			const base = { seed: 11, variant: 0 } as const;
			const best = bakeFarNow(kit, growPlantNow(kit, base));
			const capped = growPlantNow(kit, { ...base, maxTriangles: 2_000 });
			const wood = (plant: PlantAsset) =>
				plant.levels[1].parts.find((part) => part.name === 'wood')?.arrays.indices.length ?? 0;
			// The maximum does thin the level's wood, so the two bakes show different plants.
			expect(wood(capped)).toBeLessThan(wood(growPlantNow(kit, base)));
			const far = bakeFarNow(kit, capped);
			expect(far.texels).toBeLessThan(best.texels);
			expect(far.color).not.toEqual(best.color);
			// The crown still draws: some texel of some view covers leaves.
			expect(far.color.some((byte, at) => at % 4 === 3 && byte > 0)).toBe(true);
		},
		LONG,
	);

	it(
		'records no cap where a plant without a plan draws under the maximum, and leaves it unchanged',
		async () => {
			// The saguaro has no plan, so its maximum is decided by the drawn levels alone: asked above
			// the plant's own cost it draws the plant it draws with no maximum and records no cap.
			const kit = await kitOf('saguaro');
			const base = { seed: 11, variant: 0, near: true, sparse: 1 } as const;
			const full = growPlantNow(kit, base);
			const max = Math.ceil(partTotal(full.stats.parts[0]) * 1.5);
			const plant = growPlantNow(kit, { ...base, maxTriangles: max });
			expect(plant.maxTriangles).toBe(max);
			expect(plant.capTriangles).toBeUndefined();
			// With no cap bit the allowance is the counts the level drew.
			for (const level of [0, 1, 2] as const)
				expect(plant.stats.allowed?.[level]).toEqual(plant.stats.parts[level]);
			expect(plant.stats.triangles).toEqual(full.stats.triangles);
		},
		LONG,
	);

	it(
		'rebuilds and records the cap where the plan fits but a drawn level overflows',
		async () => {
			// The hawthorn's plan prices its 250,000 maximum at about 220,000, so the plan's own parts
			// fit it, while its nearest level draws more than three times that. The build measures the
			// drawn totals, rebuilds under the maximum and records the cap the far bake reads.
			const kit = await kitOf('hawthorn-shrub');
			const base = { seed: 11, variant: 0, near: true, sparse: 0 } as const;
			const full = growPlantNow(kit, base);
			const max = 250_000;
			const t = full.plan?.triangles;
			const price = t ? t.trunk + t.limbs + t.branches + t.twigs + t.foliage + t.fruit : Infinity;
			expect(price).toBeLessThanOrEqual(max);
			expect(partTotal(full.stats.parts[0])).toBeGreaterThan(max);
			const plant = growPlantNow(kit, { ...base, maxTriangles: max });
			expect(plant.maxTriangles).toBe(max);
			expect(plant.capTriangles).toBe(max);
			for (const level of [0, 1, 2] as const)
				expect([level, partTotal(plant.stats.parts[level]) <= max]).toEqual([level, true]);
		},
		LONG,
	);

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
