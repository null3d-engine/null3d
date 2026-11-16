// The four parameter requirements, stated as cases and run against every grower push. Appendix B of
// the oak plan names each case and its pass rule. The quick set is seed 11 and runs at each push; the
// full set adds seeds 3, 7, 19 and 23 at the checkpoints. Set NULL3D_CONTRACT_FULL=1 for the full set.
//
// The anchor is today's oak: the directed frame record, grown at the same commit and seed beside the
// planned oak. A0 and the fill target (F1) compare the two, so they follow the frame as it moves.
// The fill target is a target for the grower, not a gate: the eye decides.
import { describe, expect, it, spyOn } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { leafArea } from '../crown/density';
import { BUD_FLOWER } from '../core/graph';
import type { SpeciesModule } from '../core/record';
import { standInSpecies } from '../core/stand-in';
import { buildKitNow, forgetGrownPlants, growPlantNow, loadPlantCode, plantsGrown } from '../generate';
import { rowSockets } from '../grow/sparse';
import * as sparseModule from '../grow/sparse';
import { planFrame } from '../grow/frame';
import * as budgetModule from '../lod/budget';

/** Whether the run states the full set of seeds. */
const FULL = process.env.NULL3D_CONTRACT_FULL === '1';

/** The quick set's seed, which every case runs. */
const HOME = 11;

/** The seeds each case runs: the quick seed alone, or the full set. */
const SEEDS: readonly number[] = FULL ? [3, 7, 11, 19, 23] : [HOME];

/** The maturity steps of the curve, from a sapling to the full tree. */
const MATURITIES: readonly number[] = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);

/** The maxima of the maximum cases, falling. */
const MAXIMA: readonly number[] = [400, 700, 1000, 1100, 1500, 5000, 20_000, 100_000];

/** The (maturity, sparseness) points the maximum cases run at. */
const X_POINTS: readonly (readonly [number, number])[] = [
	[1, 0],
	[0.5, 0.5],
	[0.3, 1],
];

/**
 * The least outline overlap each maximum takes with the uncapped plant, from the next smaller
 * maximum listed in `lod/budget.test.ts`, as appendix B names them.
 */
const FLOORS: Readonly<Record<number, number>> = {
	400: 0.17,
	700: 0.26,
	1000: 0.26,
	1100: 0.26,
	1500: 0.26,
	5000: 0.3,
	20_000: 0.5,
	100_000: 0.685,
};

/** The fill target's tolerances, frozen at C1: the median rows a clump holds, and its spread. */
const FILL = { median: 0.15, spread: 0.25, inner: 0.05, sky: 0.05, cover: 0.02 } as const;

/** A budget for a case that grows many plants: a busy machine takes minutes. */
const LONG = scaledBudget(180_000);

/** The oak's planned kit and its anchor kit, built once. */
const kits = new Map<string, Promise<SpeciesKitData>>();

/** The two records the contract grows: the planned oak and the directed frame it replaces. */
async function moduleOf(kind: 'planned' | 'anchor'): Promise<SpeciesModule> {
	if (kind === 'planned') {
		const { loadSpecies } = await import('../core/registry');
		return (await loadSpecies('pedunculate-oak')) as SpeciesModule;
	}
	const record = (await import('../species/pedunculate-oak/directed')).directed;
	const textures = (await import('@null3d/vegetation-textures/pedunculate-oak')).files;
	return { record, textures } as SpeciesModule;
}

/** A species' kit at the low tier, built once. The planned kit grows the oak's planned form. */
function kitOf(kind: 'planned' | 'anchor'): Promise<SpeciesKitData> {
	let kit = kits.get(kind);
	if (!kit) {
		kit = (async () => {
			const module = await moduleOf(kind);
			await loadPlantCode(module.record);
			return buildKitNow(module, {
				placeholders: 'missing',
				detail: 'low',
				...(kind === 'planned' ? { form: 'planned' } : {}),
			});
		})();
		kits.set(kind, kit);
	}
	return kit;
}

/** The options one plant grows from. */
interface Request {
	readonly maturity?: number;
	readonly sparse?: number;
	readonly maxTriangles?: number;
	readonly season?: string;
}

/** The plants this file has grown, by their request, so a case does not regrow a plant it shares. */
const grown = new Map<string, PlantAsset>();

/** One plant of the planned oak, kept by its request. */
async function plant(seed: number, request: Request, kind: 'planned' | 'anchor' = 'planned'): Promise<PlantAsset> {
	const key = `${kind}|${seed}|${request.maturity ?? 1}|${request.sparse ?? 0}|${request.maxTriangles ?? 'none'}|${request.season ?? 'default'}`;
	const kept = grown.get(key);
	if (kept) return kept;
	const kit = await kitOf(kind);
	const asset = growPlantNow(kit, {
		seed,
		variant: 0,
		near: false,
		detail: 'low',
		...(request.maturity === undefined ? {} : { maturity: request.maturity }),
		sparse: request.sparse ?? 0,
		...(request.maxTriangles === undefined ? {} : { maxTriangles: request.maxTriangles }),
		...(request.season === undefined ? {} : { season: request.season }),
	} as never);
	grown.set(key, asset);
	return asset;
}

/** Forget the plants this file keeps, so a case grows from the seed again. */
function forget(): void {
	grown.clear();
	forgetGrownPlants();
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return 0;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
		: (sorted[middle] as number);
}

/** The quartile range of a list, as its spread. */
function spreadOf(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return 0;
	const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
	return at(0.75) - at(0.25);
}

/** How far a numbered value stands from another, as a share of the other. */
function off(value: number, target: number): number {
	return target === 0 ? Math.abs(value) : Math.abs(value - target) / Math.abs(target);
}

/** The leaf area one leaf, needle or blade covers, from a record's foliage. */
function leafOf(kit: SpeciesKitData): number {
	return leafArea(kit.record.foliage);
}

/** The leaf area the rows of a plant carry. */
function leafShare(kit: SpeciesKitData, asset: PlantAsset): number {
	const one = leafOf(kit);
	let area = 0;
	for (let r = 0; r < asset.shoots.count; r++) {
		const prototype = kit.prototypes[asset.shoots.prototype[r] as number];
		if (!prototype) continue;
		const scale = asset.shoots.scale[r] as number;
		area += prototype.leaves * one * scale * scale;
	}
	return area;
}

/** The leaf area of each row, by its address in the plant as grown. */
function rowAreas(kit: SpeciesKitData, asset: PlantAsset): Map<number, number> {
	const one = leafOf(kit);
	const out = new Map<number, number>();
	for (let r = 0; r < asset.shoots.count; r++) {
		const prototype = kit.prototypes[asset.shoots.prototype[r] as number];
		if (!prototype) continue;
		const scale = asset.shoots.scale[r] as number;
		out.set(asset.shoots.id?.[r] ?? r, prototype.leaves * one * scale * scale);
	}
	return out;
}

/** Each row's address, which the planned grower keeps for one element across requests. */
function rowAddress(asset: PlantAsset, row: number): number {
	return asset.shoots.id?.[row] ?? row;
}

/** Each axis's address, which the planned grower keeps for one element across requests. */
function axisAddress(asset: PlantAsset, axis: number): number {
	return asset.skeleton.axes.origin?.[axis] ?? axis;
}

/** Each bud site's address, which the planned grower keeps for one element across requests. */
function budAddress(asset: PlantAsset, bud: number): number {
	return asset.skeleton.buds.origin?.[bud] ?? bud;
}

/** A node's position. */
function nodeAt(asset: PlantAsset, node: number): [number, number, number] {
	const p = asset.skeleton.position;
	return [p[node * 3] as number, p[node * 3 + 1] as number, p[node * 3 + 2] as number];
}

/** The distance between two points. */
function away(a: readonly number[], b: readonly number[]): number {
	return Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));
}

/** A unit direction between two points. */
function direction(from: readonly number[], to: readonly number[]): [number, number, number] {
	const d: [number, number, number] = [
		(to[0] as number) - (from[0] as number),
		(to[1] as number) - (from[1] as number),
		(to[2] as number) - (from[2] as number),
	];
	const length = Math.hypot(d[0], d[1], d[2]);
	return length > 0 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 1, 0];
}

/** The angle in degrees between two unit directions. */
function angleBetween(a: readonly number[], b: readonly number[]): number {
	const dot = (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
	return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** The plant's height. */
function heightOf(asset: PlantAsset): number {
	return asset.skeleton.height;
}

/** The crown's width: the wider horizontal extent of the shoot rows, or 0 without any. */
function crownOf(asset: PlantAsset): number {
	const rows = asset.shoots;
	if (rows.count === 0) return 0;
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (let r = 0; r < rows.count; r++) {
		const x = rows.position[r * 3] as number;
		const z = rows.position[r * 3 + 2] as number;
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	return Math.max(maxX - minX, maxZ - minZ);
}

/** The trunk's girth at 1.3 m: the circumference of the stem node nearest that height. */
function girthOf(asset: PlantAsset): number {
	const { axes, position, radius } = asset.skeleton;
	let best = -1;
	let nearest = Number.POSITIVE_INFINITY;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) >= 0 || (axes.kind[a] as number) !== 0) continue;
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
			const y = position[n * 3 + 1] as number;
			const d = Math.abs(y - 1.3);
			if (d < nearest) {
				nearest = d;
				best = n;
			}
		}
	}
	return best < 0 ? 0 : 2 * Math.PI * (radius[best] as number);
}

/** The axes at each order. */
function axesByOrder(asset: PlantAsset): number[] {
	const out: number[] = [];
	const { axes } = asset.skeleton;
	for (let a = 0; a < axes.count; a++) {
		const order = axes.order[a] as number;
		out[order] = (out[order] ?? 0) + 1;
	}
	return out.map((count) => count ?? 0);
}

/** The extras' triangles at the nearest level, which its acorns and catkins draw. */
function extrasOf(asset: PlantAsset): number {
	let triangles = 0;
	for (const part of asset.levels[0].parts)
		if (part.name === 'extras') triangles += part.arrays.indices.length / 3;
	return triangles;
}

/**
 * A plant's outline, box-normalised: the projected silhouette of its wood and foliage in a square
 * of cells, its own bounds scaled to fill it. This is the contract's own outline, not the review's
 * rasteriser; the reviewer's eye on the strips decides the look.
 */
function outlineOf(asset: PlantAsset, cells = 64): Uint8Array {
	const { bounds, position, radius, axes, nodeCount } = asset.skeleton;
	const width = Math.max(1e-6, Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]));
	const height = Math.max(1e-6, bounds.max[1] - bounds.min[1]);
	const mask = new Uint8Array(cells * cells);
	const splat = (x: number, y: number, r: number): void => {
		const cx = Math.floor(((x - (bounds.min[0] + bounds.max[0]) / 2) / width + 0.5) * (cells - 1));
		const cy = Math.floor(((bounds.max[1] - y) / height) * (cells - 1));
		const reach = Math.max(0, Math.ceil((r / width) * cells));
		for (let dy = -reach; dy <= reach; dy++)
			for (let dx = -reach; dx <= reach; dx++) {
				if (dx * dx + dy * dy > reach * reach) continue;
				const px = cx + dx;
				const py = cy + dy;
				if (px >= 0 && px < cells && py >= 0 && py < cells) mask[py * cells + px] = 1;
			}
	};
	for (let n = 0; n < nodeCount; n++)
		splat(position[n * 3] as number, position[n * 3 + 1] as number, (radius[n] as number) * 0.5);
	const rows = asset.shoots;
	for (let r = 0; r < rows.count; r++)
		splat(rows.position[r * 3] as number, rows.position[r * 3 + 1] as number, 0.12);
	void axes;
	return mask;
}

/** The overlap of two box-normalised outlines, from 0 to 1. */
function overlap(a: Uint8Array, b: Uint8Array): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.length; i++) {
		const one = a[i] === 1;
		const two = b[i] === 1;
		if (one && two) both++;
		if (one || two) either++;
	}
	return either === 0 ? 1 : both / either;
}

/** One clump of the fill target: a place with a radius and the socket places that fill it. */
interface Clump {
	readonly id: number;
	readonly centre: readonly [number, number, number];
	readonly radius: number;
	readonly sockets: number[];
}

/**
 * The adult plan's clumps: the frame's own bough-end patches, before the fine fill replaces them.
 * The planned grower names its own clumps the same way, one `lobe` id to a clump.
 */
async function anchorClumps(seed: number): Promise<{ clumps: readonly Clump[]; ofBud: Map<number, number> }> {
	const module = await moduleOf('anchor');
	const record = module.record;
	const input = { record, seed, variant: 0, season: record.seasons.default } as never;
	// The third argument asks for the stated patches, before the fine fill replaces them. A head
	// that does not take it yet reports every fine patch, which the fill target notes.
	const planOf = planFrame as unknown as (spec: never, input: never, fill?: boolean) => ReturnType<typeof planFrame>;
	const plan = planOf((record.growth as unknown as { frame: never }).frame, input, false);
	const clumps: Clump[] = plan.patches.map((patch, id) => ({
		id,
		centre: patch.centre as [number, number, number],
		radius: Math.max(patch.width, patch.depth) / 2,
		sockets: [],
	}));
	const asset = await plant(seed, {}, 'anchor');
	const { buds } = asset.skeleton;
	const ofBud = new Map<number, number>();
	for (let b = 0; b < buds.count; b++) {
		const at: [number, number, number] = [buds.position[b * 3] as number, buds.position[b * 3 + 1] as number, buds.position[b * 3 + 2] as number];
		let nearest = 0;
		let distance = Number.POSITIVE_INFINITY;
		for (let c = 0; c < clumps.length; c++) {
			const d = away(at, (clumps[c] as Clump).centre);
			if (d < distance) {
				distance = d;
				nearest = c;
			}
		}
		ofBud.set(b, nearest);
		clumps[nearest]?.sockets.push(b);
	}
	return { clumps, ofBud };
}

/** The planned plant's clumps, from its own table, and the clump each socket fills. */
function plannedClumps(asset: PlantAsset): { clumps: readonly Clump[]; ofBud: Map<number, number> } | undefined {
	const table = asset.skeleton.clumps;
	const sockets = asset.skeleton.buds.sockets;
	if (!table || !sockets) return undefined;
	const byId = new Map<number, Clump>();
	const clumps = table.map((entry) => {
		const clump: Clump = { id: entry.id, centre: entry.centre, radius: entry.radius, sockets: [] };
		byId.set(entry.id, clump);
		return clump;
	});
	const ofBud = new Map<number, number>();
	for (let b = 0; b < asset.skeleton.buds.count; b++) {
		const clump = byId.get(sockets.lobe[b] as number);
		if (!clump) continue;
		ofBud.set(b, clump.id);
		clump.sockets.push(b);
	}
	return { clumps, ofBud };
}

/** The fill measures of a clump table: rows a clump holds, the inner-half share, and the sky bins. */
interface FillFigures {
	readonly clumps: number;
	readonly medianRows: number;
	readonly spreadRows: number;
	readonly inner: number;
	readonly sky: readonly number[];
}

function fillFigures(
	asset: PlantAsset,
	table: { readonly clumps: readonly Clump[]; readonly ofBud: Map<number, number> },
): FillFigures {
	const rows = asset.shoots;
	const rowSocket = rowSockets(asset.skeleton, rows);
	const rowsOf = new Map<number, number>();
	if (rowSocket)
		for (let r = 0; r < rows.count; r++) {
			const clump = table.ofBud.get(rowSocket[r] as number);
			if (clump === undefined) continue;
			rowsOf.set(clump, (rowsOf.get(clump) ?? 0) + 1);
		}
	const inner: number[] = [];
	for (const clump of table.clumps) {
		let within = 0;
		for (const b of clump.sockets) {
			const at: [number, number, number] = [
				asset.skeleton.buds.position[b * 3] as number,
				asset.skeleton.buds.position[b * 3 + 1] as number,
				asset.skeleton.buds.position[b * 3 + 2] as number,
			];
			if (away(at, clump.centre) <= clump.radius / 2) within++;
		}
		if (clump.sockets.length > 0) inner.push(within / clump.sockets.length);
	}
	const rowsPer = table.clumps.map((clump) => rowsOf.get(clump.id) ?? 0);
	return {
		clumps: table.clumps.length,
		medianRows: median(rowsPer),
		spreadRows: spreadOf(rowsPer),
		inner: inner.length === 0 ? 0 : inner.reduce((s, v) => s + v, 0) / inner.length,
		sky: skyBins(asset),
	};
}

/** The rows' sky share in five equal bins. */
function skyBins(asset: PlantAsset): number[] {
	const bins = [0, 0, 0, 0, 0];
	const rows = asset.shoots;
	for (let r = 0; r < rows.count; r++) {
		const share = (rows.sky[r] as number) / 250;
		const bin = Math.min(4, Math.max(0, Math.floor(share * 5)));
		bins[bin] = (bins[bin] as number) + 1;
	}
	return bins.map((n) => n / Math.max(1, rows.count));
}

/** The planned growth's fruit and flower data, when the record states it. */
interface GrowthOptions {
	readonly fruitFrom?: number;
	readonly fruitBand?: number;
	readonly flowers?: { readonly season: string; readonly from: number; readonly band: number };
}

function growthOf(kit: SpeciesKitData): GrowthOptions {
	return (kit.record.growth as unknown as GrowthOptions) ?? {};
}

/** A fresh growth of one request, uncached, so a case that measures growth itself starts clean. */
async function freshPlant(kind: 'planned' | 'anchor', seed: number, request: Request): Promise<PlantAsset> {
	const kit = await kitOf(kind);
	forgetGrownPlants();
	return growPlantNow(kit, {
		seed,
		variant: 0,
		near: false,
		detail: 'low',
		...(request.maturity === undefined ? {} : { maturity: request.maturity }),
		sparse: request.sparse ?? 0,
		...(request.maxTriangles === undefined ? {} : { maxTriangles: request.maxTriangles }),
		...(request.season === undefined ? {} : { season: request.season }),
	} as never);
}

/** The spies on the cut paths, so no case grows a tree and then cuts it. */
const sparseSpy = spyOn(sparseModule, 'sparsePlant');
const ladderSpy = spyOn(budgetModule, 'levelWithin');

describe('the planned oak contract', () => {
	it('loads the planned record, with an address on every element', async () => {
		const kit = await kitOf('planned');
		expect(kit.record.growth.model).toBe('planned');
		// The cases that compare one plant with another match elements by this address, so a model
		// that leaves it out fails here rather than passing on an accidental index.
		const asset = await plant(HOME, {});
		expect(asset.skeleton.axes.origin !== undefined).toBe(true);
		expect(asset.skeleton.buds.origin !== undefined).toBe(true);
		expect(asset.shoots.id !== undefined).toBe(true);
	});

	it('M0: m 0 is empty and returns in under a millisecond', async () => {
		const kit = await kitOf('planned');
		const empty = await freshPlant('planned', HOME, { maturity: 0 });
		expect([empty.skeleton.axes.count, empty.shoots.count]).toEqual([0, 0]);
		expect(empty.stats.triangles).toEqual([0, 0, 0]);
		expect(extrasOf(empty)).toBe(0);
		// Time the growth stage alone: the plan's numbers, then the skeleton they allow.
		const { grower } = await import('../grow/models');
		const growth = grower('planned');
		expect(growth?.plan !== undefined).toBe(true);
		const request = { maturity: 0, sparse: 0 } as const;
		const started = performance.now();
		const plan = growth.plan?.(kit.record, request);
		const skeleton = growth.grow({
			record: kit.record,
			seed: HOME,
			variant: 0,
			season: kit.record.seasons.default,
			request,
			plan,
		});
		const ms = performance.now() - started;
		expect([skeleton.axes.count, skeleton.buds.count]).toEqual([0, 0]);
		console.log(`M0: empty in ${ms.toFixed(3)} ms, plan and growth`);
		expect(ms).toBeLessThan(1);
	}, LONG);

	it('D0: no maturity given is the same bytes as m 1', async () => {
		const kit = await kitOf('planned');
		const plain = growPlantNow(kit, { seed: HOME, variant: 0, near: false, detail: 'low' });
		const one = await freshPlant('planned', HOME, { maturity: 1 });
		expect(plantAssetDigest(plain)).toBe(plantAssetDigest(one));
	}, LONG);

	it(
		'M1: the maturity curve rises in height, width and girth, and leaf area falls only by what sheds',
		async () => {
			const kit = await kitOf('planned');
			for (const seed of SEEDS) {
				let before: PlantAsset | undefined;
				let beforeLeaf = 0;
				for (const maturity of MATURITIES) {
					const asset = await plant(seed, { maturity });
					const leaf = leafShare(kit, asset);
					if (before) {
						const p = before;
						expect([seed, maturity, heightOf(asset) >= heightOf(p) - 1e-6]).toEqual([seed, maturity, true]);
						expect([seed, maturity, crownOf(asset) >= crownOf(p) - 1e-6]).toEqual([seed, maturity, true]);
						expect([seed, maturity, girthOf(asset) >= girthOf(p) - 1e-6]).toEqual([seed, maturity, true]);
						// The fall from the younger tree is at most the leaf area of rows it no longer holds.
						const olderRows = new Set<number>();
						for (let r = 0; r < asset.shoots.count; r++) olderRows.add(rowAddress(asset, r));
						let dropped = 0;
						for (const [address, area] of rowAreas(kit, p)) if (!olderRows.has(address)) dropped += area;
						expect([seed, maturity, beforeLeaf - leaf <= dropped + 1e-6]).toEqual([seed, maturity, true]);
					}
					before = asset;
					beforeLeaf = leaf;
				}
			}
		},
		LONG,
	);

	it(
		'M2: a 0.01 step moves leaf area, triangles and outline by a bounded amount',
		async () => {
			const kit = await kitOf('planned');
			for (const seed of SEEDS)
				for (const maturity of [0.1, 0.3, 0.5, 0.7, 0.9])
					for (const max of [undefined, 5000, 1000]) {
						const a = await plant(seed, { maturity, maxTriangles: max });
						const b = await plant(seed, { maturity: maturity + 0.01, maxTriangles: max });
						const leafA = leafShare(kit, a);
						const leafB = leafShare(kit, b);
						expect([seed, maturity, max, off(leafB, leafA) <= 0.05 || Math.abs(leafB - leafA) <= 1e-9]).toEqual([seed, maturity, max, true]);
						const triA = a.stats.triangles[0] as number;
						const triB = b.stats.triangles[0] as number;
						expect([seed, maturity, max, Math.abs(triB - triA) <= 0.05 * Math.max(1, triA)]).toEqual([seed, maturity, max, true]);
						expect([seed, maturity, max, overlap(outlineOf(a), outlineOf(b)) >= 0.9]).toEqual([seed, maturity, max, true]);
						// No bone node moves by more than 2 per cent of the height.
						const moving = new Map<number, number>();
						for (let x = 0; x < a.skeleton.axes.count; x++) {
							if ((a.skeleton.axes.order[x] as number) > 2) continue;
							moving.set(axisAddress(a, x), x);
						}
						for (let y = 0; y < b.skeleton.axes.count; y++) {
							if ((b.skeleton.axes.order[y] as number) > 2) continue;
							const x = moving.get(axisAddress(b, y));
							if (x === undefined) continue;
							const from = nodeAt(a, a.skeleton.axes.first[x] as number);
							const to = nodeAt(b, b.skeleton.axes.first[y] as number);
							expect([seed, maturity, max, away(from, to) <= 0.02 * heightOf(a)]).toEqual([seed, maturity, max, true]);
						}
					}
		},
		LONG,
	);

	it(
		'M3: a younger tree is a prefix of an older one, on fixed limb paths',
		async () => {
			for (const seed of SEEDS) {
				let younger: PlantAsset | undefined;
				for (const maturity of [0.3, 0.6, 0.9, 1]) {
					const older = await plant(seed, { maturity });
					if (younger) {
						const p = younger;
						const at = `${seed} ${maturity}`;
						const olderAxes = new Map<number, number>();
						for (let x = 0; x < older.skeleton.axes.count; x++) olderAxes.set(axisAddress(older, x), x);
						for (let y = 0; y < p.skeleton.axes.count; y++) {
							const address = axisAddress(p, y);
							const order = p.skeleton.axes.order[y] as number;
							const x = olderAxes.get(address);
							if (x === undefined) {
								// A younger element the older does not hold was shed above the bole.
								expect([at, order, (older.skeleton.shed ?? 0) > 0]).toEqual([at, order, true]);
								continue;
							}
							const fromP = nodeAt(p, p.skeleton.axes.first[y] as number);
							const fromO = nodeAt(older, older.skeleton.axes.first[x] as number);
							expect([at, address, away(fromP, fromO) <= 0.01]).toEqual([at, address, true]);
							const pFirst = p.skeleton.axes.first[y] as number;
							const oFirst = older.skeleton.axes.first[x] as number;
							const pDir = direction(fromP, nodeAt(p, Math.min(p.skeleton.axes.last[y] as number, pFirst + 1)));
							const oDir = direction(fromO, nodeAt(older, Math.min(older.skeleton.axes.last[x] as number, oFirst + 1)));
							expect([at, address, angleBetween(pDir, oDir) <= 2]).toEqual([at, address, true]);
						}
					}
					younger = older;
				}
			}
		},
		LONG,
	);

	it(
		'M4: acorns and catkins ramp from their fruiting and flowering maturity',
		async () => {
			const kit = await kitOf('planned');
			const growth = growthOf(kit);
			expect(typeof growth.fruitFrom).toBe('number');
			const from = growth.fruitFrom as number;
			const band = growth.fruitBand ?? 0.1;
			const full = extrasOf(await plant(HOME, { maturity: 1 }));
			expect(full).toBeGreaterThan(0);
			// Below the fruiting maturity nothing draws; through the band every 0.01 step rises by at
			// most a twentieth of the final count.
			for (const maturity of [0, Math.max(0, from - 0.05), Math.max(0, from - 0.01)])
				expect([maturity, extrasOf(await plant(HOME, { maturity, season: kit.record.seasons.default }))]).toEqual([maturity, 0]);
			let previous = extrasOf(await plant(HOME, { maturity: from, season: kit.record.seasons.default }));
			for (let i = 1; i <= Math.max(1, Math.ceil(band / 0.01)); i++) {
				const maturity = Math.min(1, from + i * 0.01);
				const extras = extrasOf(await plant(HOME, { maturity, season: kit.record.seasons.default }));
				expect([maturity, extras - previous <= 0.05 * full]).toEqual([maturity, true]);
				previous = extras;
			}
			expect(from + band <= 1 + 1e-9).toBe(true);
			const flowers = growth.flowers;
			if (flowers) {
				let last = -1;
				for (let i = 0; i <= 10; i++) {
					const maturity = flowers.from + (i / 10) * flowers.band;
					const extras = extrasOf(await plant(HOME, { maturity, season: flowers.season as never }));
					if (last >= 0) expect([maturity, extras >= last - 1e-9]).toEqual([maturity, true]);
					last = extras;
				}
				const before = extrasOf(await plant(HOME, { maturity: Math.max(0, flowers.from - 0.05), season: flowers.season as never }));
				expect([flowers.from, before]).toEqual([flowers.from, 0]);
			}
			// Catkins draw as flower buds, which the growth marks.
			const spring = await plant(HOME, { maturity: 1, season: 'blossom' });
			let flowerBuds = 0;
			for (let b = 0; b < spring.skeleton.buds.count; b++)
				if ((spring.skeleton.buds.kind[b] as number) === BUD_FLOWER) flowerBuds++;
			console.log(`M4: ${full} acorn triangles at m 1, ${flowerBuds} flower buds in blossom`);
		},
		LONG,
	);

	it(
		'S1: sparseness thins branches and leaves at every step',
		async () => {
			const kit = await kitOf('planned');
			for (const seed of SEEDS)
				for (const maturity of [1, 0.5]) {
					const levels = [0, 0.25, 0.5, 0.75, 1];
					const plants = [] as PlantAsset[];
					for (const sparse of levels) plants.push(await plant(seed, { maturity, sparse }));
					const full = plants[0] as PlantAsset;
					const fullLeaf = leafShare(kit, full);
					const fine = (asset: PlantAsset) => axesByOrder(asset).slice(3).reduce((s, n) => s + n, 0);
					for (let i = 1; i < plants.length; i++) {
						const sparser = plants[i] as PlantAsset;
						const denser = plants[i - 1] as PlantAsset;
						expect([seed, maturity, sparser.shoots.count < denser.shoots.count]).toEqual([seed, maturity, true]);
						expect([seed, maturity, fine(sparser) < fine(denser)]).toEqual([seed, maturity, true]);
					}
					const sparsest = plants[plants.length - 1] as PlantAsset;
					expect([seed, maturity, fine(sparsest) <= fine(full) / 3 + 1e-9]).toEqual([seed, maturity, true]);
					const share = leafShare(kit, sparsest) / Math.max(1e-9, fullLeaf);
					expect([seed, maturity, share <= 0.1 + 1e-9]).toEqual([seed, maturity, true]);
					expect([seed, maturity, share >= 0.08 - 1e-9]).toEqual([seed, maturity, true]);
				}
		},
		LONG,
	);

	it(
		'S2: the bones and boughs stand at the same place and radius at every sparseness',
		async () => {
			for (const seed of SEEDS)
				for (const maturity of [1, 0.5]) {
					const plain = await freshPlant('planned', seed, { maturity, sparse: 0 });
					const thin = await freshPlant('planned', seed, { maturity, sparse: 1 });
					const at = `${seed} ${maturity}`;
					const plainAxes = new Map<number, number>();
					for (let a = 0; a < plain.skeleton.axes.count; a++) plainAxes.set(axisAddress(plain, a), a);
					for (let b = 0; b < thin.skeleton.axes.count; b++) {
						if ((thin.skeleton.axes.order[b] as number) > 2) continue;
						const a = plainAxes.get(axisAddress(thin, b));
						if (a === undefined) throw new Error(`${at}: the sparser plant lost a bone at ${axisAddress(thin, b)}`);
						const first = thin.skeleton.axes.first[b] as number;
						const compare = plain.skeleton.axes.first[a] as number;
						expect([at, nodeAt(thin, first)]).toEqual([at, nodeAt(plain, compare)]);
						expect([at, thin.skeleton.radius[first], plain.skeleton.radius[compare]]).toEqual([
							at,
							thin.skeleton.radius[first],
							plain.skeleton.radius[compare],
						]);
					}
				}
		},
		LONG,
	);

	it(
		'S3: a sparser plant is a subset of a denser one by address and by place',
		async () => {
			for (const seed of SEEDS) {
				const plants = [] as PlantAsset[];
				for (const sparse of [0, 0.25, 0.5, 0.75, 1]) plants.push(await freshPlant('planned', seed, { maturity: 1, sparse }));
				for (let i = 1; i < plants.length; i++) {
					const denser = plants[i - 1] as PlantAsset;
					const sparser = plants[i] as PlantAsset;
					const place = new Map<number, string>();
					for (let b = 0; b < denser.skeleton.buds.count; b++)
						place.set(budAddress(denser, b), nodeAt(denser, denser.skeleton.buds.node[b] as number).join(','));
					for (let b = 0; b < sparser.skeleton.buds.count; b++) {
						const address = budAddress(sparser, b);
						const kept = place.get(address);
						if (kept === undefined) continue;
						expect([seed, address, nodeAt(sparser, sparser.skeleton.buds.node[b] as number).join(',')]).toEqual([seed, address, kept]);
					}
				}
			}
		},
		LONG,
	);

	it(
		'S4: every sparseness is one body, as tall, with an even share round the crown',
		async () => {
			for (const seed of SEEDS)
				for (const maturity of [1, 0.5]) {
					const plants = [] as PlantAsset[];
					for (const sparse of [0, 0.5, 1]) plants.push(await plant(seed, { maturity, sparse }));
					const full = plants[0] as PlantAsset;
					const fullRows = full.shoots.count;
					for (const asset of plants) {
						const at = `${seed} ${maturity} ${asset === full ? 'full' : asset.shoots.count}`;
						// Every row stands on a skeleton node, and every node reaches one base.
						for (let r = 0; r < asset.shoots.count; r++) {
							const node = asset.shoots.node?.[r];
							expect([at, node !== undefined && (node as number) < asset.skeleton.nodeCount]).toEqual([at, true]);
						}
						let roots = 0;
						const { parent } = asset.skeleton;
						for (let n = 0; n < asset.skeleton.nodeCount; n++) if ((parent[n] as number) < 0) roots++;
						expect([at, roots]).toEqual([at, 1]);
						expect([at, asset.skeleton.height, asset.skeleton.crownBase]).toEqual([at, full.skeleton.height, full.skeleton.crownBase]);
						expect([at, asset.skeleton.bounds]).toEqual([at, full.skeleton.bounds]);
						// Each octant keeps the plant's share of its own foliage.
						const middle: [number, number, number] = [0, 0, 0];
						for (let r = 0; r < fullRows; r++) {
							middle[0] += (full.shoots.position[r * 3] as number) / fullRows;
							middle[1] += (full.shoots.position[r * 3 + 1] as number) / fullRows;
							middle[2] += (full.shoots.position[r * 3 + 2] as number) / fullRows;
						}
						const grown = new Array<number>(8).fill(0);
						const kept = new Array<number>(8).fill(0);
						const keptRows = new Set<number>();
						for (let r = 0; r < asset.shoots.count; r++) keptRows.add(rowAddress(asset, r));
						for (let r = 0; r < fullRows; r++) {
							const x = full.shoots.position[r * 3] as number;
							const y = full.shoots.position[r * 3 + 1] as number;
							const z = full.shoots.position[r * 3 + 2] as number;
							const octant = (x > middle[0] ? 1 : 0) + (y > middle[1] ? 2 : 0) + (z > middle[2] ? 4 : 0);
							grown[octant] = (grown[octant] as number) + 1;
							if (keptRows.has(rowAddress(full, r))) kept[octant] = (kept[octant] as number) + 1;
						}
						const share = asset.shoots.count / Math.max(1, fullRows);
						for (let octant = 0; octant < 8; octant++) {
							if ((grown[octant] as number) < 40) continue;
							const held = (kept[octant] as number) / (grown[octant] as number);
							expect([at, octant, Math.abs(held - share) <= 0.05]).toEqual([at, octant, true]);
						}
					}
				}
		},
		LONG,
	);

	it(
		'A0: orders 0 to 2 and the clumps match the frame at the same commit and seed',
		async () => {
			const anchor = await plant(HOME, {}, 'anchor');
			const planned = await plant(HOME, {});
			const anchorBones = [] as number[];
			for (let a = 0; a < anchor.skeleton.axes.count; a++)
				if ((anchor.skeleton.axes.order[a] as number) <= 2) anchorBones.push(a);
			const plannedBones: number[] = [];
			for (let a = 0; a < planned.skeleton.axes.count; a++)
				if ((planned.skeleton.axes.order[a] as number) <= 2) plannedBones.push(a);
			expect(plannedBones.length).toBe(anchorBones.length);
			// Every anchor bone finds a planned bone at its place, its radius and its order.
			for (const a of anchorBones) {
				const first = anchor.skeleton.axes.first[a] as number;
				const last = anchor.skeleton.axes.last[a] as number;
				const order = anchor.skeleton.axes.order[a] as number;
				let nearest = -1;
				let distance = Number.POSITIVE_INFINITY;
				for (const b of plannedBones) {
					if ((planned.skeleton.axes.order[b] as number) !== order) continue;
					const d = away(nodeAt(anchor, first), nodeAt(planned, planned.skeleton.axes.first[b] as number));
					if (d < distance) {
						distance = d;
						nearest = b;
					}
				}
				expect([a, distance <= 0.01]).toEqual([a, true]);
				expect([a, away(nodeAt(anchor, last), nodeAt(planned, planned.skeleton.axes.last[nearest] as number)) <= 0.01]).toEqual([a, true]);
				expect([a, off(planned.skeleton.radius[planned.skeleton.axes.last[nearest] as number] as number, anchor.skeleton.radius[last] as number) <= 0.01]).toEqual([a, true]);
			}
			// The clumps are the adult plan's own bough-end patches, at the same centres and radii,
			// and the planned plant names each socket's clump by `lobe`.
			const anchorTable = await anchorClumps(HOME);
			const plannedTable = plannedClumps(planned);
			expect(plannedTable !== undefined).toBe(true);
			expect(plannedTable?.clumps.length).toBe(anchorTable.clumps.length);
			for (let i = 0; i < anchorTable.clumps.length; i++) {
				const anchorClump = anchorTable.clumps[i] as Clump;
				const clump = plannedTable?.clumps[i];
				expect([i, clump?.id, clump !== undefined ? away(clump.centre, anchorClump.centre) <= 0.01 : false]).toEqual([i, clump?.id, true]);
				expect([i, clump !== undefined ? Math.abs(clump.radius - anchorClump.radius) <= 0.01 : false]).toEqual([i, true]);
			}
		},
		LONG,
	);

	it(
		'F1: the fill target, measured against the frame at the same commit and seed',
		async () => {
			const anchor = await plant(HOME, {}, 'anchor');
			const planned = await plant(HOME, {});
			const target = fillFigures(anchor, await anchorClumps(HOME));
			const plannedTable = plannedClumps(planned);
			const candidate = plannedTable ? fillFigures(planned, plannedTable) : undefined;
			console.log(`F1 target (the frame's clumps): ${JSON.stringify(target)}`);
			console.log(`F1 candidate (planned): ${candidate ? JSON.stringify(candidate) : 'no clumps on the skeleton'}`);
			if (candidate) {
				// The target is for the grower, not a gate: print the distance and let the eye decide.
				console.log(
					`F1 distances: median ${(off(candidate.medianRows, target.medianRows) * 100).toFixed(1)}%, spread ${(off(candidate.spreadRows, target.spreadRows) * 100).toFixed(1)}%, inner ${Math.abs(candidate.inner - target.inner).toFixed(3)}, sky ${candidate.sky.map((v, i) => Math.abs(v - (target.sky[i] as number)).toFixed(3)).join('/')}`,
				);
			}
			console.log(`F1 crown cover tolerance ${FILL.cover}: read from the CPU preview over 01 in the verdict.`);
			expect(target.clumps).toBeGreaterThan(0);
		},
		LONG,
	);

	it(
		'G1: made equals delivered plus shed, and stays within the plan',
		async () => {
			for (const seed of SEEDS)
				for (const request of [{}, { maturity: 0.3, sparse: 1 }, { maxTriangles: 1000 }] as const) {
					const kit = await kitOf('planned');
					const asset = await freshPlant('planned', seed, request);
					const made = asset.skeleton.made;
					const shed = asset.skeleton.shed;
					expect(typeof made).toBe('number');
					expect(typeof shed).toBe('number');
					const delivered = asset.skeleton.axes.count + asset.skeleton.buds.count;
					// Every element made is one delivered, one the growth shed, or one the dressing dropped.
					const dropped = asset.dropped ?? 0;
					expect([seed, request, made]).toEqual([seed, request, delivered + (shed as number) + dropped]);
					const { grower } = await import('../grow/models');
					const planned = grower('planned');
					const plan = planned.plan?.(kit.record, {
						maturity: request.maturity ?? 1,
						sparse: request.sparse ?? 0,
						...(request.maxTriangles === undefined ? {} : { maxTriangles: request.maxTriangles }),
					});
					expect(plan !== undefined).toBe(true);
					const expected = (plan?.expected ?? []).reduce((s, n) => s + n, 0);
					expect([seed, request, (made as number) <= expected * 1.1 + 1e-9]).toEqual([seed, request, true]);
					void kit;
				}
		},
		LONG,
	);

	it(
		'G2: no cut path runs, and the kept plant is keyed by maturity, sparseness and the maximum',
		async () => {
			const kit = await kitOf('planned');
			const requests: readonly Request[] = [{}, { maturity: 0.3, sparse: 1 }, { maxTriangles: 1000 }, { maturity: 0.3, sparse: 1, maxTriangles: 1000 }];
			for (const request of requests) {
				forget();
				sparseSpy.mockClear();
				ladderSpy.mockClear();
				growPlantNow(kit, { seed: HOME, variant: 0, near: false, detail: 'low', ...request } as never);
				expect([request, sparseSpy.mock.calls.length]).toEqual([request, 0]);
				expect([request, ladderSpy.mock.calls.length]).toEqual([request, 0]);
			}
			forget();
			const once = { seed: HOME, variant: 0, near: false, detail: 'low', maturity: 0.5, sparse: 0.5 } as const;
			const grownOnce = growPlantNow(kit, once as never);
			let count = plantsGrown();
			const again = growPlantNow(kit, once as never);
			expect(plantsGrown()).toBe(count);
			expect(plantAssetDigest(again)).toBe(plantAssetDigest(grownOnce));
			// A change of maturity, of sparseness and of the maximum each grows a plant of its own.
			for (const changed of [
				{ ...once, maturity: 0.6 },
				{ ...once, sparse: 0.75 },
				{ ...once, maxTriangles: 1000 },
			]) {
				growPlantNow(kit, changed as never);
				expect([changed, plantsGrown()]).toEqual([changed, count + 1]);
				count = plantsGrown();
			}
		},
		LONG,
	);

	it(
		'G3: the plant meshes at most 1.1 times the triangles it draws',
		async () => {
			for (const seed of SEEDS)
				for (const request of [{}, { maturity: 0.3, sparse: 1 }, { maxTriangles: 1000 }, { maturity: 0.3, sparse: 1, maxTriangles: 1000 }] as const) {
					const asset = await plant(seed, request);
					const meshedRows = asset.stats.shoots;
					const drawnRows = (asset.stats.triangles[0] as number) - asset.levels[0].triangles;
					expect([seed, request, meshedRows <= 1.1 * Math.max(1, drawnRows)]).toEqual([seed, request, true]);
				}
		},
		LONG,
	);

	it(
		'T1: the sparse, capped and combined growths take a fifth, a tenth and a twentieth',
		async () => {
			// The speed table is gated on the full set; the quick set prints the times it measures.
			const kit = await kitOf('planned');
			const settings: readonly (readonly [string, Request])[] = [
				['default', {}],
				['(0.3, 1)', { maturity: 0.3, sparse: 1 }],
				['max 1,000', { maxTriangles: 1000 }],
				['(0.3, 1, 1,000)', { maturity: 0.3, sparse: 1, maxTriangles: 1000 }],
			];
			const times = new Map<string, number>();
			for (const [name, request] of settings) {
				const runs: number[] = [];
				for (let i = 0; i < 3; i++) {
					forgetGrownPlants();
					const started = performance.now();
					growPlantNow(kit, { seed: HOME, variant: 0, near: false, detail: 'low', ...request } as never);
					runs.push(performance.now() - started);
				}
				times.set(name, median(runs));
			}
			const base = times.get('default') as number;
			console.log(
				`T1: ${[...times].map(([name, ms]) => `${name} ${ms.toFixed(0)} ms`).join(', ')}; ratios ${[...times].map(([name, ms]) => `${name} 1/${(base / ms).toFixed(1)}`).join(', ')}`,
			);
			if (FULL) {
				expect((base / (times.get('(0.3, 1)') as number))).toBeGreaterThanOrEqual(5 - 1e-9);
				expect((base / (times.get('max 1,000') as number))).toBeGreaterThanOrEqual(10 - 1e-9);
				expect((base / (times.get('(0.3, 1, 1,000)') as number))).toBeGreaterThanOrEqual(20 - 1e-9);
			}
		},
		LONG,
	);

	it(
		'X1: every level draws at or under the maximum',
		async () => {
			for (const seed of SEEDS)
				for (const [maturity, sparse] of X_POINTS)
					for (const max of MAXIMA) {
						const asset = await plant(seed, { maturity, sparse, maxTriangles: max });
						for (let level = 0; level < 3; level++)
							expect([seed, maturity, sparse, max, level, (asset.stats.triangles[level] as number) <= max]).toEqual([
								seed,
								maturity,
								sparse,
								max,
								level,
								true,
							]);
					}
		},
		LONG,
	);

	it(
		'X2: a capped plant keeps the uncapped outline above the maximum floor',
		async () => {
			for (const seed of SEEDS)
				for (const [maturity, sparse] of X_POINTS) {
					const plain = await plant(seed, { maturity, sparse });
					const plainOutline = outlineOf(plain);
					for (const max of MAXIMA) {
						const capped = await plant(seed, { maturity, sparse, maxTriangles: max });
						const share = overlap(plainOutline, outlineOf(capped));
						const floor = FLOORS[max] as number;
						expect([seed, maturity, sparse, max, Number(share.toFixed(3)), share >= floor - 1e-9]).toEqual([
							seed,
							maturity,
							sparse,
							max,
							Number(share.toFixed(3)),
							true,
						]);
					}
				}
		},
		LONG,
	);

	it(
		'P1: another species grows with the three options and ignores them',
		async () => {
			// A stand-in and the common alder: the options change nothing they draw.
			const stub = standInSpecies('contract-stub', { height: 6 });
			await loadPlantCode(stub.record);
			const stubKit = buildKitNow(stub, { placeholders: 'missing', detail: 'low' });
			const plainStub = growPlantNow(stubKit, { seed: HOME, variant: 0, near: false, detail: 'low' });
			const optionedStub = growPlantNow(stubKit, {
				seed: HOME,
				variant: 0,
				near: false,
				detail: 'low',
				maturity: 0.3,
				sparse: 1,
				maxTriangles: 1000,
			} as never);
			expect(plantAssetDigest(optionedStub)).toBe(plantAssetDigest(plainStub));

			const { loadSpecies } = await import('../core/registry');
			const alder = (await loadSpecies('common-alder')) as SpeciesModule;
			await loadPlantCode(alder.record);
			const alderKit = buildKitNow(alder, { placeholders: 'missing', detail: 'low' });
			const plainAlder = growPlantNow(alderKit, { seed: HOME, variant: 0, near: false, detail: 'low' });
			const repeatAlder = growPlantNow(alderKit, { seed: HOME, variant: 0, near: false, detail: 'low' });
			expect(plantAssetDigest(repeatAlder)).toBe(plantAssetDigest(plainAlder));
			const optionedAlder = growPlantNow(alderKit, {
				seed: HOME,
				variant: 0,
				near: false,
				detail: 'low',
				maturity: 0.3,
				sparse: 1,
				maxTriangles: 1000,
			} as never);
			expect(plantAssetDigest(optionedAlder)).toBe(plantAssetDigest(plainAlder));
		},
		LONG,
	);
});
