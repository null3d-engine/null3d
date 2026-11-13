// Sparseness takes foliage and the branches that carried it out of one grown plant. These tests
// state its contracts over trees, a shrub, ground plants and a cactus: a sparser plant is a subset
// of every denser one, it is one body joined to its root, its counts fall, its height and trunk
// hold, the removal is even round the crown and through its height, and a change of sparseness cuts
// the plant that is kept as grown and grows nothing again.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from './asset';
import { speciesProblems } from './core/check';
import type { Species, SpeciesModule } from './core/record';
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
import {
	FOLIAGE_FLOOR,
	GREAT_LIMB_SHARE,
	rowSockets,
	sparseKeep,
	sparseOrder,
	sparsePlant,
	structuralAxes,
} from './grow/sparse';
import { cardRows } from './lod/cards';
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

/**
 * How far a quarter round a plant of sockets may stand from the plant's kept share, and the fewest
 * sockets a quarter holds before it is judged: a plant thinned from one side stands half a share
 * off.
 */
const QUARTER_SLACK = 0.2;
const QUARTER_LEAST = 8;

/** The least share of the plant's kept share that a quarter round it keeps of its own sockets. */
const QUARTER_RATIO = 0.5;

/**
 * How far apart the kept shares of the sockets at the axes' tips and the sockets along the axes may
 * stand at half sparseness: a plant that keeps its tips and strips its limbs stands 0.58 apart.
 */
const ALONG_SLACK = 0.3;

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
		const nodes: string[] = [];
		for (let n = first; n <= last; n++)
			nodes.push(keyOf(position.subarray(n * 3, n * 3 + 3), radius.subarray(n, n + 1)));
		out.set(
			axes.origin?.[a] ?? a,
			`${keyOf([axes.kind[a] as number, axes.order[a] as number, axes.parentT[a] as number])}#${nodes.join(';')}`,
		);
	}
	return out;
}

/**
 * Whether an axis of a sparser plant is one the denser plant holds: the same axis from its base,
 * to the bit, ending at or before the denser one's end, since a plant of sockets cuts an axis back
 * to its last kept piece.
 */
function sameAxis(sparser: string, denser: string | undefined): boolean {
	if (denser === undefined) return false;
	const [head, nodes] = sparser.split('#') as [string, string];
	const [denserHead, denserNodes] = denser.split('#') as [string, string];
	return head === denserHead && (denserNodes === nodes || denserNodes.startsWith(`${nodes};`));
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

/**
 * Where each foliage carrier of a plant stands: its sockets on a plant of sockets, each with all its
 * rows, its shoot rows, or its end axes' tips. A carrier keeps its number as grown.
 */
function carriers(asset: PlantAsset): Map<number, readonly [number, number, number]> {
	const out = new Map<number, readonly [number, number, number]>();
	const rows = asset.shoots;
	const { buds } = asset.skeleton;
	const sockets = rowSockets(asset.skeleton, rows);
	if (sockets) {
		for (let r = 0; r < rows.count; r++) {
			const b = sockets[r] as number;
			out.set(buds.origin?.[b] ?? b, [
				buds.position[b * 3] as number,
				buds.position[b * 3 + 1] as number,
				buds.position[b * 3 + 2] as number,
			]);
		}
		return out;
	}
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
	return Math.max(top, cardTop(kit, asset.shoots));
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
							expect([at, axis, sameAxis(key, denserAxes.get(axis))]).toEqual([at, axis, true]);
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
							for (const grow of cardRows(input, level)) if (grow > 0) share++;
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
					// The sparsest plant keeps the floor's share of its carriers, to the whole carrier.
					const floor = kit.record.sparse?.foliage ?? FOLIAGE_FLOOR;
					const sparsest = carriers(plants[plants.length - 1] as PlantAsset).size;
					expect([id, seed, sparsest >= Math.floor(fullCarriers.size * floor)]).toEqual([
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
				const full = growPlantNow(kit, options);
				const grown = plantsGrown();
				// A change of sparseness cuts the kept plant: the count of growths shows no new one. Its
				// time is no proof on a shared machine, where a cheap plant's growth and cut both swing
				// by several times between runs.
				const half = growPlantNow(kit, { ...options, sparse: 0.5 });
				const sparsest = growPlantNow(kit, { ...options, sparse: 1 });
				expect(plantsGrown()).toBe(grown);
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

/** The plants of sockets: a tuft of pieces, and the pine and the oak as directed frames. */
const SOCKET_PLANTS: readonly (readonly [name: string, load: () => Promise<SpeciesModule>])[] = [
	['sedge', () => loadSpecies('sedge')],
	[
		'directed Scots pine',
		async () => ({
			record: (await import('./species/scots-pine/directed')).directed as Species,
			textures: (await import('@null3d/vegetation-textures/scots-pine')).files,
		}),
	],
	[
		'directed pedunculate oak',
		async () => ({
			record: (await import('./species/pedunculate-oak/directed')).directed as Species,
			textures: (await import('@null3d/vegetation-textures/pedunculate-oak')).files,
		}),
	],
];

for (const [name, load] of SOCKET_PLANTS)
	describe(`sparseness on the ${name}, a plant of sockets`, () => {
		it(
			'keeps whole sockets, evenly round the crown, and only the wood that carries them',
			async () => {
				const module = await load();
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
				const full = growPlantNow(kit, { seed: 11, variant: 0 });
				const { skeleton, shoots } = full;
				const sockets = rowSockets(skeleton, shoots) as Uint32Array;
				expect([name, sockets !== undefined]).toEqual([name, true]);
				const rank = skeleton.buds.sockets?.rank as Uint32Array;
				const limbs = kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE;
				const floor = kit.record.sparse?.foliage ?? FOLIAGE_FLOOR;
				const order = sparseOrder(skeleton, shoots, limbs, [], floor);
				expect(order.bySockets).toBe(true);
				const rowsOf = new Map<number, number>();
				for (let r = 0; r < shoots.count; r++)
					rowsOf.set(sockets[r] as number, (rowsOf.get(sockets[r] as number) ?? 0) + 1);
				expect(order.carriers).toBe(rowsOf.size);
				const structural = structuralAxes(skeleton, limbs);
				for (const sparse of [0.5, 1]) {
					const at = `${name} sparse ${sparse}`;
					const keep = sparseKeep(order, sparse, kit.record.sparse?.foliage ?? FOLIAGE_FLOOR);
					const thinned = sparsePlant(skeleton, shoots, order, keep);
					if (!thinned) throw new Error(`${at}: nothing went`);
					// Whole sockets: each socket that stays keeps every row it held.
					const kept = new Map<number, number>();
					for (let r = 0; r < thinned.rows.count; r++) {
						const socket = sockets[thinned.rows.id?.[r] ?? r] as number;
						kept.set(socket, (kept.get(socket) ?? 0) + 1);
					}
					expect([at, kept.size < rowsOf.size]).toEqual([at, true]);
					for (const [socket, count] of kept)
						expect([at, socket, count]).toEqual([at, socket, rowsOf.get(socket) ?? -1]);
					// Even round the crown: each octant about the foliage's middle keeps the plant's
					// share of its own sockets.
					const middle = [0, 0, 0];
					for (let r = 0; r < shoots.count; r++)
						for (let k = 0; k < 3; k++)
							middle[k] =
								(middle[k] as number) + (shoots.position[r * 3 + k] as number) / shoots.count;
					const grownIn = new Array<number>(8).fill(0);
					const keptIn = new Array<number>(8).fill(0);
					const counted = new Set<number>();
					for (let r = 0; r < shoots.count; r++) {
						const socket = sockets[r] as number;
						if (counted.has(socket)) continue;
						counted.add(socket);
						let octant = 0;
						for (let k = 0; k < 3; k++)
							if ((shoots.position[r * 3 + k] as number) > (middle[k] as number)) octant += 1 << k;
						grownIn[octant] = (grownIn[octant] as number) + 1;
						if (kept.has(socket)) keptIn[octant] = (keptIn[octant] as number) + 1;
					}
					const share = kept.size / rowsOf.size;
					for (let octant = 0; octant < 8; octant++) {
						const grown = grownIn[octant] as number;
						if (grown < OCTANT_LEAST) continue;
						const off = Math.abs((keptIn[octant] as number) / grown - share);
						expect([at, octant, off <= OCTANT_SLACK]).toEqual([at, octant, true]);
					}
					// The sockets that stay keep their records: size, rank, mass and piece. A socket whose
					// place holds no kept piece leaves with it.
					const buds = thinned.skeleton.buds;
					const grownSockets = skeleton.buds.sockets as NonNullable<typeof skeleton.buds.sockets>;
					expect([at, buds.sockets?.rank.length]).toEqual([at, buds.count]);
					for (let b = 0; b < buds.count; b++) {
						const origin = buds.origin?.[b] ?? b;
						expect([
							at,
							b,
							buds.sockets?.scale[b],
							buds.sockets?.rank[b],
							buds.sockets?.lobe[b],
							buds.sockets?.piece?.[b],
						]).toEqual([
							at,
							b,
							grownSockets.scale[origin],
							rank[origin],
							grownSockets.lobe[origin],
							grownSockets.piece?.[origin],
						]);
					}
					const emptied = rowSockets(thinned.skeleton, thinned.rows) as Uint32Array;
					expect([at, new Set(emptied).size]).toEqual([at, kept.size]);
					// Not from one side: each quarter round the plant, by bearing, keeps its share of its
					// sockets within the band, and at the sparsest no octant whose share is two sockets or
					// more is stripped bare.
					const quarterOf = (socket: number) => {
						const x = (skeleton.buds.position[socket * 3] as number) - (middle[0] as number);
						const z = (skeleton.buds.position[socket * 3 + 2] as number) - (middle[2] as number);
						return (x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0);
					};
					const quarterGrown = [0, 0, 0, 0];
					const quarterKept = [0, 0, 0, 0];
					for (const socket of rowsOf.keys()) {
						const q = quarterOf(socket);
						quarterGrown[q] = (quarterGrown[q] as number) + 1;
						if (kept.has(socket)) quarterKept[q] = (quarterKept[q] as number) + 1;
					}
					for (let q = 0; q < 4; q++) {
						const grown = quarterGrown[q] as number;
						if (grown < QUARTER_LEAST) continue;
						const keptShare = (quarterKept[q] as number) / grown;
						const off = Math.abs(keptShare - share);
						expect([at, 'quarter', q, off <= QUARTER_SLACK]).toEqual([at, 'quarter', q, true]);
						// A quarter whose share is a socket or more keeps at least half the plant's share
						// of its own, so a side kept bare fails at any sparseness.
						if (grown * share >= 1)
							expect([at, 'quarter', q, keptShare >= QUARTER_RATIO * share]).toEqual([
								at,
								'quarter',
								q,
								true,
							]);
					}
					if (sparse === 1)
						for (let octant = 0; octant < 8; octant++)
							if ((grownIn[octant] as number) * share >= 2)
								expect([at, 'octant', octant, (keptIn[octant] as number) > 0]).toEqual([
									at,
									'octant',
									octant,
									true,
								]);
					// No branch kept bare for one piece: an axis that grew three sockets or more keeps none of
					// them or at least half. The stems and great limbs stay at every sparseness.
					const perAxis = new Map<number, [number, number]>();
					for (const socket of rowsOf.keys()) {
						const axis = skeleton.buds.axis[socket] as number;
						const count = perAxis.get(axis) ?? [0, 0];
						count[0]++;
						if (kept.has(socket)) count[1]++;
						perAxis.set(axis, count);
					}
					for (const [axis, [grown, held]] of perAxis) {
						if (grown < 3 || structural[axis] === 1) continue;
						expect([at, 'axis', axis, grown, held === 0 || held >= Math.ceil(grown / 2)]).toEqual([
							at,
							'axis',
							axis,
							grown,
							true,
						]);
					}
					// Clothed along its length: at half, the sockets at the axes' tips and the sockets
					// along them keep shares near each other, not the tips alone.
					if (sparse === 0.5) {
						const { axes } = skeleton;
						let tips = 0;
						let tipsKept = 0;
						let others = 0;
						let othersKept = 0;
						for (const socket of rowsOf.keys()) {
							const node = skeleton.buds.node[socket] as number;
							const isTip = node === (axes.last[skeleton.axisOf[node] as number] as number);
							if (isTip) {
								tips++;
								if (kept.has(socket)) tipsKept++;
							} else {
								others++;
								if (kept.has(socket)) othersKept++;
							}
						}
						if (tips >= QUARTER_LEAST && others >= QUARTER_LEAST)
							expect([
								at,
								'along',
								Math.abs(tipsKept / tips - othersKept / others) <= ALONG_SLACK,
							]).toEqual([at, 'along', true]);
					}
					// The wood: every axis is a stem or a great limb, lies under the plant's top, carries
					// a kept socket on itself or on a branch that leaves it, or never carried foliage.
					const axes = thinned.skeleton.axes;
					const carries = new Uint8Array(axes.count);
					for (let r = 0; r < thinned.rows.count; r++)
						for (
							let a = thinned.skeleton.axisOf[thinned.rows.node?.[r] as number] as number;
							a >= 0 && carries[a] !== 1;
							a = axes.parent[a] as number
						)
							carries[a] = 1;
					let highest = 0;
					for (let n = 0; n < thinned.skeleton.nodeCount; n++)
						if (
							(thinned.skeleton.position[n * 3 + 1] as number) >
							(thinned.skeleton.position[highest * 3 + 1] as number)
						)
							highest = n;
					for (
						let a = thinned.skeleton.axisOf[highest] as number;
						a >= 0;
						a = axes.parent[a] as number
					)
						carries[a] = 1;
					for (let a = 0; a < axes.count; a++) {
						const origin = axes.origin?.[a] ?? a;
						expect([
							at,
							a,
							carries[a] === 1 || structural[origin] === 1 || order.carried[origin] === 0,
						]).toEqual([at, a, true]);
					}
				}
				// The levels as the engine grows them: a sparser plant's card levels never draw more cards,
				// and every level stays within its cap.
				const budget = kit.record.lod.budget;
				let denser = full;
				for (const sparse of [0.25, 0.5, 1]) {
					const plant = growPlantNow(kit, { seed: 11, variant: 0, sparse });
					const at = `${name} sparse ${sparse}`;
					for (const level of [1, 2] as const) {
						expect([
							at,
							level,
							trianglesOf(plant, level, 'cards') <= trianglesOf(denser, level, 'cards'),
						]).toEqual([at, level, true]);
						const cap = level === 1 ? budget.lod1Triangles : budget.lod2Triangles;
						expect([at, level, plant.levels[level].triangles <= cap]).toEqual([at, level, true]);
					}
					expect([at, plant.skeleton.buds.sockets?.rank.length]).toEqual([
						at,
						plant.skeleton.buds.count,
					]);
					denser = plant;
				}
			},
			LONG,
		);
	});

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
