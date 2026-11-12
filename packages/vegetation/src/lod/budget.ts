// A level's triangle budget: the plant keeps the form it grew and spends a fixed number of
// triangles across the parts of one level. The leaf cards keep fewer shoot rows, spread evenly in
// their space-filling order and each grown to hold the crown's cover; the wood keeps its thickest
// axes at the coarsest rings; the extras draw only while the budget has room. The split between the
// parts follows each part's share of the plant's side outline, found once from the grown form and
// used at every level, so the crown keeps its proportions and the levels hand over without a pop.
import type { MeshArrays, PartName, ShootRows } from '../asset';
import { plantSilhouette, type SilhouetteFrame, shootSilhouette } from '../grow/envelope';
import { extrasMesh } from '../leaf/extras';
import type { MeshInput, MeshLevel } from '../stages';
import { woodTrianglesAt } from '../wood/estimate';
import { meshWoodAt } from '../wood/wood-mesh';
import { cardKeep, cardMeshWith, cardRowTriangles } from './cards';

/** The most of a level's budget that the extras may take, as a share. */
const EXTRAS_SHARE = 0.15;

/** The fewest triangles a level spends on a card, which keeps at least one card at any budget. */
const CHEAPEST_CARD = 6;

/** The least share of the outline the wood needs before its trunk is drawn at all. */
const WOOD_VISIBLE_LEAST = 0.02;

/** Rows with no shoot, for the wood's own outline. */
const NO_ROWS: ShootRows = {
	count: 0,
	prototype: new Uint8Array(0),
	position: new Float32Array(0),
	rotation: new Float32Array(0),
	scale: new Float32Array(0),
	record: new Uint16Array(0),
	phase: new Uint8Array(0),
	sky: new Uint8Array(0),
	bent: new Uint8Array(0),
	order: new Uint32Array(0),
};

/** How the plant's side outline divides between its cards and the wood that the cards leave. */
export interface PartShares {
	/** The leaf cards' share, from 0 to 1. */
	readonly cards: number;
	/** The wood's visible share, from 0 to 1. */
	readonly wood: number;
}

/** One part of a budgeted level, before quantisation. */
export interface BudgetPart {
	/** Which part. */
	readonly name: PartName;
	/** Its mesh. */
	readonly mesh: MeshArrays;
}

/** The cards a level keeps at a budget. */
export interface CardPlan {
	/** Rows kept. */
	readonly kept: number;
	/** Rows the level's own form keeps. */
	readonly of: number;
	/** How much each kept row's cards grow, against the form's scale. */
	readonly grow: number;
	/** The cards' triangles. */
	readonly triangles: number;
	/** The space-filling orders of the kept rows. */
	readonly orders: ReadonlySet<number>;
}

/** The wood a level keeps at a budget. */
export interface WoodPlan {
	/** The coarsest branch order kept, or -1 when no wood fits. */
	readonly maxOrder: number;
	/** The wood's coarseness. */
	readonly coarseness: number;
	/** The wood's triangles. */
	readonly triangles: number;
	/** Its mesh, absent when no wood fits. */
	readonly mesh?: MeshArrays;
}

/** What one budgeted level builds. */
export interface LevelBuild {
	/** Its parts. */
	readonly parts: readonly BudgetPart[];
	/** The cards' plan, for a card level. */
	readonly cards?: CardPlan;
	/** The wood's plan. */
	readonly wood?: WoodPlan;
	/** The extras' triangles, 0 when they are left out. */
	readonly extras: number;
	/** The level's triangles. */
	readonly triangles: number;
}

/** The part shares of a dressed variant, found once and kept for its levels. */
const SHARES = new WeakMap<MeshInput, PartShares>();

/**
 * The share of the plant's side outline that the leaf cards and the visible wood each cover, from
 * four turns of a coarse silhouette. The cards stand in front of the wood where the two meet, so
 * the wood's share is what the cards leave of it.
 *
 * @param input The dressed variant.
 * @returns The two shares, which add to one.
 * @category api/vegetation
 */
export function partShares(input: MeshInput): PartShares {
	const known = SHARES.get(input);
	if (known) return known;
	const height = Math.max(input.skeleton.height, 0.001);
	const { min, max } = input.skeleton.bounds;
	const reach =
		Math.max(
			Math.abs(min[0] as number),
			Math.abs(max[0] as number),
			Math.abs(min[2] as number),
			Math.abs(max[2] as number),
			height * 0.1,
		) * 1.25;
	const frame: SilhouetteFrame = {
		left: -reach,
		cell: height / 32,
		cols: Math.ceil((2 * reach) / (height / 32)),
		rows: Math.ceil((height * 1.1) / (height / 32)),
	};
	const lengths = input.kit.prototypes.map((prototype) => prototype.length);
	let cardsCells = 0;
	let woodCells = 0;
	for (let k = 0; k < 4; k++) {
		const turn = (k * Math.PI) / 2;
		const cards = shootSilhouette(input.rows, lengths, turn, frame);
		const wood = plantSilhouette(input.skeleton, NO_ROWS, lengths, turn, frame);
		for (let cell = 0; cell < cards.length; cell++) {
			cardsCells += cards[cell] as number;
			woodCells += (wood[cell] as number) & ((cards[cell] as number) === 0 ? 1 : 0);
		}
	}
	const sum = cardsCells + woodCells;
	const shares =
		sum > 0 ? { cards: cardsCells / sum, wood: woodCells / sum } : { cards: 0.85, wood: 0.15 };
	SHARES.set(input, shares);
	return shares;
}

/**
 * The cards a card level keeps at a budget: the level's own rows while they fit, then a share of
 * them spread evenly in their space-filling order, each grown to hold the level's cover.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @param budget The triangles the cards may take.
 * @returns The plan.
 * @category api/vegetation
 */
export function cardPlan(input: MeshInput, level: 1 | 2, budget: number): CardPlan {
	const { rows, kit } = input;
	const own: number[] = [];
	for (let r = 0; r < rows.count; r++) {
		if (cardKeep(rows.order[r] as number, level) === 0) continue;
		if (!kit.prototypes[rows.prototype[r] as number]?.card) continue;
		own.push(r);
	}
	const ownGrow = level === 2 ? Math.SQRT2 : 1;
	let cost = 0;
	for (const r of own) cost += cardRowTriangles(input, rows.prototype[r] as number);
	if (budget >= cost || own.length === 0)
		return {
			kept: own.length,
			of: own.length,
			grow: ownGrow,
			triangles: cost,
			orders: new Set(own.map((r) => rows.order[r] as number)),
		};
	const sorted = [...own].sort((a, b) => (rows.order[a] as number) - (rows.order[b] as number));
	let kept = 0;
	let spent = 0;
	for (const r of sorted) {
		const row = cardRowTriangles(input, rows.prototype[r] as number);
		if (kept > 0 && spent + row > budget) break;
		spent += row;
		kept++;
	}
	const grow = ownGrow * Math.sqrt(own.length / kept);
	const orders = new Set(sorted.slice(0, kept).map((r) => rows.order[r] as number));
	return { kept, of: own.length, grow, triangles: spent, orders };
}

/**
 * The cards' mesh at a budget.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @param budget The triangles the cards may take.
 * @returns The plan and the mesh.
 * @category api/vegetation
 */
export function cardMeshBudget(
	input: MeshInput,
	level: 1 | 2,
	budget: number,
): { readonly plan: CardPlan; readonly mesh: MeshArrays } {
	const plan = cardPlan(input, level, budget);
	return {
		plan,
		mesh: cardMeshWith(input, (order) => (plan.orders.has(order) ? plan.grow : 0)),
	};
}

/**
 * The wood a level keeps at a budget: its own orders while they fit, then fewer orders at the
 * coarsest rings, and no wood when even the stem does not fit.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @param budget The triangles the wood may take.
 * @returns The plan.
 * @category api/vegetation
 */
export function woodPlan(input: MeshInput, level: MeshLevel, budget: number): WoodPlan {
	const own = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	const coarseness = Math.max(input.coarseness ?? 0, 1);
	for (let maxOrder = own; maxOrder >= 0; maxOrder--) {
		if (woodTrianglesAt(input, level, maxOrder, coarseness) > budget) continue;
		const mesh = meshWoodAt(input, level, maxOrder, coarseness);
		const triangles = mesh.indices.length / 3;
		if (triangles <= budget) return { maxOrder, coarseness, triangles, mesh };
	}
	return { maxOrder: -1, coarseness, triangles: 0 };
}

/**
 * Builds one level within its triangle budget. The parts' shares come from the grown form; the
 * extras take at most a small share, the wood its visible share at the coarsest rings, and the cards
 * the rest. A merged-foliage species and a stand-in keep the form's own meshes.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @param budget The level's triangles.
 * @returns The build, or undefined when the budget does not describe this level's kind of plant.
 * @category api/vegetation
 */
export function budgetLevel(
	input: MeshInput,
	level: MeshLevel,
	budget: number,
): LevelBuild | undefined {
	if (input.kit.placeholders === true) return undefined;
	if (input.record.lod.nearFoliage === 'merged') return undefined;
	const shares = partShares(input);
	const parts: BudgetPart[] = [];
	const extrasMeshBuilt = extrasMesh(input, level);
	const extrasCost = extrasMeshBuilt ? extrasMeshBuilt.indices.length / 3 : 0;
	const extras = level > 0 && extrasCost > 0 && extrasCost <= budget * EXTRAS_SHARE;
	const rest = Math.max(0, budget - (extras ? extrasCost : 0));
	let wood: WoodPlan | undefined;
	let cards: CardPlan | undefined;
	if (level === 1 || level === 2) {
		// The wood's share of the outline, but never less than its trunk while the budget holds the
		// trunk and one card. The trunk is drawn once the budget can hold it, even past its share,
		// because no smaller wood stands for the plant.
		const stem = shares.wood >= WOOD_VISIBLE_LEAST ? stemTriangles(input, level) : 0;
		const target = Math.min(
			Math.max(Math.round(rest * shares.wood), stem),
			Math.max(0, rest - CHEAPEST_CARD),
		);
		wood = woodPlan(input, level, target);
		const built = cardMeshBudget(input, level, Math.max(0, rest - (wood?.triangles ?? 0)));
		cards = built.plan;
		if (wood?.mesh) parts.push({ name: 'wood', mesh: wood.mesh });
		parts.push({ name: 'cards', mesh: built.mesh });
	}
	if (extras && extrasMeshBuilt) parts.push({ name: 'extras', mesh: extrasMeshBuilt });
	const triangles = (wood?.triangles ?? 0) + (cards?.triangles ?? 0) + (extras ? extrasCost : 0);
	return { parts, cards, wood, extras: extras ? extrasCost : 0, triangles };
}

/**
 * The triangles of the cheapest wood of a level: its stem at the coarsest rings.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The count.
 * @category api/vegetation
 */
export function stemTriangles(input: MeshInput, level: MeshLevel): number {
	const mesh = meshWoodAt(input, level, 0, Math.max(input.coarseness ?? 0, 1));
	return mesh.indices.length / 3;
}

/**
 * Checks a level budget: three counts, each zero or more, where zero leaves that level as it grows.
 *
 * @param budgets The budgets the page gave.
 * @throws When a budget is not a count.
 * @category api/vegetation
 */
export function checkBudgets(budgets: readonly number[] | undefined): void {
	for (const budget of budgets ?? []) {
		if (!(Number.isFinite(budget) && budget >= 0))
			throw new Error(`@null3d/vegetation: a level budget of ${budget} is not a count.`);
	}
}
