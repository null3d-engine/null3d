// The cases the night of 16 to 17 November 2026 added beside the frozen contract. The frozen file
// `planned-contract.test.ts` is the C1 evidence and does not change; these run separately.
//
// Two kinds of case live here. The asset cases read the grown plant's own structure: the skeleton's
// connectivity, the wood at every detail tier, the young end's steps, and the far bake's cost. The
// evidence cases read a review run's own measures from the JSON the review tool writes, because a
// drawn-picture figure (a free piece, the crown's lightness across a pull back) is not an asset
// figure; they run only when the run folder is named, so the suite needs no picture to pass.
//
// Cases known red on `0e4ef0986` and left red until the named fix lands: the cap connectivity when
// pointed at the cap-500 run (nine pieces, eight hanging free), the lightness band across the pull
// back (10.1 where 3.4 is allowed), and the far bake's cost (the atlas fix has not landed).
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { leafArea } from '../crown/density';
import { buildKitNow, forgetGrownPlants, growPlantNow, loadPlantCode } from '../generate';

/** The seed every case grows at, as the contract's quick set does. */
const SEED = 11;

/** The caps the connectivity case grows, the smallest last. */
const CAPS: readonly number[] = [20_000, 5_000, 2_000, 1_000, 700, 500];

/**
 * The crown's mean lightness at each distance of the seven-distance pull back, read on
 * `0e4ef0986` by the levels reviewer's own classifier (the run behind `build/sheets/pull-back.png`),
 * against the 57 m still's 71.4.
 */
const PULL_BACK: readonly (readonly [number, number])[] = [
	[150, 74.8],
	[190, 74.7],
	[199, 75.1],
	[205, 75.4],
	[240, 65.5],
	[255, 64.7],
];

/** The lightness a crown may drift across 150 to 255 m: the near level's own band of variation. */
const LIGHTNESS_BAND = 3.4;

/** The young end's steps as measured on `0e4ef0986`, which the rails hold them at or under. */
const YOUNG_RAIL = { leafRatio: 2.9, triangleRatio: 2.13, extras: 65_824 } as const;

/** The far bake's cost a sparse crown should reach once it bakes only the atlases it uses, in ms. */
const SPARSE_BAKE_BAR_MS = 250;

/** The kits, built once. */
const kits = new Map<string, Promise<SpeciesKitData>>();

/** A species' kit at a detail tier, built once. */
function kitOf(detail: 'low' | 'high'): Promise<SpeciesKitData> {
	let kit = kits.get(detail);
	if (!kit) {
		kit = (async () => {
			const { loadSpecies } = await import('../core/registry');
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			return buildKitNow(module, { placeholders: 'missing', detail });
		})();
		kits.set(detail, kit);
	}
	return kit;
}

/** One plant of the oak, by its request. */
async function plant(request: {
	readonly maturity?: number;
	readonly sparse?: number;
	readonly maxTriangles?: number;
}): Promise<PlantAsset> {
	const kit = await kitOf('low');
	return growPlantNow(kit, {
		seed: SEED,
		variant: 0,
		near: false,
		detail: 'low',
		...request,
	} as never);
}

/** The triangles the young plant's acorns and catkins draw at the first level. */
function extrasOf(asset: PlantAsset): number {
	let triangles = 0;
	for (const part of asset.levels[0].parts)
		if (part.name === 'extras') triangles += part.arrays.indices.length / 3;
	return triangles;
}

/** The leaf area one leaf covers, from the record's foliage. */
function leafOf(kit: SpeciesKitData): number {
	return leafArea(kit.record.foliage);
}

/** The leaf area a plant's rows carry. */
function leafSum(kit: SpeciesKitData, asset: PlantAsset): number {
	const one = leafOf(kit);
	let area = 0;
	for (let row = 0; row < asset.shoots.count; row++) {
		const prototype = kit.prototypes[asset.shoots.prototype[row] as number];
		if (!prototype) continue;
		const scale = asset.shoots.scale[row] as number;
		area += prototype.leaves * one * scale * scale;
	}
	return area;
}

/** Whether every skeleton node reaches the one root by its parents. */
function oneTree(asset: PlantAsset): boolean {
	const { parent, nodeCount } = asset.skeleton;
	let roots = 0;
	for (let node = 0; node < nodeCount; node++) if ((parent[node] as number) < 0) roots++;
	if (roots !== 1) return false;
	for (let node = 0; node < nodeCount; node++) {
		let at = node;
		let steps = 0;
		while ((parent[at] as number) >= 0 && steps <= nodeCount) {
			at = parent[at] as number;
			steps++;
		}
		if (steps > nodeCount) return false;
	}
	return true;
}

/** The clumps whose centre lies outside the skeleton's own box, which no wood can carry. */
function clumpsOutside(asset: PlantAsset): number {
	let outside = 0;
	const { bounds, clumps } = asset.skeleton;
	for (const clump of clumps ?? [])
		for (let axis = 0; axis < 3; axis++) {
			const value = clump.centre[axis] as number;
			const least = (bounds.min[axis] as number) - clump.radius;
			const most = (bounds.max[axis] as number) + clump.radius;
			if (value < least || value > most) {
				outside++;
				break;
			}
		}
	return outside;
}

/** The review run folder the drawn-picture cases read, when the environment names one. */
const capRun = process.env.NULL3D_OAK_CAP_RUN;

describe('the newly added oak cases', () => {
	it('K1: every cap is one tree, with no clump off the wood', async () => {
		forgetGrownPlants();
		for (const maxTriangles of CAPS) {
			const asset = await plant({ maxTriangles });
			const clumps = (asset.skeleton.clumps ?? []).length;
			expect([maxTriangles, oneTree(asset)]).toEqual([maxTriangles, true]);
			expect([maxTriangles, clumpsOutside(asset)]).toEqual([maxTriangles, 0]);
			console.log(`K1 cap ${maxTriangles}: one tree, ${clumps} clumps, 0 outside the wood`);
		}
	});

	it.skipIf(!capRun)(
		'K2: the drawn picture reads one piece and no piece hanging free (needs a review run)',
		() => {
			const metrics = JSON.parse(readFileSync(join(capRun as string, 'metrics.json'), 'utf8')) as {
				stills: {
					pairs: {
						file?: string;
						pieces?: { render?: number };
						connectivity?: { floating?: { area: number }[] };
					}[];
				};
			};
			const still = metrics.stills.pairs.find((pair) => pair.file?.startsWith('01'));
			expect(still).toBeDefined();
			const pieces = still?.pieces?.render;
			const floating = still?.connectivity?.floating ?? [];
			console.log(
				`K2 ${capRun}: the picture reads ${pieces} pieces with ${floating.length} hanging free`,
			);
			expect({ pieces, floating: floating.length }).toEqual({ pieces: 1, floating: 0 });
		},
	);

	it('L1: the crown keeps its lightness across the 150 to 255 m pull back', () => {
		const span = PULL_BACK.map(([, lightness]) => lightness);
		const first = span[0] as number;
		const drift = Math.max(...span.map((lightness) => Math.abs(lightness - first)));
		const steps = span
			.slice(1)
			.map((lightness, index) => Math.abs(lightness - (span[index] as number)));
		console.log(
			`L1: lightness ${span.join(', ')} from 150 to 255 m; drift from 150 m ${drift.toFixed(1)}, largest step ${Math.max(...steps).toFixed(1)}, band allowed ${LIGHTNESS_BAND}`,
		);
		expect(drift).toBeLessThanOrEqual(LIGHTNESS_BAND);
		expect(Math.max(...steps)).toBeLessThanOrEqual(LIGHTNESS_BAND);
	});

	it('W1: the wood is one skeleton at every detail tier, so no distance changes it', async () => {
		forgetGrownPlants();
		const low = await kitOf('low');
		const high = await kitOf('high');
		const plain = { seed: SEED, variant: 0, near: false } as const;
		const first = growPlantNow(low, { ...plain, detail: 'low' } as never);
		const second = growPlantNow(high, { ...plain, detail: 'high' } as never);
		const nodes = first.skeleton.nodeCount;
		expect({ nodes, other: second.skeleton.nodeCount }).toEqual({ nodes, other: nodes });
		for (let node = 0; node < nodes; node++)
			for (let axis = 0; axis < 3; axis++)
				expect([
					node,
					axis,
					Number((first.skeleton.position[node * 3 + axis] as number).toFixed(3)),
				]).toEqual([
					node,
					axis,
					Number((second.skeleton.position[node * 3 + axis] as number).toFixed(3)),
				]);
		console.log(`W1: the wood is ${nodes} nodes, the same at detail low and high`);
	});

	it('Y1: the young end’s steps cannot worsen past the measured rail', async () => {
		forgetGrownPlants();
		const kit = await kitOf('low');
		const young = await plant({ maturity: 0.1 });
		const next = await plant({ maturity: 0.11 });
		const leafRatio = leafSum(kit, next) / leafSum(kit, young);
		const triangleRatio =
			(next.stats.triangles[0] as number) / (young.stats.triangles[0] as number);
		const extras = extrasOf(await plant({ maturity: 0.22 }));
		console.log(
			`Y1: leaf area step ${leafRatio.toFixed(2)}x (rail ${YOUNG_RAIL.leafRatio}), triangles ${triangleRatio.toFixed(2)}x (rail ${YOUNG_RAIL.triangleRatio}), extras at 0.22 ${extras} (rail ${YOUNG_RAIL.extras})`,
		);
		expect(leafRatio).toBeLessThanOrEqual(YOUNG_RAIL.leafRatio);
		expect(triangleRatio).toBeLessThanOrEqual(YOUNG_RAIL.triangleRatio);
		expect(extras).toBeLessThanOrEqual(YOUNG_RAIL.extras);
	});

	it('B1: a sparse crown’s far bake costs the atlases it uses, not the whole plant', async () => {
		forgetGrownPlants();
		const kit = await kitOf('low');
		const { loadFarBaker } = await import('../lod/impostor');
		const { bakeFarNow } = await import('../generate');
		await loadFarBaker();
		const base = { seed: SEED, variant: 0, near: false, detail: 'low' } as const;
		const median = (values: readonly number[]): number =>
			[...values].sort((one, two) => one - two)[1] as number;
		const bakeOf = async (request: {
			readonly maturity?: number;
			readonly sparse?: number;
		}): Promise<number> => {
			const runs: number[] = [];
			for (let run = 0; run < 3; run++) {
				const asset = growPlantNow(kit, { ...base, ...request } as never);
				const started = performance.now();
				bakeFarNow(kit, asset);
				runs.push(performance.now() - started);
			}
			return median(runs);
		};
		const sparse = await bakeOf({ maturity: 0.3, sparse: 1 });
		console.log(
			`B1: the sparse crown's far bake ${sparse.toFixed(0)} ms, bar ${SPARSE_BAKE_BAR_MS} ms`,
		);
		expect(sparse).toBeLessThanOrEqual(SPARSE_BAKE_BAR_MS);
	});

	it('A1: the alder honours the three options once it is on the planned model', async () => {
		forgetGrownPlants();
		const { loadSpecies } = await import('../core/registry');
		const alder = (await loadSpecies('common-alder')) as Awaited<ReturnType<typeof loadSpecies>>;
		await loadPlantCode(alder.record);
		const kit = buildKitNow(alder, { placeholders: 'missing', detail: 'low' });
		const base = { seed: SEED, variant: 0, near: false, detail: 'low' } as const;
		const plain = growPlantNow(kit, base);
		const repeat = growPlantNow(kit, base);
		const aged = growPlantNow(kit, { ...base, maturity: 0.3 } as never);
		const thinned = growPlantNow(kit, { ...base, sparse: 1 } as never);
		const capped = growPlantNow(kit, { ...base, maxTriangles: 1000 } as never);
		const plainRows = plain.shoots.count;
		const thinRows = thinned.shoots.count;
		const capTriangles = capped.stats.triangles as readonly number[];
		const matureMoves = plantAssetDigest(aged) !== plantAssetDigest(plain);
		console.log(
			`A1: alder rows ${plainRows} plain, ${thinRows} at sparseness 1; capped levels ${capTriangles.join('/')}; maturity 0.3 ${matureMoves ? 'moves the plant' : 'leaves it unchanged'}`,
		);
		// Each assertion is the planned model acting; on a directed alder the first one fails.
		expect(matureMoves).toBe(true);
		expect(thinRows).toBeLessThan(plainRows);
		for (let level = 0; level < 3; level++)
			expect([level, (capTriangles[level] as number) <= 1000]).toEqual([level, true]);
		expect(plantAssetDigest(repeat)).toBe(plantAssetDigest(plain));
	});
});
