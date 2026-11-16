// The planned grower: a plant that builds only the state its request asks for, from the numbers the
// plan worked out first.
//
// The adult is today's oak: the frame's trunk, nine great limbs, their boughs and branches and the
// clumps they end in. It is planned once for a seed and kept, in two passes: the frame's own plan,
// whose stated axes and the order-two twigs of its limb clumps are the bones, and the same plan with
// the fine fill switched off, whose patches are the clumps. Growth reveals the adult at an age: a
// limb shows the first part of its fixed path, and a clump appears as its carrying axis reaches it.
// Sparseness keeps a spread rank of each thinned order, so a sparser plant is a subset of a denser
// one. The fill clothes each clump through its depth (planned-fill.ts), and its sockets and twigs
// stand at fixed places, so an element is the same in every request. Nothing is grown and then cut.
import {
	AXIS_LIMB,
	AXIS_STEM,
	type ClumpData,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { hashAt } from '../core/hash';
import { thinningRanks } from '../core/rank';
import type { Planned, Species } from '../core/record';
import { type Curve, curveAt, spreadMean, type Vec3 } from '../core/types';
import type { DetailPlan, GrowInput, GrowRequest } from '../stages';
import type { FrameAxis, FrameNode, FramePlan } from './frame';
import { planFrame } from './frame';
import type { Grower } from './models';
import { type FillClump, type FillInput, fillClumps } from './planned-fill';

/**
 * The share of a triangle maximum that the crown is paid before the wood takes its share: a clump
 * card is six triangles, so a crown costs six for each clump it shows. Below about a quarter the
 * crown reads as tufts rather than a crown.
 */
const CROWN_SHARE = 0.6;

/** The least share of a maximum the crown may be left, under which its crown reads as tufts. */
const CROWN_LEAST = 0.25;

/**
 * The clump cards a maximum pays for: the crown takes its share of the cap before the wood does, and
 * that share buys a card a clump while it lasts. With no maximum every clump a card, and nothing of
 * the cap is taken.
 */
function crownCards(max: number | undefined, clumps: number, cardCost: number): number {
	if (max === undefined || !(cardCost > 0)) return clumps;
	const take = Math.max(max * CROWN_LEAST, Math.min(clumps * cardCost, max * CROWN_SHARE));
	return Math.min(clumps, Math.floor(take / cardCost));
}

/** The maturity from which a crown thins its branches with sparseness: younger crowns keep them. */
const ADULT_MATURITY = 0.5;

/** The exponent that slims a young plant's wood against its height: a whip is slender. */
const SLIM = 2.5;

/** The share of its growth a clump has reached before any of its pieces show. */
const CLUMP_FROM = 0.25;

/** The share of its growth at which a clump carries all the sockets it ever carries. */
const CLUMP_OPEN = 0.55;

/** The size a clump's pieces start at, as a share of their full size, when they first show. */
const PIECE_START = 0.35;

/** Adult plans kept a thread, by species, seed and variant. */
const ADULTS = new Map<string, Adult>();

/** The most adult plans a thread keeps: a page shows a few seeds and variants at once. */
const ADULT_KEPT = 6;

/** An adult plan: the frame's stated axes, the clumps, and the height they reach. */
interface Adult {
	/** The frame without its fine fill: its stated axes and each axis's patch are the bones and clumps. */
	readonly plan: FramePlan;
	/** The height of the adult's bones, in metres. */
	readonly height: number;
}

/**
 * What the crown fill needs beyond the clumps: the crown's own box at this state, and on each clump
 * the limb it belongs to, that limb's reach from the plant's centre line and whether the clump sits
 * at the limb's end or on its side. A low limb's end clump is the one that dips; a shoulder clump is
 * the one that clothes the limb's side.
 */
export interface PlannedFillSight {
	/** The crown's box at this state, in metres. */
	readonly crown: { readonly top: number; readonly base: number; readonly height: number };
}

/** The limb a clump belongs to, its reach, and whether the clump sits at the limb's end. */
export interface ClumpSight {
	/** The limb axis's index in the adult plan, or -1 for a clump on the trunk. */
	readonly limb: number;
	/** How far the limb's adult tip stands from the plant's centre line, in metres. */
	readonly limbReach: number;
	/** Where the clump sits: at the limb's end, or on its side. */
	readonly at: 'limb-end' | 'limb-side';
}

/** What one order's expected elements are bounded by, from the frame's own stated rules. */
interface FrameBounds {
	/** The expected count of each order, generous enough that a plant never exceeds it. */
	readonly expected: number[];
	/** The most clumps the adult can carry: one for each limb, bough and branch. */
	readonly clumps: number;
}

/** The most elements one stated rule makes on each parent. */
function countMost(
	count:
		| number
		| { readonly every: number; readonly least: number; readonly most: number }
		| { readonly total: number },
): number {
	if (typeof count === 'number') return Math.max(0, Math.round(count));
	if ('total' in count) return Math.max(0, Math.round(count.total));
	return Math.max(0, Math.round(count.most));
}

/** The most elements that leave one axis of a rule, all its child rules together. */
function childrenMost(rule: {
	readonly children?: readonly { readonly count: Parameters<typeof countMost>[0] }[];
}): number {
	let sum = 0;
	for (const child of rule.children ?? []) sum += countMost(child.count);
	return sum;
}

/** The most elements of each order the oak's frame can make, as bounds for the plan's counts. */
function boundsOf(record: Species, growth: Planned): FrameBounds {
	const height = curveAt(growth.height, 1);
	const spec = growth.frame;
	void record;
	if (growth.adult !== 'frame' || spec === undefined)
		return { expected: [0, 0, 0, 0, 0], clumps: 0 };
	// The stated levels: the stems, then the axes that leave them.
	const stems = spec.stems;
	const first = Math.max(1, Math.round(stems.count));
	const second = first * Math.max(1, childrenMost(stems));
	const levelOne = stems.children ?? [];
	const third = second * Math.max(1, ...levelOne.map((rule) => childrenMost(rule)));
	const levelTwo = levelOne.flatMap((rule) => rule.children ?? []);
	const fourth = third * Math.max(0, ...levelTwo.map((rule) => childrenMost(rule)));
	// Each stated axis carries a patch whose width bounds the sockets that clothe it, at six a
	// square metre of the clump's width. Each level is taken at its widest patch.
	const widest = (rules: readonly { readonly patch?: { readonly width: Curve } }[]): number => {
		let most = 0;
		for (const rule of rules) if (rule.patch) most = Math.max(most, curveAt(rule.patch.width, 1));
		return most;
	};
	const sockets = (count: number, width: number): number => count * 6 * (width * height) ** 2;
	const limbWidth = widest(levelOne);
	const boughWidth = widest(levelTwo);
	const twigWidth = widest(levelTwo.flatMap((rule) => rule.children ?? []));
	// The margin keeps a bound above any single seed's plant.
	const margin = 1.2;
	return {
		expected: [
			first * margin,
			second * margin,
			(third + sockets(second, limbWidth)) * margin,
			(fourth + sockets(third, boughWidth)) * margin,
			sockets(fourth, twigWidth) * margin,
		],
		clumps: (second + third + fourth) * margin,
	};
}

/** The adult plan of a seed and variant, planned once and kept. */
function adultFor(
	record: Species,
	growth: Planned,
	seed: number,
	variant: number,
): Adult | undefined {
	if (growth.adult !== 'frame' || growth.frame === undefined) return undefined;
	const key = `${record.id}:${seed >>> 0}:${variant}`;
	const kept = ADULTS.get(key);
	if (kept) {
		ADULTS.delete(key);
		ADULTS.set(key, kept);
		return kept;
	}
	const input = { record, seed: seed >>> 0, variant, season: record.seasons.default };
	const plan = planFrame(growth.frame, input, false);
	let height = 0;
	for (const axis of plan.axes) for (const node of axis.nodes) height = Math.max(height, node.y);
	const adult: Adult = { plan, height: Math.max(1e-6, height) };
	ADULTS.set(key, adult);
	if (ADULTS.size > ADULT_KEPT) ADULTS.delete(ADULTS.keys().next().value as string);
	return adult;
}

/** A plant that has not grown: no parts, no rows, no triangles. */
function emptyPlant(): MacroSkeleton {
	const builder = new SkeletonBuilder();
	return { ...builder.finish(0), clumps: [], made: 0, shed: 0 };
}

/** The age at which the plant reaches a height, inverted from the record's height curve. */
function ageAtHeight(height: Curve, fullAge: number, reach: number, y: number): number {
	if (!(y > 0)) return 0;
	let low = 0;
	let high = 1;
	for (let pass = 0; pass < 30; pass++) {
		const middle = (low + high) / 2;
		if ((curveAt(height, middle) / Math.max(1e-9, curveAt(height, 1))) * reach >= y) high = middle;
		else low = middle;
	}
	return high * fullAge;
}

/** Where one axis of the adult stands at the asked age, before sparseness or a maximum is read. */
interface Reveal {
	/** The age it appears at. */
	readonly birth: number;
	/** The age at which it reaches its adult length. */
	readonly span: number;
	/** The share of its adult length it has grown, 0 to 1. */
	readonly growth: number;
	/** Whether the plant has reached it at all. */
	readonly present: boolean;
}

/**
 * What one requested state costs, as numbers, before any geometry is built: the age, the expected
 * elements of each order, the sides each order's tubes draw, the foliage forms, the parts' priced
 * shares, the fruit and flower ramps and the rank cut of each order.
 */
export function planTree(record: Species, request: GrowRequest): DetailPlan {
	const growth = record.growth as Planned;
	const age = request.maturity * growth.fullAge;
	const sparse = request.sparse;
	const max = request.maxTriangles;
	const bounds = boundsOf(record, growth);
	const expected = bounds.expected;
	const thin = growth.thin;
	// The elements kept at this sparseness: the stated and fill orders thin by their rank, and the
	// trunk and the great limbs never thin.
	const kept = expected.map((count, order) => count * (1 - sparse * (thin[order] ?? 0)));
	// A maximum shares the count: the bones keep their own share, and the finer orders are cut.
	const sides = max === undefined ? 10 : max >= 20_000 ? 8 : max >= 5_000 ? 6 : 3;
	const clumpCard = max !== undefined && max < 2_000;
	const piece = growth.prices.piece;
	const tube = growth.prices.tubeSegment;
	// The price of each part at this state: wood segments by order, and one piece a socket.
	const segments = [12, 9, 5, 4, 1];
	const wood = kept.slice(0, 4).map((count, order) => count * (segments[order] as number) * tube);
	const sockets = kept[4] as number;
	const foliage = sockets * (clumpCard ? growth.prices.clumpCard : piece);
	const fruit = request.maturity >= growth.fruitFrom ? sockets * piece * 0.05 : 0;
	const priced = {
		trunk: wood[0] as number,
		limbs: wood[1] as number,
		branches: (wood[2] as number) + (wood[3] as number),
		twigs: 0,
		foliage: foliage + fruit,
		fruit,
	};
	// Under a maximum the crown is served before the wood takes its share: each clump draws one
	// card below about 2,000 triangles, and the crown keeps a card a clump while the cap allows,
	// leaving the wood at least a tenth of it. Above that share the wood keeps the rest.
	const clumps = Math.max(1, Math.round(bounds.clumps));
	const cardCost = max === undefined ? 0 : growth.prices.clumpCard;
	const cards = crownCards(max, clumps, cardCost);
	const socketsBound = Math.max(1, expected[4] as number);
	const woodRoom = max === undefined ? 0 : Math.max(0, max - cards * cardCost);
	const woodTotal = priced.trunk + priced.limbs + priced.branches;
	const woodKept =
		max === undefined ? 1 : woodTotal > 0 ? Math.max(0, Math.min(1, woodRoom / woodTotal)) : 1;
	// The fill keeps the plan's share of the crown: one anchor socket a carded clump, its lowest
	// ranks first, so a card a clump is what stands when the crown is paid for. Below the least
	// share the crown is never left, since under it the clumps read as tufts.
	const crownKept = max === undefined ? 1 : Math.min(1, cards / socketsBound);
	const cut = (order: number): number => {
		if (max === undefined) return 1;
		if (order < 2) return 1;
		return order >= 4 ? crownKept : woodKept;
	};
	return {
		age,
		finestOrder: 4,
		expected,
		tubeSides: [sides, sides, Math.max(3, sides - 2), Math.max(3, sides - 4), 3],
		foliage: [
			{ form: clumpCard ? 'clump-card' : 'piece', blend: 1 },
			{ form: clumpCard ? 'clump-card' : 'cards', blend: 1 },
			{ form: clumpCard ? 'clump-card' : 'cards', blend: 1 },
		],
		triangles: {
			trunk: priced.trunk,
			limbs: priced.limbs,
			branches: priced.branches,
			twigs: priced.twigs,
			foliage: priced.foliage,
			fruit: priced.fruit,
		},
		fruit: ramp(request.maturity, growth.fruitFrom, growth.fruitBand),
		flowers:
			growth.flowers === undefined
				? 0
				: ramp(request.maturity, growth.flowers.from, growth.flowers.band),
		rankCut: expected.map((_, order) => (order < 2 ? 1 : cut(order))),
	};
}

/** A ramp from nothing to one over a band, from the maturity a thing starts at. */
function ramp(maturity: number, from: number, band: number): number {
	if (!(maturity > from)) return 0;
	return Math.min(1, (maturity - from) / Math.max(1e-9, band));
}

/**
 * Grows the plant at the asked state: the adult plan revealed to the age, thinned by sparseness,
 * and clothed by the fill.
 */
export function growPlanned(input: GrowInput): MacroSkeleton {
	const growth = input.record.growth as Planned;
	const request = input.request ?? { maturity: 1, sparse: 0 };
	// The generator hands the plan as a stage input; a probe that grows without it plans here.
	const detail = input.plan ?? planTree(input.record, request);
	const age = detail.age;
	if (!(age > 0)) return emptyPlant();
	const adult = adultFor(input.record, growth, input.seed, input.variant);
	if (!adult) return emptyPlant();
	const { plan: bones, height: adultHeight } = adult;
	const fullAge = growth.fullAge;
	const seed = input.seed >>> 0;
	const sparse = request.sparse;
	const thin = growth.thin;
	// The height at this age as a share of the adult's, and the wood's slimming with it.
	const reachShare =
		curveAt(growth.height, age / fullAge) / Math.max(1e-9, curveAt(growth.height, 1));
	const height = adultHeight * Math.min(1, reachShare);
	const slim = Math.min(1, height / adultHeight) ** SLIM;
	const matureAge = ageAtHeight(growth.height, fullAge, adultHeight, adultHeight);
	// A maximum coarsens each axis's own nodes: every second or fourth node stands.
	const most = request.maxTriangles;
	const woodStep = most === undefined ? 1 : most >= 20_000 ? 1 : most >= 5_000 ? 2 : 8;

	// Where every adult axis stands at this age, before sparseness or a maximum is read.
	const reveal: Reveal[] = bones.axes.map((axis) => {
		const top = (axis.nodes[axis.nodes.length - 1] as FrameNode).y;
		if (axis.parent < 0)
			return {
				birth: 0,
				span: ageAtHeight(growth.height, fullAge, adultHeight, top),
				growth: 1,
				present: true,
			};
		const seat = (bones.axes[axis.parent] as FrameAxis).nodes[axis.parentNode] as FrameNode;
		const birth = ageAtHeight(growth.height, fullAge, adultHeight, seat.y);
		const from = Math.max(0, Math.min(adultHeight, seat.y));
		const grown =
			adultHeight - from > 1e-9
				? Math.max(0, Math.min(1, (height - from) / (adultHeight - from)))
				: 1;
		return {
			birth,
			span: Math.max(birth + 1e-9, matureAge),
			growth: grown,
			present: grown > 0,
		};
	});

	/** Where an axis's grown end stands, read from the adult path alone: the same at every sparseness. */
	const tipAt = (axis: FrameAxis, where: Reveal): Vec3 => {
		const first = axis.nodes[0] as FrameNode;
		if (!where.present) return [first.x, first.y, first.z];
		const edges = axis.nodes;
		for (let k = 1; k < edges.length; k++) {
			const prior = edges[k - 1] as FrameNode;
			const next = edges[k] as FrameNode;
			const over =
				axis.parent < 0 ? next.y > height + 1e-9 : (axis.along[k] as number) > where.growth + 1e-9;
			if (!over) continue;
			const span =
				axis.parent < 0
					? next.y - prior.y
					: ((axis.along[k] as number) - (axis.along[k - 1] as number)) * axis.length;
			const want =
				axis.parent < 0
					? height - prior.y
					: axis.length * where.growth - (axis.along[k - 1] as number) * axis.length;
			const t = span > 1e-9 ? Math.max(0, Math.min(1, want / span)) : 0;
			return [
				prior.x + (next.x - prior.x) * t,
				prior.y + (next.y - prior.y) * t,
				prior.z + (next.z - prior.z) * t,
			];
		}
		const last = edges[edges.length - 1] as FrameNode;
		return [last.x, last.y, last.z];
	};
	/** Each stated axis's grown end, read before sparseness, so a clump never moves with it. */
	const planTips: Vec3[] = bones.axes.map((axis, index) => tipAt(axis, reveal[index] as Reveal));

	// Sparseness keeps a spread rank of each thinned order, so the counts fall at every step and the
	// kept elements are a subset of a denser plant's.
	const keptAxis = new Set<number>();
	bones.axes.forEach((axis, index) => {
		if (axis.fine && axis.order > 2) return;
		keptAxis.add(index);
	});
	for (let order = 2; order < 8; order++) {
		const candidates = [...keptAxis].filter(
			(index) => (bones.axes[index] as FrameAxis).order === order,
		);
		const ranks = thinningRanks(
			candidates.map((index) => {
				const node = (bones.axes[index] as FrameAxis).nodes[0] as FrameNode;
				return [node.x, node.y, node.z];
			}),
		);
		// A crown thins its boughs from half grown up. A younger crown holds a few dozen, and dropping
		// one of those opens a hole a third of its side wide, so it keeps its boughs and loses leaves
		// instead: the owner's sparse look is a thin crown on the full trunk and limbs.
		const thins = request.maturity >= ADULT_MATURITY;
		const keepShare = thins ? Math.max(0, 1 - sparse * (thin[order] ?? 0)) : 1;
		const count = Math.max(0, Math.round(candidates.length * keepShare));
		candidates.forEach((index, at) => {
			if ((ranks[at] as number) >= count) keptAxis.delete(index);
		});
	}

	// The scale of a socket's piece against the species' own, from the frame's own scale.
	const pieceScale = bones.scale / Math.max(1e-9, spreadMean(input.record.size.height));
	const builder = new SkeletonBuilder();
	const built: number[] = new Array(bones.axes.length).fill(-1);
	const builtNodes: number[][] = new Array(bones.axes.length).fill(undefined);
	const origins: number[] = [];
	const addresses: number[] = [];

	// Every adult axis in plan order, parents before children.
	for (let index = 0; index < bones.axes.length; index++) {
		const axis = bones.axes[index] as FrameAxis;
		// The frame's fine twigs are its own fill, which this grower replaces; only the stated axes
		// are the bones.
		if (axis.parent >= 0 && (built[axis.parent] as number) < 0) continue;
		const where = reveal[index] as Reveal;
		if (!where.present) continue;
		if (!keptAxis.has(index)) continue;
		const parentAddress = axis.parent < 0 ? 0 : (addresses[axis.parent] as number);
		addresses.push(hashAt(seed, parentAddress, axis.index, axis.order));
		// The nodes that stand, cut where its grown length reaches.
		const keptNodes: FrameNode[] = [];
		let travelled = 0;
		for (let k = 0; k < axis.nodes.length; k++) {
			const node = axis.nodes[k] as FrameNode;
			const along = (axis.along[k] as number) * axis.length;
			const inside =
				axis.parent < 0 ? node.y <= height + 1e-9 : along <= axis.length * where.growth + 1e-9;
			// Every axis keeps its first full adult segment, so its start direction is the adult's.
			if (k > (axis.parent < 0 ? 0 : 1) && !inside) break;
			if (k > 0 && k % woodStep !== 0) continue;
			keptNodes.push(node);
			travelled = along;
		}
		// A revealed axis ends where its grown length reaches, between two adult nodes.
		if (axis.parent >= 0 && where.growth < 1 && keptNodes.length < axis.nodes.length) {
			const target = axis.length * where.growth;
			const next = axis.nodes[keptNodes.length] as FrameNode;
			const span = (axis.along[keptNodes.length] as number) * axis.length - travelled;
			const t = span > 1e-9 ? Math.max(0, Math.min(1, (target - travelled) / span)) : 0;
			const prior = keptNodes[keptNodes.length - 1] as FrameNode;
			keptNodes.push({
				x: prior.x + (next.x - prior.x) * t,
				y: prior.y + (next.y - prior.y) * t,
				z: prior.z + (next.z - prior.z) * t,
				radius: prior.radius + (next.radius - prior.radius) * t,
			});
		}
		const parentNode =
			axis.parent < 0
				? -1
				: ((builtNodes[axis.parent] as number[])[
						Math.min(axis.parentNode, (builtNodes[axis.parent] as number[]).length - 1)
					] ?? -1);
		const builderAxis = builder.addAxis({
			parent: axis.parent < 0 ? -1 : (built[axis.parent] as number),
			parentNode,
			order: axis.order,
			kind: axis.role === 'stem' ? AXIS_STEM : AXIS_LIMB,
			barkV: 0,
			barkU: (axis.azimuth * Math.PI) / 180,
		});
		built[index] = builderAxis;
		origins.push(index);
		const nodes: number[] = [];
		let last = parentNode;
		keptNodes.forEach((node, k) => {
			const at = axis.parent < 0 ? node.y : (axis.along[k] as number);
			const ageOfNode =
				axis.parent < 0
					? ageAtHeight(growth.height, fullAge, adultHeight, node.y)
					: where.birth + (where.span - where.birth) * at;
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius * slim,
				parent: last,
				axis: builderAxis,
				light: 1,
				age: Math.max(0, Math.round(ageOfNode)),
			});
			nodes.push(last);
		});
		builtNodes[index] = nodes;
	}

	// Which limb each axis belongs to, and how far each limb reaches from the centre line: the
	// fill's sight of the crown, read from the adult plan alone.
	const limbOf: number[] = [];
	bones.axes.forEach((axis) => {
		if (axis.parent < 0) {
			limbOf.push(-1);
			return;
		}
		const parent = bones.axes[axis.parent] as FrameAxis;
		limbOf.push(parent.order === 1 ? axis.parent : (limbOf[axis.parent] as number));
	});
	const limbReach = new Map<number, number>();
	bones.axes.forEach((axis, index) => {
		if (axis.order !== 1) return;
		let reach = 0;
		for (const node of axis.nodes) reach = Math.max(reach, Math.hypot(node.x, node.z));
		limbReach.set(index, reach);
	});

	// The clumps the adult ends in, at the places their carrying axes have reached. They stand in the skeleton as soon as
	// their carrying axis is reached, whatever sparseness thins, so the crown's box and base never
	// move with sparseness.
	const clumps: ClumpData[] = [];
	const fill: (FillClump & ClumpSight)[] = [];
	let crownBase = Number.POSITIVE_INFINITY;
	let top = height;
	bones.patches.forEach((patch, id) => {
		const axis = bones.axes[patch.axis] as FrameAxis;
		const where = reveal[patch.axis] as Reveal;
		if (where === undefined || !where.present) return;
		// The clump follows its carrying axis: it stands at the grown tip, at the size the axis has
		// reached, so a young crown is small and at the wood and never floats ahead of it.
		const radius = (patch.width / 2) * where.growth;
		if (!(radius > 1e-6)) return;
		const tip = axis.nodes[axis.nodes.length - 1] as FrameNode;
		const grownTip = planTips[patch.axis] as Vec3;
		const centre: Vec3 = [
			grownTip[0] + (patch.centre[0] - tip.x) * where.growth,
			grownTip[1] + (patch.centre[1] - tip.y) * where.growth,
			grownTip[2] + (patch.centre[2] - tip.z) * where.growth,
		];
		clumps.push({ id, centre, radius, depth: 3, birth: where.birth });
		crownBase = Math.min(crownBase, centre[1] - radius);
		top = Math.max(top, centre[1] + radius);
		const builtAxis = built[patch.axis] as number;
		if (builtAxis < 0) return;
		const open = Math.max(0, Math.min(1, (where.growth - CLUMP_FROM) / (CLUMP_OPEN - CLUMP_FROM)));
		if (open <= 0) return;
		const grown = PIECE_START + (1 - PIECE_START) * open;
		const builtAt = builtNodes[patch.axis] as number[];
		const limb = limbOf[patch.axis] as number;
		// A bough that leaves in the limb's last tenth, and the limb's own clump, stand at its end.
		const seatShare =
			axis.order === 1
				? 1
				: axis.order === 2 && axis.parent === limb
					? ((bones.axes[limb] as FrameAxis).along[axis.parentNode] as number)
					: 0;
		fill.push({
			id,
			centre,
			radius,
			birth: where.birth,
			growth: grown,
			open,
			axis: builtAxis,
			node: builtAt[builtAt.length - 1] as number,
			order: axis.order,
			root: grownTip,
			limb,
			limbReach: limbReach.get(limb) ?? 0,
			at: limb >= 0 && (axis.order === 1 || seatShare >= 0.9) ? 'limb-end' : 'limb-side',
		});
	});

	// Under a maximum the crown stands only the clumps its share pays for: a card a clump is what the
	// crown draws, so an unpayable clump would spend the wood's room on a card of its own. The kept
	// clumps are an even rank over the crown's own centres, so a smaller cap keeps a subset of a
	// larger one's clumps.
	const cards = crownCards(
		most,
		Math.max(1, Math.round(boundsOf(input.record, growth).clumps)),
		growth.prices.clumpCard,
	);
	if (cards < clumps.length) {
		const ranks = thinningRanks(clumps.map((clump) => clump.centre));
		const kept = new Set(
			clumps
				.map((clump, k) => ({ id: clump.id, rank: ranks[k] as number, k }))
				.sort((a, b) => a.rank - b.rank || a.k - b.k)
				.slice(0, cards)
				.map((one) => one.id),
		);
		clumps.splice(0, clumps.length, ...clumps.filter((clump) => kept.has(clump.id)));
		fill.splice(0, fill.length, ...fill.filter((clump) => kept.has(clump.id)));
	}

	// The sockets that clothe the clumps, at the share the sparseness and the plan leave.
	const keepsItsShare = Math.min(1, Math.max(0.08, curveAt(growth.leavesAt, sparse)));
	// Under a maximum the plan pays for a count of sockets, one for each carded clump; the fill's
	// own sockets are about six and a half a square metre of clump width, so the share that keeps
	// that many is the plan's count over the crown's own count.
	const carded = Math.round(
		Math.max(0, Math.min(1, detail.rankCut[detail.rankCut.length - 1] ?? 1)) *
			(detail.expected[4] ?? 0),
	);
	const socketsAbout = fill.reduce(
		(sum, clump) => sum + 1 + Math.round(6.5 * (2 * clump.radius) ** 2),
		0,
	);
	const cutByMaximum = socketsAbout > 0 ? Math.min(1, carded / socketsAbout) : 1;
	const leaves = Math.min(1, keepsItsShare * cutByMaximum);
	const crownBaseValue = Number.isFinite(crownBase) ? Math.max(0, crownBase) : height;
	const sighted: FillInput & PlannedFillSight = {
		builder,
		seed,
		salt: input.record.seedSalt >>> 0,
		variant: input.variant,
		clumps: fill,
		leaves,
		anchored: most !== undefined,
		// Catkins hang on their own sites in the flowering season, ramped by the plan.
		...(growth.flowers === undefined || input.season !== growth.flowers.season
			? {}
			: { flowers: detail.flowers }),
		pieceScale: pieceScale,
		turn: growth.turn,
		crown: { top, base: crownBaseValue, height: Math.max(0, top - crownBaseValue) },
	};
	const grown = fillClumps(sighted);

	// Each element keeps its place in the plant as grown, so a younger or a sparser plant's element
	// names the same place as the full one and the contract can pair them.
	const finished = builder.finish(Number.isFinite(crownBase) ? Math.max(0, crownBase) : height);
	const axesOrigin = new Uint32Array(finished.axes.count);
	origins.forEach((origin, at) => {
		if (at < axesOrigin.length) axesOrigin[at] = origin;
	});
	const budsOrigin = new Uint32Array(finished.buds.count);
	grown.socketOrigins.forEach((origin, at) => {
		if (at < budsOrigin.length) budsOrigin[at] = origin;
	});
	// The crown's own box: the bones and every clump that stands at this age, so sparseness never
	// changes a bound.
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (let n = 0; n < finished.nodeCount; n++)
		for (let c = 0; c < 3; c++) {
			const value = finished.position[n * 3 + c] as number;
			min[c] = Math.min(min[c] as number, value);
			max[c] = Math.max(max[c] as number, value);
		}
	for (const clump of clumps)
		for (let c = 0; c < 3; c++) {
			const reach = c === 1 ? clump.radius * 0.7 : clump.radius;
			min[c] = Math.min(min[c] as number, (clump.centre[c] as number) - reach);
			max[c] = Math.max(max[c] as number, (clump.centre[c] as number) + reach);
		}
	return {
		...finished,
		axes: { ...finished.axes, origin: axesOrigin },
		buds: { ...finished.buds, origin: budsOrigin },
		bounds: { min, max },
		height: max[1],
		crownBase: Number.isFinite(crownBase) ? Math.max(0, crownBase) : 0,
		clumps,
		// Every element the grower made is delivered: the axes and the bud sites it built.
		made: finished.axes.count + finished.buds.count,
		shed: 0,
	};
}

/** The planned grower. */
export const grower: Grower = {
	grow: growPlanned,
	plan: planTree,
};
