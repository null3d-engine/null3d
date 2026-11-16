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
import type { FrameAxis, FrameNode, FramePlan } from './frame';
import { planFrame } from './frame';
import { thinningRanks } from '../core/rank';
import type { Grower } from './models';
import { type ExtraSocket, type FillClump, fillClumps } from './planned-fill';
import type { Planned, Species } from '../core/record';
import type { DetailPlan, GrowInput, GrowRequest } from '../stages';
import { type Curve, curveAt, spreadMean, type Vec3 } from '../core/types';

/** The exponent that slims a young plant's wood against its height: a whip is slender. */
const SLIM = 2.5;

/** The share of its growth a clump has reached before any of its pieces show. */
const CLUMP_FROM = 0.25;

/** The size a clump's pieces start at, as a share of their full size, when they first show. */
const PIECE_START = 0.35;

/** Adult plans kept a thread, by species, seed and variant. */
const ADULTS = new Map<string, Adult>();

/** The most adult plans a thread keeps: a page shows a few seeds and variants at once. */
const ADULT_KEPT = 6;

/** An adult plan: the frame's axes, the clumps, and the height they reach. */
interface Adult {
	/** The frame's own plan: its stated axes, the order-two twigs of its limb clumps and its patches. */
	readonly bones: FramePlan;
	/** The frame without its fine fill, whose patches are the clumps the crown is made of. */
	readonly clumps: FramePlan;
	/** The height of the adult's bones, in metres. */
	readonly height: number;
}

/** What one order's expected elements are bounded by, from the frame's own stated rules. */
interface FrameBounds {
	/** The expected count of each order, generous enough that a plant never exceeds it. */
	readonly expected: number[];
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
	if (growth.adult !== 'frame' || spec === undefined) return { expected: [0, 0, 0, 0, 0] };
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
	const input = { record, seed: seed >>> 0, variant, season: record.seasons.default };
	const bones = planFrame(growth.frame, input);
	const clumps = planFrame(growth.frame, input, false);
	let height = 0;
	for (const axis of bones.axes)
		if (!axis.fine || axis.order <= 2) for (const node of axis.nodes) height = Math.max(height, node.y);
	const adult: Adult = { bones, clumps, height: Math.max(1e-6, height) };
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

/**
 * How far a clump's pieces have come, from nothing before its carrying axis is a quarter grown to
 * their full size when the axis is grown: a clump first shows at a share of its piece size, so the
 * crown opens without a step.
 */
function clumpReveal(growth: number): number {
	if (!(growth > CLUMP_FROM)) return 0;
	const ramp = Math.min(1, (growth - CLUMP_FROM) / (1 - CLUMP_FROM));
	return PIECE_START + (1 - PIECE_START) * ramp;
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
	const { bones, clumps: patches, height: adultHeight } = adult;
	const fullAge = growth.fullAge;
	const seed = input.seed >>> 0;
	const sparse = request.sparse;
	const thin = growth.thin;
	// The height at this age as a share of the adult's, and the wood's slimming with it.
	const reachShare =
		curveAt(growth.height, age / fullAge) / Math.max(1e-9, curveAt(growth.height, 1));
	const height = adultHeight * Math.min(1, reachShare);
	const slim = Math.pow(Math.min(1, height / adultHeight), SLIM);
	const matureAge = ageAtHeight(growth.height, fullAge, adultHeight, adultHeight);
	// A maximum coarsens each axis's own nodes: every second or fourth node stands.
	const most = request.maxTriangles;
	const woodStep = most === undefined ? 1 : most >= 20_000 ? 1 : most >= 5_000 ? 2 : 4;

	// Where every adult axis stands at this age, before sparseness or a maximum is read.
	const reveal: Reveal[] = bones.axes.map((axis) => {
		const top = (axis.nodes[axis.nodes.length - 1] as FrameNode).y;
		if (axis.parent < 0)
			return { birth: 0, span: ageAtHeight(growth.height, fullAge, adultHeight, top), growth: 1, present: true };
		const seat = (bones.axes[axis.parent] as FrameAxis).nodes[axis.parentNode] as FrameNode;
		const birth = ageAtHeight(growth.height, fullAge, adultHeight, seat.y);
		const from = Math.max(0, Math.min(adultHeight, seat.y));
		const grown =
			adultHeight - from > 1e-9 ? Math.max(0, Math.min(1, (height - from) / (adultHeight - from))) : 1;
		return {
			birth,
			span: Math.max(birth + 1e-9, matureAge),
			growth: grown,
			present: grown > 0,
		};
	});

	// Sparseness keeps a spread rank of each thinned order, so the counts fall at every step and the
	// kept elements are a subset of a denser plant's.
	const keptAxis = new Set<number>();
	bones.axes.forEach((axis, index) => {
		if (axis.fine && axis.order > 2) return;
		keptAxis.add(index);
	});
	for (let order = 2; order < 8; order++) {
		const candidates = [...keptAxis].filter((index) => (bones.axes[index] as FrameAxis).order === order);
		const ranks = thinningRanks(
			candidates.map((index) => {
				const node = (bones.axes[index] as FrameAxis).nodes[0] as FrameNode;
				return [node.x, node.y, node.z];
			}),
		);
		const keepShare = Math.max(0, 1 - sparse * (thin[order] ?? 0));
		const count = Math.max(0, Math.round(candidates.length * keepShare));
		candidates.forEach((index, at) => {
			if ((ranks[at] as number) >= count) keptAxis.delete(index);
		});
	}

	// The scale of a socket's piece against the species' own, from the frame's own scale.
	const pieceScale = bones.scale / Math.max(1e-9, spreadMean(input.record.size.height));
	/** The clump each stated axis carries, by the axis's index. */
	const patchOf = new Map<number, number>();
	patches.patches.forEach((patch, id) => patchOf.set(patch.axis, id));
	const builder = new SkeletonBuilder();
	const built: number[] = new Array(bones.axes.length).fill(-1);
	const builtNodes: number[][] = new Array(bones.axes.length).fill(undefined);
	const origins: number[] = [];
	const addresses: number[] = [];
	/** Sockets on the frame's own fine twigs, which keep those twigs from standing bare. */
	const extraSockets: ExtraSocket[] = [];

	// Every adult axis in plan order, parents before children.
	for (let index = 0; index < bones.axes.length; index++) {
		const axis = bones.axes[index] as FrameAxis;
		// Only the stated axes and the order-two twigs of the limb clumps are the bones; the deeper
		// fine twigs of the frame's own fill are replaced by this grower's fill.
		if (axis.fine && axis.order > 2) continue;
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
			if (k > 0 && !inside) break;
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
		// A fine twig of the frame's own fill carries a socket as today's does; hung without its
		// deeper twigs it would stand bare, and the dressing would trim it away. The socket stands
		// on the twig's own end, with no axis of its own, so no moving node becomes a bone.
		const clumpId = axis.parent < 0 ? undefined : patchOf.get(axis.parent);
		if (axis.fine && axis.order <= 2 && nodes.length > 0 && clumpId !== undefined) {
			const clumpGrowth = clumpReveal((reveal[axis.parent] as Reveal).growth);
			if (clumpGrowth > 0) {
				const last = keptNodes[keptNodes.length - 1] as FrameNode;
				const prior = keptNodes.length > 1 ? (keptNodes[keptNodes.length - 2] as FrameNode) : last;
				const dx = last.x - prior.x;
				const dy = last.y - prior.y;
				const dz = last.z - prior.z;
				const long = Math.sqrt(dx * dx + dy * dy + dz * dz);
				extraSockets.push({
					id: clumpId,
					axis: builderAxis,
					node: nodes[nodes.length - 1] as number,
					order: axis.order,
					point: [last.x, last.y, last.z],
					out: long > 1e-9 ? [dx / long, dy / long, dz / long] : [0, 1, 0],
					place: 1_000_000 + index,
					scale: pieceScale * clumpGrowth,
					birth: where.birth,
				});
			}
		}
	}

	// The clumps the adult ends in, at their adult places. They stand in the skeleton as soon as
	// their carrying axis is reached, whatever sparseness thins, so the crown's box and base never
	// move with sparseness.
	const clumps: ClumpData[] = [];
	const fill: FillClump[] = [];
	let crownBase = Number.POSITIVE_INFINITY;
	let top = height;
	patches.patches.forEach((patch, id) => {
		const axis = bones.axes[patch.axis] as FrameAxis;
		const where = reveal[patch.axis] as Reveal;
		if (where === undefined || !where.present) return;
		const radius = patch.width / 2;
		if (!(radius > 1e-6)) return;
		const centre = patch.centre;
		clumps.push({ id, centre, radius, depth: 3, birth: where.birth });
		crownBase = Math.min(crownBase, centre[1] - radius);
		top = Math.max(top, centre[1] + radius);
		const builtAxis = built[patch.axis] as number;
		if (builtAxis < 0) return;
		const open = Math.max(0, Math.min(1, (where.growth - CLUMP_FROM) / (1 - CLUMP_FROM)));
		if (open <= 0) return;
		const grown = PIECE_START + (1 - PIECE_START) * open;
		const tip = axis.nodes[axis.nodes.length - 1] as FrameNode;
		fill.push({
			id,
			centre,
			radius,
			birth: where.birth,
			growth: grown,
			open,
			axis: builtAxis,
			node: (builtNodes[patch.axis] as number[])[
				(builtNodes[patch.axis] as number[]).length - 1
			] as number,
			order: axis.order,
			root: [tip.x, tip.y, tip.z],
		});
	});

	// The sockets that clothe the clumps, at the share the sparseness and the plan leave.
	const keepsItsShare = Math.min(1, Math.max(0.08, curveAt(growth.leavesAt, sparse)));
	const cutByMaximum = Math.max(0, Math.min(1, detail.rankCut[detail.rankCut.length - 1] ?? 1));
	const leaves = Math.min(1, keepsItsShare * cutByMaximum);
	const grown = fillClumps({
		builder,
		seed,
		salt: input.record.seedSalt >>> 0,
		variant: input.variant,
		clumps: fill,
		extra: extraSockets,
		leaves,
		pieceScale: pieceScale,
		turn: growth.turn,
	});

	// Each element keeps its place in the plant as grown, so a younger or a sparser plant's element
	// names the same place as the full one and the contract can pair them.
	const finished = builder.finish(Number.isFinite(crownBase) ? Math.max(0, crownBase) : height);
	const axesOrigin = new Uint32Array(finished.axes.count);
	origins.forEach((origin, at) => {
		if (at < axesOrigin.length) axesOrigin[at] = origin;
	});
	grown.axisOrigins.forEach((origin, at) => {
		const held = origins.length + at;
		if (held < axesOrigin.length) axesOrigin[held] = origin;
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

