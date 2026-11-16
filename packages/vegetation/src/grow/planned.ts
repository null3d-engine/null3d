// The planned grower: a plant that builds only the state its request asks for, from the numbers the
// plan worked out first.
//
// The adult is today's oak: the frame's stated trunk, nine great limbs, their boughs and branches
// and the clumps they end in, planned with the frame's fine fill switched off. It never changes with
// age, sparseness or the maximum, so it is planned once for a seed and kept. Growth reveals it:
// a trunk node appears at the age its height is reached, a limb at its fork age showing the first
// part of its adult path, and a bough or clump when its parent reaches it. Sparseness thins the
// orders under the great limbs by a keyed rank, so a sparser plant is a subset of a denser one. The
// fill clothes each clump with keyed sockets through its depth (planned-fill.ts). Nothing is grown
// and then cut.
import {
	AXIS_LIMB,
	AXIS_STEM,
	type ClumpData,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { hashAt, unitAt } from '../core/hash';
import type { FrameAxis, FrameNode, FramePlan } from './frame';
import { planFrame } from './frame';
import type { Grower } from './models';
import { type FillClump, fillClumps } from './planned-fill';
import type { Planned, Species } from '../core/record';
import type { DetailPlan, GrowInput, GrowRequest } from '../stages';
import { type Curve, curveAt, spreadMean, type Vec3 } from '../core/types';

/** The purpose of the draw that decides whether sparseness keeps an element. */
const SPARSE = 21;

/** The exponent that slims a young plant's wood against its height: a whip is slender. */
const SLIM = 2.5;

/** Adult plans kept a thread, by species, seed and variant. */
const ADULTS = new Map<string, Adult>();

/** The most adult plans a thread keeps: a page shows a few seeds and variants at once. */
const ADULT_KEPT = 6;

/** An adult plan: the frame's stated axes and clumps, with the height they reach. */
interface Adult {
	/** The frame without its fine fill: every stated axis and each axis's clump. */
	readonly plan: FramePlan;
	/** The height of the adult's stated wood, in metres. */
	readonly height: number;
}

/** What one order's expected elements are bounded by, from the frame's own stated rules. */
interface FrameBounds {
	/** The expected count of each order, generous enough that a plant never exceeds it. */
	readonly expected: number[];
}

/** The most elements one stated rule makes on each parent. */
function countMost(count: number | { readonly every: number; readonly least: number; readonly most: number } | { readonly total: number }): number {
	if (typeof count === 'number') return Math.max(0, Math.round(count));
	if ('total' in count) return Math.max(0, Math.round(count.total));
	return Math.max(0, Math.round(count.most));
}

/** The most elements that leave one axis of a rule, all its child rules together. */
function childrenMost(rule: { readonly children?: readonly { readonly count: Parameters<typeof countMost>[0] }[] }): number {
	let sum = 0;
	for (const child of rule.children ?? []) sum += countMost(child.count);
	return sum;
}

/** The most elements of each order the oak's frame can make, as bounds for the plan's counts. */
function boundsOf(record: Species, growth: Planned): FrameBounds {
	const height = curveAt(growth.height, 1);
	const spec = growth.frame;
	if (growth.adult !== 'frame' || spec === undefined)
		return { expected: [0, 0, 0, 0, 0] };
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
	};
}

/** A share of an age, kept inside 0 and 1. */
function share(age: number, birth: number, fullAge: number): number {
	return Math.max(0, Math.min(1, (age - birth) / Math.max(1e-9, fullAge - birth)));
}

/** The adult plan of a seed and variant, planned once and kept. */
function adultFor(record: Species, growth: Planned, seed: number, variant: number): Adult | undefined {
	if (growth.adult !== 'frame' || growth.frame === undefined) return undefined;
	const key = `${record.id}:${seed >>> 0}:${variant}`;
	const kept = ADULTS.get(key);
	if (kept) {
		ADULTS.delete(key);
		ADULTS.set(key, kept);
		return kept;
	}
	const plan = planFrame(
		growth.frame,
		{ record, seed: seed >>> 0, variant, season: record.seasons.default },
		false,
	);
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

/** One revealed axis, as it stands at the asked age. */
interface Placed {
	/** The age it appeared at. */
	readonly birth: number;
	/** The share of its adult length it has grown, 0 to 1. */
	readonly growth: number;
	/** The age at which it reaches its adult length. */
	readonly span: number;
	/** Its SkeletonBuilder axis, or -1 where the plan left it out. */
	readonly axis: number;
	/** The SkeletonBuilder node of each of its adult nodes that stands in the skeleton. */
	readonly nodes: number[];
	/** The nodes' places in plant space. */
	readonly places: readonly Vec3[];
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
	// The elements kept at this sparseness: the stated and fill orders thin by their keyed rank, and
	// the trunk and the great limbs never thin.
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
	const whole = priced.trunk + priced.limbs + priced.branches + priced.foliage;
	// Under a maximum, each order keeps a share of its elements: the bones first, the fill last.
	const cut = (order: number): number => {
		if (max === undefined || whole <= max) return 1;
		if (order < 2) return 1;
		const bones = priced.trunk + priced.limbs;
		const room = Math.max(0, max - bones);
		const finer = whole - bones;
		return Math.max(0, Math.min(1, finer > 0 ? room / finer : 0));
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
 * and clothed by the keyed fill.
 */
export function growPlanned(input: GrowInput): MacroSkeleton {
	const growth = input.record.growth as Planned;
	const request = input.request ?? { maturity: 1, sparse: 0 };
	const age = input.plan?.age ?? request.maturity * growth.fullAge;
	if (!(age > 0)) return emptyPlant();
	const adult = adultFor(input.record, growth, input.seed, input.variant);
	if (!adult) return emptyPlant();
	const { plan, height: adultHeight } = adult;
	const fullAge = growth.fullAge;
	const sparse = request.sparse;
	const thin = growth.thin;
	const seed = input.seed >>> 0;
	// The height at this age as a share of the adult's, and the wood's slimming with it.
	const reachShare =
		curveAt(growth.height, age / fullAge) / Math.max(1e-9, curveAt(growth.height, 1));
	const height = adultHeight * Math.min(1, reachShare);
	const slim = Math.pow(Math.min(1, height / adultHeight), SLIM);
	// The age the plant reaches its adult height: the end of every axis's growth in length.
	const maturityAge = ageAtHeight(growth.height, fullAge, adultHeight, adultHeight);

	const builder = new SkeletonBuilder();
	const placed: Placed[] = [];
	const addresses: number[] = [];
	let axesMade = 0;

	// Each stated axis in plan order, parents before children: the trunk first, then the limbs it
	// carries, then their boughs and branches.
	for (let index = 0; index < plan.axes.length; index++) {
		const axis = plan.axes[index] as FrameAxis;
		const parentPlaced = axis.parent < 0 ? undefined : (placed[axis.parent] as Placed);
		if (axis.parent >= 0 && (parentPlaced === undefined || parentPlaced.axis < 0)) {
			placed.push(absent());
			continue;
		}
		// The element's address, a hash of the seed, its parent's address, its slot and its kind.
		const parentAddress = axis.parent < 0 ? 0 : (addresses[axis.parent] as number);
		const address = hashAt(seed, parentAddress, axis.index, axis.order);
		addresses.push(address);
		// Sparseness keeps a keyed share of each thinned order, and never touches the trunk or the
		// nine great limbs.
		const thinning = axis.order >= 2 ? (thin[axis.order] ?? 0) : 0;
		if (thinning > 0 && unitAt(seed, address, SPARSE) < sparse * thinning) {
			placed.push(absent());
			continue;
		}
		// The age it appears at and the age it reaches its adult length. A trunk node stands when the
		// height curve reaches it, so the trunk is grown to its top early in life; a limb is born at
		// its fork age, and a bough or a branch when its parent reaches the seat it leaves from. Every
		// axis under the trunk reaches its adult length as the plant reaches its adult height.
		const top = (axis.nodes[axis.nodes.length - 1] as FrameNode).y;
		let birth: number;
		let span: number;
		if (axis.parent < 0) {
			birth = 0;
			span = ageAtHeight(growth.height, fullAge, adultHeight, top);
		} else {
			const parent = parentPlaced as Placed;
			const seat = Math.max(0, Math.min(1, (plan.axes[axis.parent] as FrameAxis).along[axis.parentNode] as number));
			birth = parent.birth + (parent.span - parent.birth) * seat;
			// Every axis under the trunk reaches its adult length as the plant reaches its adult height.
			span = Math.max(birth + 1e-9, maturityAge);
		}
		const growthShare = axis.parent < 0 ? 1 : share(age, birth, span);
		if (growthShare <= 0) {
			placed.push(absent());
			continue;
		}
		// The nodes that stand: the trunk is cut where the plant's height reaches, and every other
		// axis shows the first part of its fixed adult path.
		const kept: FrameNode[] = [];
		const places: Vec3[] = [];
		let travelled = 0;
		for (let k = 0; k < axis.nodes.length; k++) {
			const node = axis.nodes[k] as FrameNode;
			const along = (axis.along[k] as number) * axis.length;
			const inside = axis.parent < 0 ? node.y <= height + 1e-9 : along <= axis.length * growthShare + 1e-9;
			if (k > 0 && !inside) break;
			kept.push(node);
			places.push([node.x, node.y, node.z]);
			travelled = along;
		}
		// A revealed axis ends at the point its grown length reaches, between two adult nodes.
		if (axis.parent >= 0 && growthShare < 1 && kept.length < axis.nodes.length) {
			const target = axis.length * growthShare;
			const next = axis.nodes[kept.length] as FrameNode;
			const span = (axis.along[kept.length] as number) * axis.length - travelled;
			const t = span > 1e-9 ? Math.max(0, Math.min(1, (target - travelled) / span)) : 0;
			const prior = kept[kept.length - 1] as FrameNode;
			kept.push({
				x: prior.x + (next.x - prior.x) * t,
				y: prior.y + (next.y - prior.y) * t,
				z: prior.z + (next.z - prior.z) * t,
				radius: prior.radius + (next.radius - prior.radius) * t,
			});
			places.push([kept[kept.length - 1]?.x ?? 0, kept[kept.length - 1]?.y ?? 0, kept[kept.length - 1]?.z ?? 0]);
		}
		// Write the axis and its nodes into the skeleton.
		const parentNode =
			axis.parent < 0
				? -1
				: ((parentPlaced as Placed).nodes[Math.min(axis.parentNode, (parentPlaced as Placed).nodes.length - 1)] ?? -1);
		const kind = axis.role === 'stem' ? AXIS_STEM : AXIS_LIMB;
		const builderAxis = builder.addAxis({
			parent: axis.parent < 0 ? -1 : ((parentPlaced as Placed).axis as number),
			parentNode,
			order: axis.order,
			kind,
			barkV: 0,
			barkU: (axis.azimuth * Math.PI) / 180,
		});
		axesMade++;
		const nodes: number[] = [];
		let last = parentNode;
		kept.forEach((node, k) => {
			const at = axis.parent < 0 ? node.y : (axis.along[k] as number);
			const ageOfNode =
				axis.parent < 0 ? ageAtHeight(growth.height, fullAge, adultHeight, node.y) : birth + (fullAge - birth) * at;
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius * (axis.parent < 0 ? slim : slim),
				parent: last,
				axis: builderAxis,
				light: 1,
				age: Math.max(0, Math.round(ageOfNode)),
			});
			nodes.push(last);
		});
		placed.push({ birth, growth: growthShare, span, axis: builderAxis, nodes, places });
	}

	// The clumps the stated axes end in, grown with their axes.
	const clumps: ClumpData[] = [];
	const fill: FillClump[] = [];
	let crownBase = height;
	plan.patches.forEach((patch, id) => {
		const placedAxis = placed[patch.axis];
		if (placedAxis === undefined || placedAxis.axis < 0) return;
		const axis = plan.axes[patch.axis] as FrameAxis;
		const growthShare = placedAxis.growth;
		const radius = (patch.width / 2) * growthShare;
		if (!(radius > 1e-6)) return;
		const adultTip = axis.nodes[axis.nodes.length - 1] as FrameNode;
		const tip = placedAxis.places[placedAxis.places.length - 1] as Vec3;
		const centre: Vec3 = [
			tip[0] + (patch.centre[0] - adultTip.x) * growthShare,
			tip[1] + (patch.centre[1] - adultTip.y) * growthShare,
			tip[2] + (patch.centre[2] - adultTip.z) * growthShare,
		];
		clumps.push({
			id,
			centre,
			radius,
			depth: 3,
			birth: placedAxis.birth,
		});
		fill.push({
			id,
			centre,
			radius,
			birth: placedAxis.birth,
			axis: placedAxis.axis,
			node: placedAxis.nodes[placedAxis.nodes.length - 1] as number,
			order: axis.order,
			root: tip,
		});
		crownBase = Math.min(crownBase, centre[1] - radius);
	});

	// The sockets that clothe the clumps, at the share the sparseness and the plan leave.
	const leaves = Math.min(
		1,
		Math.max(0.08, curveAt(growth.leavesAt, sparse) * (input.plan?.rankCut[(input.plan?.rankCut.length ?? 1) - 1] ?? 1)),
	);
	const planScale = plan.scale / Math.max(1e-9, spreadMean(input.record.size.height));
	const grown = fillClumps({
		builder,
		seed,
		salt: input.record.seedSalt >>> 0,
		variant: input.variant,
		clumps: fill,
		leaves,
		pieceScale: planScale,
		turn: growth.turn,
	});
	const made = axesMade + grown.made;
	return {
		...builder.finish(Math.max(0, Math.min(crownBase, height))),
		clumps,
		made,
		shed: 0,
	};
}

/** An axis the plan left out. */
function absent(): Placed {
	return { birth: 0, growth: 0, span: 0, axis: -1, nodes: [], places: [] };
}

/** The years an age waits to cross a share of its life. */
function set(shareAt: number, fullAge: number, birth: number): number {
	return (fullAge - birth) * Math.max(0, Math.min(1, shareAt));
}

/** The planned grower. */
export const grower: Grower = {
	grow: growPlanned,
	plan: planTree,
};
