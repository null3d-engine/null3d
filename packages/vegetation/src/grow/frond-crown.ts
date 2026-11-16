// The frond-crown grower: palms and tree ferns on the directed design. One trunk rises straight,
// plumb or leaning one way, to a single growing point. Round that point the living fronds leave in
// a spiral, the youngest innermost and steepest, and each frond is a piece of the record standing
// whole at a socket of its own. Dead fronds hang under the living crown at sockets of their own; a
// fern's croziers stand at the centre as wood; a palm's date bunches hang from flower sites under
// its lowest fronds.
//
// A frond plant grows taller by its trunk, not by larger fronds. The plant is laid at the drawn
// height the variant asks for: the trunk takes the height and the crown keeps its measured size, so
// no later scale of the wood leaves the pieces at its sockets out of step.
//
// Every socket carries a rank, ranked once across the plant. Within each group (a rank of fronds,
// the dead fronds) a socket's place in the spiral is turned into a share by the radical inverse, so
// any leading run of the ranks stands spread round the trunk with an even share of every group. Each
// frond is a foliage mass of its own, so a sparser plant keeps a leading run of the ranks
// (grow/sparse.ts).
import {
	AXIS_RACHIS,
	AXIS_STEM,
	BUD_FLOWER,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	cross3,
	normalize3,
	PI,
	quatAxisAngle,
	quatFromFrame,
	quatMultiply,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { FrondCrown, Species } from '../core/record';
import { curveAt, spreadAt, spreadMean } from '../core/types';
import { type PieceRule, pieceKey, pieceTurn, planPiece } from '../leaf/piece';
import type { GrowInput } from '../stages';
import { targetHeight } from './height';
import type { Grower } from './models';
import { pieceNamed, radicalInverse } from './ranked';

/** Draw purposes, so no two draws share a key. The height takes the shared height purpose, 1. */
const DRAW = {
	lean: 2,
	leanTurn: 3,
	fronds: 4,
	start: 5,
	frondLeave: 6,
	frondTurn: 7,
	dead: 8,
	deadStart: 9,
	deadHang: 10,
	deadTurn: 11,
	croziers: 12,
	crozierTurn: 13,
	crozierLength: 14,
	crozierLean: 15,
	flowers: 16,
	flowerTurn: 17,
} as const;

/** Metres between the trunk's nodes. */
const TRUNK_NODE = 0.3;
/** Degrees a frond's leaving angle strays from its rank's, either way, in a rank with no spread. */
const LEAVE_JITTER = 4;
/** Degrees a frond's place round the trunk strays from the spiral's, either way. */
const TURN_JITTER = 6;
/** Degrees a dead frond's or a flower site's place strays from an even spacing, either way. */
const RING_JITTER = 12;
/** The steepest a frond may leave, in degrees above level: a socket's frame needs a sky side. */
const LEAVE_MOST = 88;
/**
 * How far out from the trunk's axis a living frond's base stands, as a share of the trunk's radius
 * at the base's own height: the youngest stand near the axis, the oldest at the trunk's surface.
 */
const BASE_IN = 0.3;
const BASE_OUT = 0.9;
/** Steps a frond's path is cut into when the grower reads how high and low it reaches. */
const PATH_STEPS = 64;
/** The share of a crozier's length that its straight stalk takes before the head curls. */
const CROZIER_STALK = 0.5;
/** The head's first radius as a share of the crozier's length, and how far it shrinks by its tip. */
const CROZIER_HEAD = 0.13;
const CROZIER_TIGHTEN = 0.8;
/** The least radius a crozier keeps, in metres of the wood mesh's ring. */
const CROZIER_TIP = 0.004;
/** Metres between a crozier's stalk nodes: fine enough that the wood mesher follows its coil. */
const CROZIER_NODE = 0.03;
/** Degrees of the coil between two of the head's nodes. */
const CROZIER_COIL_STEP = 18;
/** How far out a crozier's foot stands, as a share of the trunk's radius at the growing point. */
const CROZIER_STAND = 0.25;
/** Metres a flower site stands out from the trunk's surface. */
const FLOWER_OUT = 0.05;
/** The plant's least trunk, as a share of the record's: a short variant still stands on one. */
const TRUNK_LEAST = 0.3;

/** The record's frond-crown growth, or a fault for another model. */
function crownOf(record: Species): FrondCrown {
	if (record.growth.model !== 'frond-crown')
		throw new Error(
			`@null3d/vegetation: the frond-crown grower got a '${record.growth.model}' record`,
		);
	return record.growth;
}

/**
 * Each of `n` fronds' step through a range, from 0 to `n - 1`: the place of its radical inverse in
 * the base among the rank's, so the steps of any leading run of the rank stand spread through the
 * range. Two bases give two orders that do not follow one another.
 */
function orderSteps(n: number, base: number): number[] {
	const order = Array.from({ length: n }, (_, k) => k).sort(
		(a, b) => radicalInverse(a, base) - radicalInverse(b, base),
	);
	const steps = new Array<number>(n);
	order.forEach((k, place) => {
		steps[k] = place;
	});
	return steps;
}

/**
 * How high and how low a piece's main stem reaches from its foot, and how far out, in metres, when
 * it leaves at `leave` degrees above level at `length` times its rule's mean size: the planner's own
 * droop, turned toward the piece's ground side over the stretch the rule names.
 *
 * @param rule The piece's rule.
 * @param leave Degrees above level at the foot.
 * @param length The socket's scale.
 * @returns The highest and lowest points above the foot and the reach out from it.
 */
export function stemReach(
	rule: PieceRule,
	leave: number,
	length: number,
): { readonly top: number; readonly bottom: number; readonly reach: number } {
	const stem = rule.stem;
	const total = spreadMean(stem.length) * length;
	const droop = stem.droop ?? 0;
	const [from, to] = stem.droopOver ?? [0, 1];
	const span = Math.max(1e-6, to - from);
	const step = total / PATH_STEPS;
	let y = 0;
	let x = 0;
	let top = 0;
	let bottom = 0;
	for (let k = 0; k < PATH_STEPS; k++) {
		const share = (k + 0.5) / PATH_STEPS;
		const turned = droop * Math.min(1, Math.max(0, (share - from) / span));
		// The planner turns the stem toward its ground side, square to the way it left, and no farther.
		const elevation = radians(Math.max(leave - 90, leave - turned));
		y += sin(elevation) * step;
		x += cos(elevation) * step;
		top = Math.max(top, y);
		bottom = Math.min(bottom, y);
	}
	return { top, bottom, reach: x };
}

/** Each record's crown rise, found once: planning its fronds is the costly part. */
const RISES = new WeakMap<Species, number>();

/**
 * The highest a living frond of the crown reaches above the growing point, in metres: the crown's
 * own height, which the trunk stands under. Each rank's piece is planned and held as its sockets
 * hold it, rolled where its rule says, so a leaflet or a pinna that stands above the rachis counts.
 *
 * @param record The species record.
 * @returns The crown's rise above the growing point.
 */
export function crownRise(record: Species): number {
	const known = RISES.get(record);
	if (known !== undefined) return known;
	const growth = crownOf(record);
	const leaf =
		record.foliage.kind === 'blade'
			? spreadMean(record.foliage.leaf.length)
			: record.foliage.kind === 'needle' || record.foliage.kind === 'fascicle'
				? spreadMean(record.foliage.needle.length)
				: 0;
	const turn = [0, 0, 0, 1];
	const rolled = [0, 0, 0, 1];
	const point: Vector3 = [0, 0, 0];
	const placed: Vector3 = [0, 0, 0];
	let rise = 0;
	for (const rank of growth.fronds.ranks) {
		const { rule, index } = pieceNamed(record, rank.piece);
		const plan = planPiece(record, rule, pieceKey(index, 0), 1);
		// A rank with a stated spread rises by its steepest frond.
		const steepest = rank.leave + (rank.spread ?? 0);
		const held = pieceTurn(rule.attitude, heading(0, Math.min(LEAVE_MOST, steepest)));
		quatAxisAngle([0, 1, 0], radians(rule.roll ?? 0), turn);
		quatMultiply(held, 0, turn, 0, rolled);
		const top = (at: Readonly<Vector3>) => {
			quatRotate(rolled, 0, at, placed);
			rise = Math.max(rise, placed[1] * rank.length);
		};
		for (const axis of plan.axes) for (const p of axis) top(p.at);
		for (const l of plan.leaves) {
			const reach = leaf * l.scale;
			point[0] = l.at[0] + l.direction[0] * reach;
			point[1] = l.at[1] + l.direction[1] * reach;
			point[2] = l.at[2] + l.direction[2] * reach;
			top(point);
		}
	}
	RISES.set(record, rise);
	return rise;
}

/** One socket before its rank: what it carries, where it stands and which way it leaves. */
interface Planned {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly piece: number;
	readonly scale: number;
	readonly group: number;
	/** Its share in its group's order, which ranks it across the plant. */
	readonly share: number;
	/** How low its piece reaches below its foot, in metres. */
	readonly bottom: number;
}

/** A direction `elevation` degrees above level, toward `azimuth` radians round the plumb line. */
function heading(azimuth: number, elevation: number): Vector3 {
	const e = radians(elevation);
	return [cos(azimuth) * cos(e), sin(e), sin(azimuth) * cos(e)];
}

/**
 * Grows one frond-crown plant: its trunk at the variant's drawn height, its fronds as sockets round
 * the growing point, its dead fronds, croziers and flower sites.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growFrondCrown(input: GrowInput): MacroSkeleton {
	const { record, seed, variant } = input;
	const growth = crownOf(record);
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const builder = new SkeletonBuilder();

	// The trunk: straight, leaning one way, as tall as the drawn height leaves under the crown.
	const rise = crownRise(record);
	const target = targetHeight(record, seed, variant);
	const height = Math.max(TRUNK_LEAST * growth.trunk.height, target - rise);
	const lean = radians(Math.max(0, spreadAt(growth.trunk.lean, draw(DRAW.lean))));
	const leanTurn = draw(DRAW.leanTurn) * 2 * PI;
	const up: Vector3 = [sin(lean) * cos(leanTurn), cos(lean), sin(lean) * sin(leanTurn)];
	const radiusAt = (share: number) =>
		Math.max(0.005, curveAt(growth.trunk.width, Math.min(1, Math.max(0, share))) / 2);
	const trunk = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	// Nodes at an even spacing and at every knot of the width curve, so the foot's flare is drawn.
	const shares = new Set<number>([0, 1]);
	const steps = Math.max(2, Math.ceil(height / TRUNK_NODE));
	for (let k = 1; k < steps; k++) shares.add(k / steps);
	if (typeof growth.trunk.width !== 'number')
		for (const [share] of growth.trunk.width) if (share > 0 && share < 1) shares.add(share);
	let node = -1;
	for (const share of [...shares].sort((a, b) => a - b)) {
		const along = share * height;
		node = builder.addNode({
			x: up[0] * along,
			y: up[1] * along,
			z: up[2] * along,
			radius: radiusAt(share),
			parent: node,
			axis: trunk,
		});
	}
	const top = node;
	const point: Vector3 = [up[0] * height, up[1] * height, up[2] * height];
	const topRadius = radiusAt(1);
	/** A point on the trunk's axis `drop` metres under the growing point, `out` metres toward `azimuth`. */
	const onTrunk = (drop: number, azimuth: number, out: number): Vector3 => {
		const along = Math.max(0, height - drop);
		return [up[0] * along + cos(azimuth) * out, up[1] * along, up[2] * along + sin(azimuth) * out];
	};
	const radiusUnder = (drop: number) =>
		radiusAt(Math.max(0, height - drop) / Math.max(1e-6, height));

	const planned: Planned[] = [];
	// The living fronds, youngest first, shared out over the ranks in order.
	const ranks = growth.fronds.ranks;
	const count = Math.max(
		ranks.length,
		Math.round(spreadAt(growth.fronds.count, draw(DRAW.fronds))),
	);
	const start = draw(DRAW.start) * 2 * PI;
	const divergence = radians(growth.fronds.divergence);
	let first = 0;
	let sum = 0;
	ranks.forEach((rank, r) => {
		sum += rank.share;
		const last = r === ranks.length - 1 ? count : Math.max(first + 1, Math.round(sum * count));
		const { rule, index } = pieceNamed(record, rank.piece);
		// In rings, a rank's fronds stand evenly round the trunk, their places in the order the
		// plant thins them by, and their leaving angles in an order of another base.
		const rings = growth.fronds.layout === 'rings';
		const places = orderSteps(last - first, 2);
		const steps = orderSteps(last - first, rings ? 3 : 2);
		for (let i = first; i < last; i++) {
			const age = count > 1 ? i / (count - 1) : 0;
			const azimuth =
				(rings
					? start + r * divergence + (2 * PI * (places[i - first] as number)) / (last - first)
					: start + i * divergence) + radians((draw(DRAW.frondTurn, i) * 2 - 1) * TURN_JITTER);
			// A rank with a stated spread lays its fronds evenly over it, in an order unlike the
			// spiral's round the trunk; one without strays by a few degrees.
			const offset =
				rank.spread === undefined
					? (draw(DRAW.frondLeave, i) * 2 - 1) * LEAVE_JITTER
					: ((2 * ((steps[i - first] as number) + 0.5)) / (last - first) - 1) * rank.spread;
			const leave = Math.min(LEAVE_MOST, rank.leave + offset);
			const drop = growth.fronds.clasp * age;
			const out = radiusUnder(drop) * (BASE_IN + (BASE_OUT - BASE_IN) * age);
			planned.push({
				at: onTrunk(drop, azimuth, out),
				direction: heading(azimuth, leave),
				piece: index,
				scale: rank.length,
				group: r,
				share: radicalInverse(i - first),
				bottom: stemReach(rule, leave, rank.length).bottom,
			});
		}
		first = last;
	});

	// The dead fronds: a ring under the living crown, hanging close against the trunk.
	const dead = growth.dead;
	if (dead) {
		const { rule, index } = pieceNamed(record, dead.piece);
		const n = Math.max(0, Math.round(spreadAt(dead.count, draw(DRAW.dead))));
		const ring = draw(DRAW.deadStart) * 2 * PI;
		for (let k = 0; k < n; k++) {
			const azimuth =
				ring + (2 * PI * (k + 0.5)) / n + radians((draw(DRAW.deadTurn, k) * 2 - 1) * RING_JITTER);
			const drop = dead.from + (dead.to - dead.from) * radicalInverse(k);
			const leave = -Math.min(90, Math.max(0, spreadAt(dead.hang, draw(DRAW.deadHang, k))));
			planned.push({
				at: onTrunk(drop, azimuth, radiusUnder(drop)),
				direction: heading(azimuth, Math.max(-LEAVE_MOST, leave)),
				piece: index,
				scale: dead.length,
				group: ranks.length,
				share: radicalInverse(k),
				bottom: stemReach(rule, leave, dead.length).bottom,
			});
		}
	}

	// Each socket's rank, once across the plant: by its share in its group, then by its group.
	const kept = planned
		.map((socket, i) => ({ socket, i }))
		.sort(
			(a, b) => a.socket.share - b.socket.share || a.socket.group - b.socket.group || a.i - b.i,
		);
	const frame = [0, 0, 0, 1];
	const sky: Vector3 = [0, 1, 0];
	let lowest = height;
	kept.forEach(({ socket }, rank) => {
		quatFromFrame(socket.direction, sky, frame);
		builder.addBud({
			node: top,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: trunk,
			woodRadius: topRadius,
			// Each frond is a foliage mass of its own, so a sparser plant takes its fronds one by one
			// in their ranks, never a whole rank at once.
			socket: { scale: socket.scale, rank, lobe: rank, piece: socket.piece },
		});
		lowest = Math.min(lowest, socket.at[1] + socket.bottom);
	});

	// The flower sites, a ring between the lowest living fronds.
	const flowers = growth.flowers;
	if (flowers) {
		const n = Math.max(0, Math.round(spreadAt(flowers.count, draw(DRAW.flowers))));
		for (let k = 0; k < n; k++) {
			const azimuth =
				start +
				(2 * PI * (k + 0.5)) / n +
				radians((draw(DRAW.flowerTurn, k) * 2 - 1) * RING_JITTER);
			const drop = flowers.from + (flowers.to - flowers.from) * radicalInverse(k);
			const at = onTrunk(drop, azimuth, radiusUnder(drop) + FLOWER_OUT);
			quatFromFrame(heading(azimuth, -flowers.leave), sky, frame);
			builder.addBud({
				node: top,
				x: at[0],
				y: at[1],
				z: at[2],
				frame,
				kind: BUD_FLOWER,
				vigor: 0.5,
				light: 1,
				axis: trunk,
				woodRadius: radiusUnder(drop),
			});
		}
	}

	// The croziers: young fronds still rolled, drawn as the trunk's own hairy wood.
	const croziers = growth.croziers;
	if (croziers) {
		const n = Math.max(0, Math.round(spreadAt(croziers.count, draw(DRAW.croziers))));
		for (let k = 0; k < n; k++)
			layCrozier(builder, croziers, trunk, top, point, topRadius, k, n, draw);
	}
	return builder.finish(Math.max(0, lowest));
}

/**
 * Lays one crozier: a stout stalk that rises from the growing point, leaning out a little, and ends
 * in a flat coil that tightens toward its tip, curling out over the crown's centre.
 */
function layCrozier(
	builder: SkeletonBuilder,
	croziers: NonNullable<FrondCrown['croziers']>,
	trunk: number,
	top: number,
	point: Readonly<Vector3>,
	topRadius: number,
	k: number,
	n: number,
	draw: (purpose: number, index?: number) => number,
): void {
	const length = Math.max(0.05, spreadAt(croziers.length, draw(DRAW.crozierLength, k)));
	const coil = radians(Math.max(0, croziers.coil));
	const azimuth = (2 * PI * k) / Math.max(1, n) + draw(DRAW.crozierTurn, k) * 1.2;
	const lean = radians(draw(DRAW.crozierLean, k) * croziers.lean);
	const horizontal: Vector3 = [cos(azimuth), 0, sin(azimuth)];
	const side: Vector3 = [-horizontal[2], 0, horizontal[0]];
	const stalk = normalize3([horizontal[0] * sin(lean), cos(lean), horizontal[2] * sin(lean)]);
	// The head turns in the plane of the stalk and the way it leans, curling outward over the top.
	const across = normalize3(cross3(stalk, side, [0, 0, 0]));
	const stand = topRadius * CROZIER_STAND;
	const base: Vector3 = [
		point[0] + horizontal[0] * stand,
		point[1],
		point[2] + horizontal[2] * stand,
	];
	const radius = Math.max(croziers.radius, CROZIER_TIP);
	const axis = builder.addAxis({
		parent: trunk,
		parentNode: top,
		parentT: 0,
		order: 1,
		kind: AXIS_RACHIS,
		grownBark: true,
	});
	const stalkLength = length * CROZIER_STALK;
	const headRadius = length * CROZIER_HEAD;
	const coilLength = 0.5 * (2 - CROZIER_TIGHTEN) * coil * headRadius;
	let previous = -1;
	const addPoint = (at: Vector3, share: number): void => {
		// The head swells where the blade is rolled, then closes to a point.
		const swell = 0.5 * radius * sin(PI * Math.min(1, Math.max(0, share)));
		previous = builder.addNode({
			x: at[0],
			y: at[1],
			z: at[2],
			radius: Math.max(CROZIER_TIP, radius * (1 - 0.6 * share) + swell),
			parent: previous,
			axis,
			light: 1,
			age: 0,
		});
	};
	const stalkCount = Math.max(2, Math.ceil(stalkLength / CROZIER_NODE));
	for (let i = 0; i <= stalkCount; i++) {
		const run = (stalkLength * i) / stalkCount;
		addPoint(
			[base[0] + stalk[0] * run, base[1] + stalk[1] * run, base[2] + stalk[2] * run],
			run / length,
		);
	}
	const head: Vector3 = [
		base[0] + stalk[0] * stalkLength + across[0] * headRadius,
		base[1] + stalk[1] * stalkLength + across[1] * headRadius,
		base[2] + stalk[2] * stalkLength + across[2] * headRadius,
	];
	const coilCount = Math.max(6, Math.ceil(coil / radians(CROZIER_COIL_STEP)));
	for (let i = 1; i <= coilCount; i++) {
		const t = i / coilCount;
		const angle = coil * t;
		const r = headRadius * (1 - CROZIER_TIGHTEN * t);
		addPoint(
			[
				head[0] - across[0] * r * cos(angle) + stalk[0] * r * sin(angle),
				head[1] - across[1] * r * cos(angle) + stalk[1] * r * sin(angle),
				head[2] - across[2] * r * cos(angle) + stalk[2] * r * sin(angle),
			],
			(stalkLength + coilLength * t) / length,
		);
	}
}

/** The frond-crown grower: a trunk and its sockets, whose pieces the kit builds from the record. */
export const grower: Grower = {
	grow: growFrondCrown,
};
