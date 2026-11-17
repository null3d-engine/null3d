// A triangle maximum: one plant drawn in no more triangles than a page allows, at any sparseness.
// Without a maximum, a level draws what its best look needs. With one, the maximum is shared out
// across the plant's parts in proportion to what each part holds at that best look: the trunk, the
// great limbs, the branches, the twig wood inside the shoots, the leaves and the extras. Each part
// then steps down a ladder of its own until it fits its share, and a second pass hands what is left
// to the parts that carry the plant's outline first. A level never draws more than the maximum.
//
// The ladders:
// - Wood, part by part: longer edges, so fewer rings and sides; then thinner sections, down to one
//   straight run of three sides for each axis; then only the thickest limbs and branches, the rest
//   folded into the leaf cards; then nothing.
// - Shoots: the shoot rows at the kit's tier, then at each tier below it, whose leaves have fewer
//   outline points, down to one quad a leaf; then one card set for each row; then one card set for
//   each run of neighbouring rows, fewer and larger as the maximum falls, each joined to the wood
//   the level draws; then two planes, then one.
// - Extras: their nearest form, then the coarser forms of the farther levels, then none.
// - A plant whose foliage is one mesh, such as a hosta or a sedge: its tiers, then fewer leaves,
//   flower stems and stalks, taken out evenly as sparseness takes them.
//
// A leaf count, a card count and an extras mesh are priced exactly before anything else is built.
// The wood is priced by a quick count and settled by its own mesh, which is small under a maximum:
// where the quick count was low, the part steps down and the wood is meshed again.
import type { ClusterCount, MeshArrays, PartTriangles, PrototypeArrays, ShootRows } from '../asset';
import { AXIS_LIMB, AXIS_STEM, AXIS_STIPE } from '../core/graph';
import { NotBuiltError } from '../core/not-built';
import { DETAILS, type Detail } from '../core/types';
import { type SilhouetteFrame, shootSilhouette, woodPartSilhouettes } from '../grow/envelope';
import { grower } from '../grow/models';
import { extrasMesh } from '../leaf/extras';
import { writesPieces } from '../leaf/piece-rows';
import type { MeshInput, MeshLevel } from '../stages';
import { woodLadderTriangles, woodPartTriangles } from '../wood/estimate';
import { type TubeDetail, tubeDetail } from '../wood/tube';
import { meshWoodParts, type WoodPlan } from '../wood/wood-mesh';
import {
	type CardCluster,
	cardClusters,
	cardMesh,
	clusterCardMesh,
	clusterTriangles,
	type DrawnWood,
	plannedClumpCards,
	woodSurface,
} from './cards';

/** The parts in the order a maximum serves them: the parts that carry the outline first. */
const PARTS = ['trunk', 'leaves', 'limbs', 'branches', 'extras'] as const;
type Part = (typeof PARTS)[number];

/** The wood parts, as the mesher numbers them. */
const WOOD: readonly Part[] = ['trunk', 'limbs', 'branches'];

/**
 * The steps of the wood ladder: a coarseness and a section sparsity each, from the level's own
 * detail to one straight run of three sides for each axis.
 */
const WOOD_RUNGS: readonly (readonly [coarseness: number, sections: number])[] = [
	[0, 0],
	[0.5, 0],
	[1, 0],
	[1, 0.25],
	[1, 0.5],
	[1, 0.75],
	[1, 1],
];

/** The last step of the wood ladder on which a peeling bark's strips still stand. */
const PEEL_RUNGS = 1;

/** The fewest clusters a level draws with all three card planes; fewer take two planes, then one. */
const THREE_PLANE_CLUSTERS = 4;

/** How many times the wood may be meshed again to settle one level. */
const MOST_BUILDS = 24;

/** The rounds in which what the first shares leave is handed on; the last hands on all of it. */
const HAND_ROUNDS = 4;

/** The steps in which a level thins its extras' sites, and the least share of the sites it draws. */
const EXTRAS_STEPS = 20;
const LEAST_EXTRAS_SHARE = 0.25;

/**
 * The share of a maximum that the crown takes before any part: a crown is what makes the plant read
 * as a tree, so it is bought first and the wood, the branches and the extras share what is left. The
 * clump cards that draw it are priced at the record's own clump-card price.
 */
const CROWN_SHARE = 0.6;

/**
 * The least share of a maximum the trunk and the great limbs take before the leaves, and the part
 * of it the trunk takes: a capped tree keeps a read of wood at any distance.
 */
const SKELETON_SHARE = 0.3;
const SKELETON_TRUNK = 0.55;

/** The least sides a capped trunk's or great limb's tube may draw: below it a tube reads as a pinch. */
const SIDES_LEAST = 5;

/** No triangles in any part. */
export const NO_TRIANGLES: PartTriangles = {
	trunk: 0,
	limbs: 0,
	branches: 0,
	twigs: 0,
	leaves: 0,
	extras: 0,
};

/** No card clusters: a level that draws shoot rows, its own cards or a merged plant's foliage. */
export const NO_CLUSTERS: ClusterCount = { clusters: 0, stalks: 0, free: 0 };

/**
 * The triangles of all the parts together.
 *
 * @param parts The parts' triangles.
 * @returns Their sum.
 * @category api/vegetation
 */
export function partTotal(parts: PartTriangles): number {
	return parts.trunk + parts.limbs + parts.branches + parts.twigs + parts.leaves + parts.extras;
}

/** What one level draws, before quantisation. */
export interface LevelBuild {
	/** The wood, where the level draws any and the growth asked for it. */
	readonly wood?: MeshArrays;
	/** The leaf cards. */
	readonly cards?: MeshArrays;
	/** A merged plant's foliage. */
	readonly foliage?: MeshArrays;
	/** The extras. */
	readonly extras?: MeshArrays;
	/** Each part's triangles as the level draws them. */
	readonly triangles: PartTriangles;
	/** Each part's allowance under a maximum: its share, and what the second pass handed it. */
	readonly allowed?: PartTriangles;
	/**
	 * How the nearest level draws the shoot rows: at a tier, or `none` where it draws cards in
	 * their place. Absent on a card level.
	 */
	readonly shoots?: Detail | 'none';
	/** The card clusters the level draws under a maximum, and how they join the plant. */
	readonly clusters?: ClusterCount;
}

/** What a level is built from. */
export interface BudgetInput {
	/** The dressed variant. */
	readonly mesh: MeshInput;
	/** The part of each skeleton axis: 0 its trunk, 1 a great limb, 2 a branch. */
	readonly parts: Uint8Array;
	/** The shoot rows in the order a walk of the plant meets them; absent on a plant without rows. */
	readonly walk?: Uint32Array;
	/** Whether the nearest level's wood is meshed with the level, or later in the background. */
	readonly wood: boolean;
	/**
	 * The same plant with only its first `keep` foliage carriers, for a merged plant that a maximum
	 * brings below its coarsest form; undefined when nothing goes or the plant cannot thin.
	 */
	readonly thin?: (keep: number) => BudgetInput | undefined;
	/** The foliage carriers the plant holds, where it can thin. */
	readonly carriers?: number;
}

/** The leaf and the twig triangles of one prototype tier, counted once. */
const SPLITS = new WeakMap<PrototypeArrays, readonly [leaves: number, twigs: number]>();

/** A tier's triangles by surface kind: its leaves, and its stems and buds. */
function tierSplit(tier: PrototypeArrays): readonly [number, number] {
	let split = SPLITS.get(tier);
	if (!split) {
		let leaves = 0;
		let twigs = 0;
		// The third colour byte holds the surface kind in steps of 85: 0 on a leaf.
		for (let i = 0; i < tier.indices.length; i += 3)
			if ((tier.colors[(tier.indices[i] as number) * 4 + 2] as number) < 43) leaves++;
			else twigs++;
		split = [leaves, twigs];
		SPLITS.set(tier, split);
	}
	return split;
}

/**
 * The triangles of a plant's shoot rows at a tier, as leaves and as twig wood.
 *
 * @param input The dressed variant.
 * @param rows The rows.
 * @param detail The tier.
 * @returns The leaves' and the twigs' triangles.
 * @category api/vegetation
 */
export function shootPartTriangles(
	input: Pick<MeshInput, 'kit'>,
	rows: ShootRows,
	detail: Detail,
): readonly [leaves: number, twigs: number] {
	const tier = DETAILS.indexOf(detail);
	const perPrototype = input.kit.prototypes.map((prototype) => {
		const arrays = prototype.tiers[tier];
		return arrays ? tierSplit(arrays) : ([0, 0] as const);
	});
	let leaves = 0;
	let twigs = 0;
	for (let r = 0; r < rows.count; r++) {
		const split = perPrototype[rows.prototype[r] as number];
		leaves += split?.[0] ?? 0;
		twigs += split?.[1] ?? 0;
	}
	return [leaves, twigs];
}

/** The extras a dressed variant has built, by form and share, so a level never builds one twice. */
const EXTRAS = new WeakMap<MeshInput, Map<number, MeshArrays | undefined>>();

/**
 * The extras of a dressed variant at a level's form, on a share of their sites: built once for the
 * variant, whichever level or count asks.
 */
function extrasOf(mesh: MeshInput, form: MeshLevel, share = 1): MeshArrays | undefined {
	let built = EXTRAS.get(mesh);
	if (!built) {
		built = new Map();
		EXTRAS.set(mesh, built);
	}
	const key = form * 4096 + Math.round(share * 1024);
	if (!built.has(key))
		built.set(key, extrasMesh(share < 1 ? { ...mesh, extrasShare: share } : mesh, form));
	return built.get(key);
}

/** A mesh's triangles; none for no mesh. */
const trianglesOf = (mesh: MeshArrays | undefined) => (mesh ? mesh.indices.length / 3 : 0);

/** Whether a plant's foliage is one mesh its grower builds, not shoot rows. */
const isMerged = (mesh: MeshInput) => mesh.record.lod.nearFoliage === 'merged';

/**
 * The foliage mesh a plant's grower builds itself at a level: a merged plant's foliage, or the
 * part a plant of written pieces draws beside them, such as a tuft's stool and what lies in the
 * soil under it. A plant of pieces draws none where its grower builds none. A merged plant's
 * leaves are this mesh, so a grower that builds none is a stage not built yet.
 *
 * @param mesh What the level is meshed from.
 * @param level The level.
 * @returns The grower's foliage mesh, or none.
 * @throws {NotBuiltError} When the plant's foliage is merged and its grower builds none.
 * @category api/vegetation
 */
export function mergedFoliage(mesh: MeshInput, level: MeshLevel): MeshArrays | undefined {
	const merged = isMerged(mesh);
	if (!merged && !writesPieces(mesh.record)) return undefined;
	const build = grower(mesh.record.growth.model).foliage;
	if (!build && merged) throw new NotBuiltError(`merged ${mesh.record.growth.model} foliage`);
	return build?.(mesh, level);
}

/**
 * What a level draws at its own best look, with each part's triangles: the level as it stands when
 * no maximum is given.
 *
 * @param input What the level is built from.
 * @param level The level.
 * @returns The level's meshes and counts.
 * @category api/vegetation
 */
export function levelBuild(input: BudgetInput, level: MeshLevel): LevelBuild {
	const { mesh, parts } = input;
	const built = level > 0 || input.wood ? meshWoodParts(mesh, level, parts) : undefined;
	const foliage = mergedFoliage(mesh, level);
	const cards = !isMerged(mesh) && level > 0 ? cardMesh(mesh, level as 1 | 2) : undefined;
	const extras = extrasOf(mesh, level, mesh.extrasShare ?? 1);
	const instanced = level === 0 && !isMerged(mesh) && mesh.rows.count > 0;
	const [leaves, twigs] = instanced ? shootPartTriangles(mesh, mesh.rows, mesh.detail) : [0, 0];
	return {
		...(built ? { wood: built.mesh } : {}),
		...(cards ? { cards } : {}),
		...(foliage ? { foliage } : {}),
		...(extras ? { extras } : {}),
		triangles: {
			trunk: built?.triangles[0] ?? 0,
			limbs: built?.triangles[1] ?? 0,
			branches: built?.triangles[2] ?? 0,
			twigs,
			leaves: leaves + trianglesOf(cards) + trianglesOf(foliage),
			extras: trianglesOf(extras),
		},
		...(instanced ? { shoots: mesh.detail } : {}),
	};
}

/**
 * About what each part of a plant holds at its best look: the nearest level with no maximum. The
 * shares of a maximum follow these counts. The wood is counted quickly, without its mesh.
 *
 * @param input What the plant is built from.
 * @returns Each part's triangles.
 * @category api/vegetation
 */
export function referenceTriangles(input: BudgetInput): PartTriangles {
	const { mesh, parts } = input;
	const tube = tubeDetail(0, mesh.detail, mesh.coarseness ?? 0, mesh.sections ?? 0);
	const wood = woodPartTriangles(mesh, 0, parts, [tube, tube, tube]);
	const [leaves, twigs] = isMerged(mesh)
		? [0, 0]
		: shootPartTriangles(mesh, mesh.rows, mesh.detail);
	return {
		trunk: wood[0],
		limbs: wood[1],
		branches: wood[2],
		twigs,
		leaves: leaves + trianglesOf(mergedFoliage(mesh, 0)),
		extras: trianglesOf(extrasOf(mesh, 0)),
	};
}

/** The side views at which a plant's outline is measured. */
const OUTLINE_VIEWS = 4;

/** Cells over a plant's height in the outline measure. */
const OUTLINE_CELLS = 32;

/** Each part's share of the visible outline, kept for its dressed variant. */
const SHARES = new WeakMap<MeshInput, PartTriangles>();

/**
 * Each part's share of the plant's visible outline, from 0 to 1, which add to one: the cells a part
 * covers over four side views, less the cells the leaf cards stand in front of. The extras have no
 * outline of their own, so their share is their count at the plant's best look against the plant's.
 * A plant whose outline measures nothing shares by its parts' best-look counts.
 *
 * @param input What the level is built from.
 * @param reference What each part holds at the plant's best look.
 * @returns Each part's share.
 * @category api/vegetation
 */
export function visibleShares(input: BudgetInput, reference: PartTriangles): PartTriangles {
	const known = SHARES.get(input.mesh);
	if (known) return known;
	const { mesh, parts } = input;
	const { skeleton, rows } = mesh;
	const height = Math.max(skeleton.height, 0.001);
	const { min, max } = skeleton.bounds;
	const reach =
		Math.max(
			Math.abs(min[0] as number),
			Math.abs(max[0] as number),
			Math.abs(min[2] as number),
			Math.abs(max[2] as number),
			height * 0.1,
		) * 1.25;
	const cell = height / OUTLINE_CELLS;
	const frame: SilhouetteFrame = {
		left: -reach,
		cell,
		cols: Math.ceil((2 * reach) / cell),
		rows: Math.ceil((height * 1.1) / cell),
	};
	const lengths = mesh.kit.prototypes.map((prototype) => prototype.length);
	const cells = { trunk: 0, limbs: 0, branches: 0, shoots: 0 };
	for (let view = 0; view < OUTLINE_VIEWS; view++) {
		const turn = (view * Math.PI) / 2;
		const shoots = shootSilhouette(rows, lengths, turn, frame);
		const wood = woodPartSilhouettes(skeleton, parts, turn, frame);
		for (let k = 0; k < shoots.length; k++) {
			const covered = shoots[k] as number;
			cells.shoots += covered;
			// The wood behind a card does not show.
			const shown = 1 - covered;
			cells.trunk += (wood[0][k] as number) & shown;
			cells.limbs += (wood[1][k] as number) & shown;
			cells.branches += (wood[2][k] as number) & shown;
		}
	}
	const whole = Math.max(1, partTotal(reference));
	const extras = Math.min(1, Math.max(0, reference.extras / whole));
	const visible = 1 - extras;
	const outline = cells.trunk + cells.limbs + cells.branches + cells.shoots;
	let shares: PartTriangles;
	if (outline > 0) {
		const [leaves, twigs] = shootPartTriangles(mesh, rows, mesh.detail);
		const leafShare = leaves + twigs > 0 ? leaves / (leaves + twigs) : 1;
		const each = visible / outline;
		shares = {
			trunk: cells.trunk * each,
			limbs: cells.limbs * each,
			branches: cells.branches * each,
			twigs: cells.shoots * (1 - leafShare) * each,
			leaves: cells.shoots * leafShare * each,
			extras,
		};
	} else
		shares = {
			trunk: reference.trunk / whole,
			limbs: reference.limbs / whole,
			branches: reference.branches / whole,
			twigs: reference.twigs / whole,
			leaves: reference.leaves / whole,
			extras,
		};
	SHARES.set(input.mesh, shares);
	return shares;
}

/** The parts a maximum allocates to, in the order of the record. */
const ALLOCATED = ['trunk', 'limbs', 'branches', 'twigs', 'leaves', 'extras'] as const;

/**
 * A level's allowance for each part within a maximum. A level whose parts at the plant's best look
 * already fit keeps those counts. Otherwise the maximum is shared by each part's visible share: each
 * part takes a whole count, and the rounding remainder goes to the parts with the largest
 * fractions, so the parts add to no more than the maximum.
 *
 * @param max The most triangles the level may draw.
 * @param reference What each part holds at the plant's best look.
 * @param shares Each part's share of the plant's visible outline, which add to one.
 * @returns Each part's allowance.
 * @category api/vegetation
 */
export function allocateLevel(
	max: number,
	reference: PartTriangles,
	shares: PartTriangles,
): PartTriangles {
	if (partTotal(reference) <= max) return { ...reference };
	const room = Math.max(0, Math.floor(max));
	const weights = ALLOCATED.map((part) => Math.max(0, shares[part]));
	let whole = 0;
	for (const weight of weights) whole += weight;
	if (whole <= 0)
		for (let k = 0; k < ALLOCATED.length; k++)
			weights[k] = Math.max(0, reference[ALLOCATED[k] as keyof PartTriangles]);
	whole = 0;
	for (const weight of weights) whole += weight;
	// The crown's share comes off the top; the other parts share what is left by their own weights.
	const crown = Math.min(room, Math.floor(room * CROWN_SHARE));
	const rest = room - crown;
	const wholeRest = ALLOCATED.reduce(
		(sum, part) => (part === 'leaves' ? sum : sum + Math.max(0, shares[part])),
		0,
	);
	const exact = weights.map((weight, k) =>
		ALLOCATED[k] === 'leaves'
			? crown
			: wholeRest > 0
				? (rest * Math.max(0, weight)) / wholeRest
				: 0,
	);
	const allocated = exact.map((value) => Math.floor(value));
	let spent = 0;
	for (const value of allocated) spent += value;
	const order = exact
		.map((value, k) => [value - Math.floor(value), k] as const)
		.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	for (let k = 0; spent < room && k < order.length; k++) {
		const index = (order[k] as readonly [number, number])[1];
		allocated[index] = (allocated[index] as number) + 1;
		spent++;
	}
	return {
		trunk: allocated[0] as number,
		limbs: allocated[1] as number,
		branches: allocated[2] as number,
		twigs: allocated[3] as number,
		leaves: allocated[4] as number,
		extras: allocated[5] as number,
	};
}

/**
 * The detail of a wood ladder step at a level: never finer than the plant's own options. A peeling
 * bark's strips stand only while the step keeps the tier's own edges or the step after them.
 */
function rungTube(mesh: MeshInput, level: MeshLevel, rung: number): TubeDetail {
	const [coarseness, sections] = WOOD_RUNGS[rung] as readonly [number, number];
	const tube = tubeDetail(
		level,
		mesh.detail,
		Math.max(mesh.coarseness ?? 0, coarseness),
		Math.max(mesh.sections ?? 0, sections),
	);
	return rung > PEEL_RUNGS ? { ...tube, fins: false } : tube;
}

/** One part's choice on its ladder: what it costs, and what it draws. */
interface WoodChoice {
	/** The ladder step, or -1 for a part that is not drawn. */
	readonly rung: number;
	/** The limbs or branches kept, where only the thickest fit; all of them when absent. */
	readonly kept?: number;
	/** The priced triangles. */
	readonly cost: number;
}

/** How the shoots or the leaf cards are drawn. */
interface LeafChoice {
	/** `rows` for the shoot rows at a tier, `clusters` for card clusters, `none` for nothing. */
	readonly kind: 'rows' | 'clusters' | 'none';
	/** The tier of the shoot rows. */
	readonly tier?: Detail;
	/** The clusters. */
	readonly clusters?: number;
	/** The card planes each cluster draws. */
	readonly planes?: number;
	/** The priced triangles. */
	readonly cost: number;
}

/** The card planes a number of clusters draws: all three while enough clusters stand, then fewer. */
function planesFor(budget: number): number {
	if (budget >= 6 * THREE_PLANE_CLUSTERS) return 3;
	return budget >= 4 ? 2 : budget >= 2 ? 1 : 0;
}

/**
 * A level of a plant with shoot rows, within a maximum.
 *
 * @param input What the level is built from.
 * @param level The level.
 * @param max The most triangles the level may draw.
 * @param reference What each part holds at the plant's best look, which sets the shares.
 * @returns The level.
 * @category api/vegetation
 */
export function rowLevel(
	input: BudgetInput,
	level: MeshLevel,
	max: number,
	reference: PartTriangles,
): LevelBuild {
	const { mesh, parts } = input;
	const { skeleton, rows } = mesh;
	const axes = skeleton.axes;
	const walk = input.walk ?? new Uint32Array(0);
	// The shares: each part's share of the plant's visible outline, with the shoots' twigs beside
	// their leaves, since one choice draws both.
	const allowance = allocateLevel(max, reference, visibleShares(input, reference));
	const share = (part: Part): number =>
		part === 'leaves' ? allowance.leaves + allowance.twigs : allowance[part];
	// The wood's quick counts at each ladder step, and what its meshes then measured.
	const tubes = WOOD_RUNGS.map((_, rung) => rungTube(mesh, level, rung));
	const quick = woodLadderTriangles(
		mesh,
		level,
		parts,
		tubes.map((tube) => [tube, tube, tube]),
	);
	const measured: (number | undefined)[][] = [[], [], []];
	const priced = (part: number, rung: number): number =>
		measured[part]?.[rung] ?? ((quick[rung] as number[])[part] as number);
	const last = WOOD_RUNGS.length - 1;
	// The coarsest rung that still reads as wood: no capped trunk or great limb draws below it,
	// whichever branch of the ladder reaches it.
	let coarsest = -1;
	for (let rung = last; rung >= 0; rung--)
		if ((tubes[rung] as TubeDetail).maxSides >= SIDES_LEAST) {
			coarsest = rung;
			break;
		}
	// The trunk and the great limbs are few axes, and the quick count misses a stem's foot and a
	// leader's first ring, so each step that could fit is meshed and counted before any choice. The
	// coarsest legal step is always counted, since the floor prices it whatever the quick count says.
	for (let rung = 0; rung < tubes.length; rung++) {
		const count = quick[rung] as number[];
		if (rung !== coarsest && (count[0] as number) + (count[1] as number) > 4 * max) continue;
		const tube = tubes[rung] as TubeDetail;
		const counted = meshWoodParts(mesh, level, parts, { tubes: [tube, tube, null] }).triangles;
		(measured[0] as (number | undefined)[])[rung] = counted[0];
		(measured[1] as (number | undefined)[])[rung] = counted[1];
	}
	const axesOf = [0, 0, 0];
	const orders = level === 0 ? 255 : (mesh.record.lod.woodOrders[level - 1] ?? 255);
	for (let a = 0; a < axes.count; a++) {
		const part = parts[a] as number;
		if ((axes.order[a] as number) <= orders) axesOf[part] = (axesOf[part] as number) + 1;
	}
	// The limbs and branches from the thickest down, each after the axis it leaves.
	const byGirth = [1, 2].map((part) =>
		Array.from({ length: axes.count }, (_, a) => a)
			.filter((a) => parts[a] === part && (axes.order[a] as number) <= orders)
			.sort(
				(a, b) =>
					(skeleton.radius[axes.first[b] as number] as number) -
						(skeleton.radius[axes.first[a] as number] as number) || a - b,
			),
	);
	// The fork's own price: the two thickest great limbs at the coarsest legal step cost more than
	// the part's mean, so the floor and the fallback take the pair measured, not averaged.
	let forkLimb = 0;
	if (level === 0 && coarsest >= 0 && (byGirth[0] as number[]).length > 0) {
		const keep = new Uint8Array(axes.count);
		for (const a of (byGirth[0] as number[]).slice(0, 2)) keep[a] = 1;
		const tube = tubes[coarsest] as TubeDetail;
		forkLimb = meshWoodParts(mesh, level, parts, {
			tubes: [tubes[coarsest] as TubeDetail, tube, null],
			keep,
		}).triangles[1] as number;
	}
	// What one straight run costs where only the thickest limbs or branches are drawn: the thickest
	// cost more than the part's mean, so their price is measured apart.
	const eachKept: (number | undefined)[] = [];
	const fitWood = (part: number, budget: number): WoodChoice => {
		for (let rung = 0; rung < tubes.length; rung++) {
			if ((tubes[rung] as TubeDetail).maxSides < SIDES_LEAST) continue;
			const cost = priced(part, rung);
			if (cost <= budget) return { rung, cost };
		}
		// Not even one straight run for each axis fits: the thickest limbs or branches that do, at
		// the coarsest rung that still reads as wood — the fallback may not draw a pinch either.
		if (coarsest < 0) return { rung: -1, cost: 0 };
		if (part === 0) return { rung: -1, cost: 0 };
		const each = eachKept[part] ?? priced(part, coarsest) / Math.max(1, axesOf[part] as number);
		const kept = each > 0 ? Math.floor(budget / each) : 0;
		if (kept > 0) return { rung: coarsest, kept, cost: Math.ceil(kept * each) };
		// The fork's pair costs more than the part's mean, so it is priced measured: a budget that
		// buys no mean limb may still buy the pair that keeps the tree's fork.
		if (part === 1 && forkLimb > 0 && budget >= forkLimb)
			return { rung: coarsest, kept: 2, cost: forkLimb };
		return { rung: -1, cost: 0 };
	};
	// The shoots' ladder: the rows at each tier the kit holds, then cards.
	const tiers: { tier: Detail; leaves: number; twigs: number }[] = [];
	if (level === 0)
		for (let t = DETAILS.indexOf(mesh.detail); t >= 0; t--) {
			const tier = DETAILS[t] as Detail;
			const [leaves, twigs] = shootPartTriangles(mesh, rows, tier);
			if (leaves + twigs > 0) tiers.push({ tier, leaves, twigs });
		}
	const clumpsOfPlant = input.mesh.skeleton.clumps?.length ?? 0;
	// A plant cut to no rows still has its clumps, and its cards count a clump each: a rowless
	// crown must be able to choose the card tier, or its whole allowance buys nothing.
	const mostClusters =
		clumpsOfPlant > 0 && rows.count === 0
			? clumpsOfPlant
			: level === 2
				? Math.ceil(rows.count / 2)
				: rows.count;
	const fitLeaves = (budget: number): LeafChoice => {
		for (const { tier, leaves, twigs } of tiers)
			if (leaves + twigs <= budget) return { kind: 'rows', tier, cost: leaves + twigs };
		const planes = planesFor(budget);
		const clusters = planes > 0 ? Math.min(mostClusters, Math.floor(budget / (2 * planes))) : 0;
		return clusters > 0
			? { kind: 'clusters', clusters, planes, cost: clusters * 2 * planes }
			: { kind: 'none', cost: 0 };
	};
	// The extras' ladder: this level's form on every site, then on a share of the sites, then each
	// farther level's form, then none.
	const forms: (MeshArrays | undefined)[] = [];
	for (let form = level; form <= 2; form++) forms.push(extrasOf(mesh, form as MeshLevel));
	const fitExtras = (budget: number): { mesh?: MeshArrays; cost: number } => {
		const own = forms[0];
		if (own && trianglesOf(own) <= budget) return { mesh: own, cost: trianglesOf(own) };
		// A share of the sites, in steps, so one mesh serves the budgets near it.
		if (own && budget >= LEAST_EXTRAS_SHARE * trianglesOf(own))
			for (
				let step = Math.floor((budget / trianglesOf(own)) * EXTRAS_STEPS);
				step >= LEAST_EXTRAS_SHARE * EXTRAS_STEPS;
				step--
			) {
				const thinned = extrasOf(mesh, level, step / EXTRAS_STEPS);
				if (thinned && trianglesOf(thinned) <= budget)
					return { mesh: thinned, cost: trianglesOf(thinned) };
			}
		for (const form of forms.slice(1))
			if (form && trianglesOf(form) <= budget) return { mesh: form, cost: trianglesOf(form) };
		return { cost: 0 };
	};
	// The least each part asks for before any share: the trunk and the great limbs as one straight
	// run each, and one card set of two planes.
	// A crown whose every twig stands above the cap's cut is carried by its clump cards alone, so its
	// share of the maximum is reserved before the wood, one card a clump or the share where that is
	// less: a small maximum still buys a crown rather than a bare frame.
	const cheapestRows =
		tiers.length === 0
			? Number.POSITIVE_INFINITY
			: Math.min(...tiers.map((tier) => tier.leaves + tier.twigs));
	const crownedNoRows = clumpsOfPlant > 0 && cheapestRows > Math.floor(max * CROWN_SHARE);
	// A low maximum buys the tree's shape first: the trunk and the great limbs take a share of the
	// cap before the leaves, because a crown standing on one three-sided run is not a tree at any
	// distance. The share is paid even where the crown would take the whole maximum.
	const skeletonFloor = Math.floor(max * SKELETON_SHARE);
	// The floor prices the coarsest rung the sides rule allows, not the ladder's last step: a
	// maximum that cannot pay for a legal trunk pays for none rather than for a pinch.
	const cheapest = coarsest >= 0 ? coarsest : last;
	const floor = (part: Part): number =>
		part === 'trunk'
			? Math.max(priced(0, cheapest), Math.floor(skeletonFloor * SKELETON_TRUNK))
			: part === 'limbs'
				? Math.max(priced(1, cheapest), forkLimb, Math.floor(skeletonFloor * (1 - SKELETON_TRUNK)))
				: part === 'leaves'
					? rows.count > 0
						? 4
						: crownedNoRows
							? Math.min(clumpsOfPlant * 6, Math.floor(max * 0.6))
							: 0
					: 0;
	let wood: WoodChoice[] = [];
	let leaf: LeafChoice = { kind: 'none', cost: 0 };
	let extras: { mesh?: MeshArrays; cost: number } = { cost: 0 };
	const allowed: Record<Part, number> = { trunk: 0, leaves: 0, limbs: 0, branches: 0, extras: 0 };
	const choose = (): void => {
		const cost: Record<Part, number> = { trunk: 0, leaves: 0, limbs: 0, branches: 0, extras: 0 };
		wood = [
			{ rung: -1, cost: 0 },
			{ rung: -1, cost: 0 },
			{ rung: -1, cost: 0 },
		];
		const fit = (part: Part, budget: number): void => {
			allowed[part] = budget;
			if (part === 'leaves') leaf = fitLeaves(budget);
			else if (part === 'extras') extras = fitExtras(budget);
			else {
				const index = WOOD.indexOf(part);
				// A limb needs its trunk, and a branch the wood it leaves.
				const rooted = index === 0 || (wood[0] as WoodChoice).rung >= 0;
				wood[index] = rooted ? fitWood(index, budget) : { rung: -1, cost: 0 };
			}
			cost[part] =
				part === 'leaves'
					? leaf.cost
					: part === 'extras'
						? extras.cost
						: (wood[WOOD.indexOf(part)] as WoodChoice).cost;
		};
		// Each part first takes its floor, in turn, while the floors fit; the rest of the maximum is
		// shared out in proportion to what each part holds at the plant's best look.
		const least: Record<Part, number> = { trunk: 0, leaves: 0, limbs: 0, branches: 0, extras: 0 };
		let reserved = 0;
		// A rowless crown's share is paid first, so the wood's own floor cannot spend it.
		const payOrder: readonly Part[] = crownedNoRows
			? ['leaves', 'trunk', 'limbs', 'branches', 'extras']
			: PARTS;
		for (const part of payOrder) {
			// The whole limb set is the floor where the cap can hold it; where it cannot, the fork's
			// pair is, so a low cap keeps a legible fork rather than no limbs at all.
			const amount = part === 'limbs' && reserved + floor(part) > max ? forkLimb : floor(part);
			if (reserved + amount <= max) {
				least[part] = amount;
				reserved += least[part];
			}
		}
		let left = max;
		for (const part of PARTS) {
			fit(part, Math.min(left, least[part] + share(part) * (1 - reserved / max)));
			left -= cost[part];
		}
		// Real shoots outrank the extras that hang on them: where what is left and the extras' share
		// together buy the shoot rows, or a finer tier of them, the shoots take both.
		if (tiers.length > 0) {
			const claim = fitLeaves(cost.leaves + left + cost.extras);
			if (claim.kind === 'rows' && claim.cost > cost.leaves) {
				left += cost.leaves + cost.extras - claim.cost;
				allowed.leaves = claim.cost + left;
				leaf = claim;
				cost.leaves = claim.cost;
				fit('extras', Math.min(left, allowed.extras));
				left -= cost.extras;
			}
		}
		// What is left goes round the parts, the parts that carry the outline first: an equal slice
		// each for a few rounds, so no part takes it all, and then the rest to each in turn.
		for (let round = 0; round < HAND_ROUNDS && left > 0; round++) {
			const slice = round === HAND_ROUNDS - 1 ? left : left / PARTS.length;
			for (const part of PARTS) {
				const before = cost[part];
				const budget = before + Math.min(left, round === HAND_ROUNDS - 1 ? left : slice);
				if (budget <= allowed[part]) continue;
				fit(part, budget);
				left -= cost[part] - before;
			}
		}
	};
	/** The limbs and branches a choice keeps, thickest first, each after the axis it leaves. */
	const keptAxes = (): Uint8Array | undefined => {
		if (wood.every((choice) => choice.kept === undefined)) return undefined;
		const keep = new Uint8Array(axes.count);
		[1, 2].forEach((part, index) => {
			const choice = wood[part] as WoodChoice;
			if (choice.rung < 0) return;
			let room = choice.kept ?? Number.POSITIVE_INFINITY;
			for (const a of byGirth[index] as number[]) {
				if (room <= 0) break;
				const parent = axes.parent[a] as number;
				if (parent >= 0 && parts[parent] !== 0 && keep[parent] !== 1) continue;
				keep[a] = 1;
				room--;
			}
		});
		return keep;
	};
	const planOf = (): WoodPlan => ({
		tubes: wood.map((choice) => (choice.rung < 0 ? null : (tubes[choice.rung] as TubeDetail))),
		...(keptAxes() ? { keep: keptAxes() as Uint8Array } : {}),
	});
	// Settle the wood: mesh the choice, record what each part's mesh measured, and choose again
	// with those counts, until a choice that fits is chosen twice. A choice that fits is kept, so a
	// finer one that turns out too large is given up for it.
	const none: WoodPlan = { tubes: [null, null, null] };
	let good:
		| {
				built: ReturnType<typeof meshWoodParts>;
				plan: WoodPlan;
				leaf: LeafChoice;
				extras: { mesh?: MeshArrays; cost: number };
				allowed: Record<Part, number>;
				key: string;
		  }
		| undefined;
	for (let build = 0; build < MOST_BUILDS; build++) {
		choose();
		const key = JSON.stringify(wood);
		if (good?.key === key) break;
		const plan = planOf();
		const built = meshWoodParts(mesh, level, parts, plan);
		let fits = true;
		let total = leaf.cost + extras.cost;
		for (let part = 0; part < 3; part++) {
			const choice = wood[part] as WoodChoice;
			const exact = built.triangles[part] as number;
			total += exact;
			if (choice.rung < 0) continue;
			if (choice.kept === undefined) {
				(measured[part] as (number | undefined)[])[choice.rung] = exact;
			} else if (exact > choice.cost) eachKept[part] = exact / choice.kept;
			if (exact > allowed[WOOD[part] as Part]) fits = false;
		}
		if (fits && total <= max) good = { built, plan, leaf, extras, allowed: { ...allowed }, key };
	}
	// Where no choice fitted, the level draws no wood rather than pass the maximum.
	if (!good) {
		leaf = fitLeaves(max);
		good = {
			built: meshWoodParts(mesh, level, parts, none),
			plan: none,
			leaf,
			extras: { cost: 0 },
			allowed: { trunk: 0, leaves: max, limbs: 0, branches: 0, extras: 0 },
			key: '',
		};
	}
	const { built, plan } = good;
	leaf = good.leaf;
	extras = good.extras;
	Object.assign(allowed, good.allowed);
	// How the level draws each axis, which the card clusters hang on.
	const keep = plan.keep;
	const drawnFlags = new Uint8Array(axes.count);
	for (let a = 0; a < axes.count; a++) {
		const part = parts[a] as number;
		const tube = plan.tubes[part];
		const parent = axes.parent[a] as number;
		const kind = axes.kind[a] as number;
		const rooted = parent >= 0 || kind === AXIS_STEM || kind === AXIS_STIPE || kind === AXIS_LIMB;
		if (!tube || !rooted || (axes.order[a] as number) > orders) continue;
		if (part !== 0 && keep && keep[a] !== 1) continue;
		if (parent >= 0 && drawnFlags[parent] === 0) continue;
		drawnFlags[a] = tube.sections >= 1 ? 2 : 1;
	}
	const drawn = (axis: number) => drawnFlags[axis] as DrawnWood;
	const surface = woodSurface(built.mesh);
	const woodTotal = built.triangles[0] + built.triangles[1] + built.triangles[2];
	// The cards take what the wood and the extras leave, priced with their stalks.
	let cards: MeshArrays | undefined;
	let leaves = 0;
	let twigs = 0;
	let joins: ClusterCount = NO_CLUSTERS;
	const chosen: LeafChoice = leaf;
	if (chosen.kind === 'rows') {
		const tier = tiers.find((candidate) => candidate.tier === chosen.tier);
		leaves = tier?.leaves ?? 0;
		twigs = tier?.twigs ?? 0;
	} else if (rows.count > 0) {
		const budget = max - woodTotal - extras.cost;
		allowed.leaves = budget;
		const clumps = input.mesh.skeleton.clumps?.length ?? 0;
		// A plant with clumps draws one clump card a clump: the crown's mass comes from the clumps the
		// plant holds, not from one small card a row, and the share of them kept follows the leaves'
		// allowance. A plant without clumps keeps the row clusters.
		if (clumps > 0) {
			const planes = budget >= 6 * clumps ? 3 : 2;
			const each = 2 * planes;
			// The count comes from what the budget pays, and the mesh itself is the check: a clump that
			// stands clear of the wood takes a stalk, which costs more than a bare card, so the count
			// drops by the overrun's price until the level's own triangles fit.
			let count = Math.min(clumps, Math.max(0, Math.floor(budget / each)));
			for (let pass = 0; pass < 8 && count > 0; pass++) {
				// One picture a side under a maximum: a tiled card costs the square of its tiles and a
				// small cap cannot afford one, so the capped crown keeps the bare card.
				const made = plannedClumpCards(
					input.mesh,
					planes,
					count / clumps,
					1,
					level === 1 ? 0.5 : 0,
				);
				if (!made) break;
				const cost = trianglesOf(made);
				if (cost <= budget) {
					cards = made;
					leaves = cost;
					break;
				}
				count = Math.max(0, count - Math.max(1, Math.ceil((cost - budget) / each)));
			}
		} else {
			const planes = planesFor(budget);
			let clusters: CardCluster[] = [];
			if (planes > 0) {
				// The most clusters whose cards and stalks fit: the most the planes alone allow, or else
				// a count found by halving between none and that.
				const price = (count: number) => {
					const made = cardClusters(mesh, walk, count, drawn, planes, surface);
					return { made, cost: clusterTriangles(made, planes) };
				};
				let high = Math.min(mostClusters, Math.floor(budget / (2 * planes)));
				const most = price(high);
				if (most.cost <= budget) clusters = most.made;
				else {
					let low = 0;
					while (high - low > 1) {
						const middle = (low + high) >> 1;
						const tried = price(middle);
						if (tried.cost <= budget) {
							low = middle;
							clusters = tried.made;
						} else high = middle;
					}
				}
			}
			if (clusters.length > 0) {
				cards = clusterCardMesh(mesh, clusters, planes);
				leaves = trianglesOf(cards);
			}
			joins = {
				clusters: clusters.length,
				stalks: clusters.filter((cluster) => cluster.stalk).length,
				free: clusters.filter((cluster) => !cluster.anchor).length,
			};
		}
	}
	return {
		...(level > 0 || input.wood ? { wood: built.mesh } : {}),
		...(cards ? { cards } : {}),
		...(extras.mesh ? { extras: extras.mesh } : {}),
		triangles: {
			trunk: built.triangles[0],
			limbs: built.triangles[1],
			branches: built.triangles[2],
			twigs,
			leaves,
			extras: extras.cost,
		},
		allowed: {
			trunk: allowed.trunk,
			limbs: allowed.limbs,
			branches: allowed.branches,
			twigs: chosen.kind === 'rows' ? twigs : 0,
			leaves: chosen.kind === 'rows' ? allowed.leaves - twigs : allowed.leaves,
			extras: allowed.extras,
		},
		...(level === 0 ? { shoots: chosen.kind === 'rows' ? (chosen.tier as Detail) : 'none' } : {}),
		clusters: joins,
	};
}

/**
 * A level of a plant whose foliage is one mesh, within a maximum: its form at each tier the level
 * may draw, then the forms of the farther levels, and below the coarsest, fewer leaves, flower stems
 * and stalks.
 *
 * @param input What the level is built from.
 * @param level The level.
 * @param max The most triangles the level may draw.
 * @param reference What each part holds at the plant's best look.
 * @returns The level.
 */
function mergedLevel(
	input: BudgetInput,
	level: MeshLevel,
	max: number,
	reference: PartTriangles,
): LevelBuild {
	const whole = Math.max(1, partTotal(reference));
	/** A build's allowances: each part's share, raised to what the other parts left it. */
	const within = (build: LevelBuild): LevelBuild => {
		const allow = (part: keyof PartTriangles) =>
			Math.max((max * reference[part]) / whole, build.triangles[part]);
		return {
			...build,
			allowed: {
				trunk: allow('trunk'),
				limbs: allow('limbs'),
				branches: allow('branches'),
				twigs: allow('twigs'),
				leaves: allow('leaves'),
				extras: allow('extras'),
			},
		};
	};
	// The level's own form at each tier from the plant's down, then each farther level's form. Only
	// the nearest form reads the tier.
	const first = DETAILS.indexOf(input.mesh.detail);
	let coarsest = input;
	let form: MeshLevel = level;
	for (form = level; ; form++) {
		for (let t = first; t >= (form === 0 ? 0 : first); t--) {
			coarsest = { ...input, mesh: { ...input.mesh, detail: DETAILS[t] as Detail } };
			const build = levelBuild({ ...coarsest, wood: true }, form);
			if (partTotal(build.triangles) <= max) return within(strip(build, input, level));
		}
		if (form === 2) break;
	}
	// The foliage carries the outline, so it outranks the extras: the coarsest form without its
	// extras, and where that still does not fit, fewer leaves, the most that fit, found by halving.
	const plain = (of: BudgetInput): BudgetInput => ({ ...of, mesh: { ...of.mesh, extrasShare: 0 } });
	let kept = coarsest;
	let fits: LevelBuild | undefined = levelBuild({ ...plain(coarsest), wood: true }, form);
	if (partTotal(fits.triangles) > max) {
		fits = undefined;
		let low = 1;
		let high = (input.carriers ?? 0) - 1;
		while (coarsest.thin && low <= high) {
			const middle = (low + high) >> 1;
			const thinned = coarsest.thin(middle);
			if (!thinned) break;
			const build = levelBuild({ ...plain(thinned), wood: true }, form);
			if (partTotal(build.triangles) <= max) {
				fits = build;
				kept = thinned;
				low = middle + 1;
			} else high = middle - 1;
		}
	}
	if (!fits) return within(strip({ triangles: NO_TRIANGLES }, input, level));
	// The extras take what the foliage leaves: the largest share of their sites that fits.
	const room = max - partTotal(fits.triangles);
	for (let step = EXTRAS_STEPS; step >= 1 && room > 0; step--) {
		const extras = extrasOf(kept.mesh, form, step / EXTRAS_STEPS);
		const cost = trianglesOf(extras);
		if (cost === 0 || cost > room) continue;
		fits = { ...fits, extras, triangles: { ...fits.triangles, extras: cost } };
		break;
	}
	return within(strip(fits, input, level));
}

/** A build without the nearest wood, where the growth meshes that wood later. */
function strip(build: LevelBuild, input: BudgetInput, level: MeshLevel): LevelBuild {
	if (level > 0 || input.wood || !build.wood) return build;
	const { wood: _wood, ...rest } = build;
	return { ...rest, triangles: { ...build.triangles, trunk: 0, limbs: 0, branches: 0 } };
}

/**
 * What a level draws within a triangle maximum. A level whose best look already fits is built as it
 * stands. Otherwise each part takes its share of the maximum and steps down its own ladder, and the
 * level never draws more than the maximum.
 *
 * @param input What the level is built from.
 * @param level The level.
 * @param max The most triangles the level may draw.
 * @param reference What each part holds at the plant's best look, which sets the shares.
 * @returns The level's meshes, each part's triangles and each part's allowance.
 * @category api/vegetation
 */
export function levelWithin(
	input: BudgetInput,
	level: MeshLevel,
	max: number,
	reference: PartTriangles,
): LevelBuild {
	const { mesh } = input;
	if (isMerged(mesh)) return mergedLevel(input, level, max, reference);
	// The level's own best look, where the shoots and a quick count of the wood leave it room. The
	// quick count can stand well above the mesh, so half of it decides whether the mesh is tried.
	const [leaves, twigs] = level === 0 ? shootPartTriangles(mesh, mesh.rows, mesh.detail) : [0, 0];
	const tube = tubeDetail(level, mesh.detail, mesh.coarseness ?? 0, mesh.sections ?? 0);
	const quick = woodPartTriangles(mesh, level, input.parts, [tube, tube, tube]);
	// A card level's own cards are at least two triangles for each plane of each row it keeps.
	const cards =
		level === 0 ? 0 : 6 * (level === 2 ? Math.floor(mesh.rows.count / 2) : mesh.rows.count);
	if (leaves + twigs + cards + (quick[0] + quick[1] + quick[2]) / 2 <= max) {
		const build = levelBuild({ ...input, wood: true }, level);
		if (partTotal(build.triangles) <= max)
			return { ...strip(build, input, level), allowed: build.triangles };
	}
	return rowLevel(input, level, max, reference);
}
