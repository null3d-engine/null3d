// The planned model's rosette: one growing point with a socket a frond. A rosette grows no woody
// axis above its trunk, so the fronds themselves make the crown's reach and its box. Each rank of
// fronds carries its own piece, and the dead skirt carries a brown one, as a tree fern's does.
//
// The plan keeps its shared cap rule and price table: a frond is one socket, priced at the record's
// piece, and one clump under a maximum, so a capped crown draws a card a frond. Sparseness keeps a
// spread rank of the fronds whole, never half a frond.
import { BUD_TERMINAL, type ClumpData, type SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	quatAxisAngle,
	quatFromFrame,
	quatMultiply,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import { thinningRanks } from '../core/rank';
import type { FrondCrown, Planned, PlannedRosette, Species } from '../core/record';
import { curveAt, type Spread, spreadAt, spreadMean, type Vec3 } from '../core/types';
import { type PieceRule, pieceKey, pieceTurn, planPiece } from '../leaf/piece';
import { layCrozier } from './frond-crown';
import {
	crownOf,
	type ModelAxis,
	type ModelPiece,
	type ModelSocket,
	type PlantModel,
} from './model';
import { pieceNamed, radicalInverse } from './ranked';

/**
 * A frond's base stands this share of the trunk's top radius from its axis, at the youngest, and
 * this share at the oldest.
 */
const BASE_IN = 0.3;
const BASE_OUT = 0.9;
/** The steepest a frond leaves, in degrees above level: a socket's frame needs a sky side. */
const LEAVE_MOST = 88;
/** Degrees a frond's leaving angle strays from its rank's where the rank states no spread. */
const LEAVE_JITTER = 4;
/** Degrees a frond's place strays from its spiral or ring place, either way. */
const TURN_JITTER = 6;
/** Degrees a dead frond's place strays from an even spacing, either way. */
const RING_JITTER = 12;
/** The size a frond starts at, as a share of its own, when the plant first stands. */
const FROND_START = 0.35;
/** The share of the adult frond count a young plant carries. */
const FRONDS_START = 0.25;
/** The share of the trunk's height from which the dead skirt shows: a young fern keeps none. */
const DEAD_FROM = 0.5;
/** The least height above the ground a piece may reach, in metres. */
const ABOVE_GROUND = 0.02;
/** The purposes of the draws, each its own key. */
const DRAW = {
	fronds: 20,
	start: 21,
	frondTurn: 22,
	frondLeave: 23,
	dead: 24,
	deadStart: 25,
	deadHang: 26,
	deadTurn: 27,
	croziers: 28,
} as const;

/** One socket the rosette lays, before sparseness and the maximum are read. */
export interface RosetteSocket {
	/** Where its base stands. */
	readonly at: Vector3;
	/** The way its piece leaves the base. */
	readonly direction: Vector3;
	/** The piece it carries, by its place among the record's pieces. */
	readonly piece: number;
	/** The size of its piece against the piece's own. */
	readonly scale: number;
	/** The rank it belongs to: the living ranks' places, then the dead skirt. */
	readonly group: number;
	/** Its share in its group's order. */
	readonly share: number;
	/** Its place in the plant's full layout, so a kept socket keeps its variant. */
	readonly place: number;
	/** Its height above the ground. */
	readonly y: number;
	/** Its piece's reach from the base, in metres. */
	readonly reach: number;
	/** Its place in the order the plant thins by, from 0 at the best kept. */
	readonly rank: number;
}

/** What a rosette's fill adds to a skeleton. */
export interface RosetteFill {
	/** The living and dead sockets it laid. */
	readonly laid: number;
	/** The sockets it kept after sparseness and the maximum. */
	readonly sockets: number;
	/** The sockets it shed. */
	readonly shed: number;
	/** The buds' origins, in the buds' own order. */
	readonly origins: Uint32Array;
	/** One clump a kept socket, for the crown's cards. */
	readonly clumps: ClumpData[];
	/** The crown's box, from the trunk's nodes and the fronds' own reach. */
	readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
	/** The plant's top, from the fronds' own reach. */
	readonly height: number;
	/** The lowest foliage: the skirt's tips, at the full plant. */
	readonly crownBase: number;
}

/** A direction `elevation` degrees above level, toward `azimuth` radians round the plumb line. */
function heading(azimuth: number, elevation: number): Vector3 {
	const e = radians(elevation);
	return [cos(azimuth) * cos(e), sin(e), sin(azimuth) * cos(e)];
}

/** The steps of a range in an order whose every leading run stands spread through it. */
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

/** The nearest of the trunk's built radii to a height. */
function radiusAt(
	nodes: readonly { readonly y: number; readonly radius: number }[],
	y: number,
): number {
	if (nodes.length === 0) return 0;
	let nearest = nodes[0] as { y: number; radius: number };
	let least = Math.abs(nearest.y - y);
	for (const node of nodes) {
		const away = Math.abs(node.y - y);
		if (away < least) {
			least = away;
			nearest = node;
		}
	}
	return nearest.radius;
}

/** The points of a piece in its own rest frame, its middle and its reach from its base. */
interface PieceShape {
	readonly points: readonly Vector3[];
	readonly middle: Vector3;
	readonly reach: number;
	readonly leaves: number;
}

/** Each record's pieces, found once: planning a frond is the costly part. */
const SHAPES = new WeakMap<Species, Map<number, PieceShape>>();

/** The points that a piece's plan reaches, in its rest frame, with its middle and its reach. */
function pieceShape(record: Species, piece: number, rule: PieceRule): PieceShape {
	let known = SHAPES.get(record);
	if (!known) {
		known = new Map();
		SHAPES.set(record, known);
	}
	const held = known.get(piece);
	if (held) return held;
	const plan = planPiece(record, rule, pieceKey(piece, 0), 1);
	const foliage = record.foliage;
	const leaf =
		foliage.kind === 'blade'
			? spreadMean(foliage.leaf.length)
			: foliage.kind === 'needle' || foliage.kind === 'fascicle'
				? spreadMean(foliage.needle.length)
				: 0;
	const points: Vector3[] = [];
	for (const axis of plan.axes) for (const point of axis) points.push([...point.at]);
	for (const l of plan.leaves) {
		const reach = leaf * l.scale;
		points.push([
			l.at[0] + l.direction[0] * reach,
			l.at[1] + l.direction[1] * reach,
			l.at[2] + l.direction[2] * reach,
		]);
	}
	let middle: Vector3 = [0, 0, 0];
	for (const point of points) {
		middle = [middle[0] + point[0], middle[1] + point[1], middle[2] + point[2]];
	}
	const many = Math.max(1, points.length);
	middle = [middle[0] / many, middle[1] / many, middle[2] / many];
	let reach = 0;
	for (const point of points) {
		const dx = point[0] - middle[0];
		const dy = point[1] - middle[1];
		const dz = point[2] - middle[2];
		reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy + dz * dz));
	}
	const shape: PieceShape = { points, middle, reach, leaves: plan.leaves.length };
	known.set(piece, shape);
	return shape;
}

/** A piece's point, turned from its rest frame into the plant and placed at a socket's base. */
function turnPoint(
	point: Readonly<Vector3>,
	turned: readonly number[],
	scale: number,
	at: Readonly<Vector3>,
	out: Vector3,
): void {
	quatRotate(turned, 0, point, out);
	out[0] = at[0] + out[0] * scale;
	out[1] = at[1] + out[1] * scale;
	out[2] = at[2] + out[2] * scale;
}

/** The fronds and dead skirt a record states, whether it grows by the planned model or the frond crown. */
interface RosetteShape {
	readonly count: Spread;
	readonly divergence: number;
	readonly layout: 'rings' | 'spiral';
	readonly clasp: number;
	readonly scale?: number;
	readonly ranks: readonly {
		readonly share: number;
		readonly piece: string;
		readonly leave: number;
		readonly spread?: number;
		readonly length?: number;
	}[];
	readonly dead?: {
		readonly count: Spread;
		readonly piece: string;
		readonly hang: Spread;
		readonly from: number;
		readonly to: number;
		readonly length: number;
	};
	/** Whether the dead skirt's band is shares of the height; a frond crown states metres. */
	readonly deadShares: boolean;
}

/** The rosette shape a record states, from either of the family's two growth blocks. */
function shapeOf(record: Species): RosetteShape {
	const growth = record.growth;
	if (growth.model === 'planned' && growth.rosette) {
		const rosette = growth.rosette as PlannedRosette;
		return {
			count: rosette.fronds.count,
			divergence: rosette.fronds.divergence,
			layout: rosette.fronds.layout,
			clasp: rosette.fronds.clasp,
			...(rosette.fronds.scale === undefined ? {} : { scale: rosette.fronds.scale }),
			ranks: rosette.ranks,
			...(rosette.dead === undefined ? {} : { dead: rosette.dead }),
			deadShares: true,
		};
	}
	if (growth.model === 'frond-crown') {
		const crown = growth as FrondCrown;
		return {
			count: crown.fronds.count,
			divergence: crown.fronds.divergence,
			layout: crown.fronds.layout ?? 'spiral',
			clasp: crown.fronds.clasp,
			ranks: crown.fronds.ranks.map((rank) => ({
				share: rank.share,
				piece: rank.piece,
				leave: rank.leave,
				...(rank.spread === undefined ? {} : { spread: rank.spread }),
				...(rank.length === undefined ? {} : { length: rank.length }),
			})),
			...(crown.dead === undefined ? {} : { dead: crown.dead }),
			deadShares: false,
		};
	}
	throw new Error(`@null3d/vegetation: '${record.id}' is not a frond-crown or rosette plant`);
}

/** What a rosette's layout reads: the record, its state and the trunk the shared grow built. */
export interface RosetteLayoutInput {
	readonly record: Species;
	readonly growth: Planned | FrondCrown;
	readonly seed: number;
	readonly variant: number;
	readonly at: Readonly<Vector3>;
	readonly height: number;
	readonly adultHeight: number;
	readonly topRadius: number;
	readonly trunkNodes: readonly { readonly y: number; readonly radius: number }[];
}

/**
 * Lays a rosette's sockets: the living fronds in their ranks, then the dead skirt. Each socket's
 * place in the plant's full layout is fixed, so a socket kept at one sparseness keeps its variant
 * at every other. The rank orders the sockets for the shared grow's thinning.
 *
 * @param input The record, the growth, the seed, the variant and the trunk's built top.
 * @returns The plant's full layout, ranked.
 */
export function layoutRosette(input: RosetteLayoutInput): RosetteSocket[] {
	const { record, seed, variant, at, height, adultHeight, topRadius, trunkNodes } = input;
	const form = shapeOf(record);
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const share = Math.max(0, Math.min(1, height / Math.max(1e-9, adultHeight)));
	const size = FROND_START + (1 - FROND_START) * share;
	const young = FRONDS_START + (1 - FRONDS_START) * share;
	const laid: RosetteSocket[] = [];
	const ranks = form.ranks;
	const full = Math.max(ranks.length, Math.round(spreadAt(form.count, draw(DRAW.fronds)) * young));
	const start = draw(DRAW.start) * 2 * Math.PI;
	const divergence = radians(form.divergence);
	const rings = form.layout === 'rings';
	// The living fronds, youngest first, shared out over the ranks in order.
	let first = 0;
	let sum = 0;
	ranks.forEach((rank, r) => {
		sum += rank.share;
		const last = r === ranks.length - 1 ? full : Math.max(first + 1, Math.round(sum * full));
		const named = pieceNamed(record, rank.piece);
		const places = orderSteps(last - first, 2);
		const steps = orderSteps(last - first, rings ? 3 : 2);
		for (let i = first; i < last; i++) {
			const age = full > 1 ? i / (full - 1) : 0;
			const azimuth =
				(rings
					? start + r * divergence + (2 * Math.PI * (places[i - first] as number)) / (last - first)
					: start + i * divergence) + radians((draw(DRAW.frondTurn, i) * 2 - 1) * TURN_JITTER);
			// A rank with a stated spread lays its fronds evenly over it; one without strays a little.
			const offset =
				rank.spread === undefined
					? (draw(DRAW.frondLeave, i) * 2 - 1) * LEAVE_JITTER
					: ((2 * ((steps[i - first] as number) + 0.5)) / (last - first) - 1) * rank.spread;
			const leave = Math.min(LEAVE_MOST, rank.leave + offset);
			// The bases stand down the trunk's top as the fronds age, the oldest lowest, and out from
			// its axis: the youngest near it, the oldest at its surface.
			const drop = Math.min(height, form.clasp * age);
			const out = topRadius * (BASE_IN + (BASE_OUT - BASE_IN) * age);
			const base: Vector3 = [at[0] + cos(azimuth) * out, at[1] - drop, at[2] + sin(azimuth) * out];
			const shape = pieceShape(record, named.index, named.rule);
			// A young plant's fronds stay above the ground: the piece's reach is the most a frond can
			// drop from its base, so a shorter piece keeps the crown on the plant.
			const wanted = (form.scale ?? 1) * (rank.length ?? 1) * size;
			const scale = Math.min(
				wanted,
				Math.max(0, base[1] - ABOVE_GROUND) / Math.max(1e-3, shape.reach),
			);
			laid.push({
				at: base,
				direction: heading(azimuth, leave),
				piece: named.index,
				scale,
				group: r,
				share: radicalInverse(i - first),
				place: laid.length,
				y: base[1],
				reach: shape.reach * scale,
				rank: 0,
			});
		}
		first = last;
	});
	// The dead fronds: a ring under the living crown, hanging against the trunk. A young plant has
	// built no trunk to hang them against, so the skirt shows once the stem has grown.
	const dead = form.dead && share >= DEAD_FROM ? form.dead : undefined;
	if (dead) {
		const named = pieceNamed(record, dead.piece);
		const n = Math.max(0, Math.round(spreadAt(dead.count, draw(DRAW.dead)) * young));
		const ring = draw(DRAW.deadStart) * 2 * Math.PI;
		for (let k = 0; k < n; k++) {
			const azimuth =
				ring +
				(2 * Math.PI * (k + 0.5)) / Math.max(1, n) +
				radians((draw(DRAW.deadTurn, k) * 2 - 1) * RING_JITTER);
			const from = form.deadShares ? dead.from * height : dead.from;
			const to = form.deadShares ? dead.to * height : dead.to;
			const drop = from + (to - from) * radicalInverse(k);
			const hang = Math.min(90, Math.max(0, spreadAt(dead.hang, draw(DRAW.deadHang, k))));
			const radius = radiusAt(trunkNodes, Math.max(0, at[1] - drop));
			const base: Vector3 = [
				at[0] + cos(azimuth) * radius,
				Math.max(0, at[1] - drop),
				at[2] + sin(azimuth) * radius,
			];
			const shape = pieceShape(record, named.index, named.rule);
			const wanted = (form.scale ?? 1) * dead.length * size;
			const scale = Math.min(
				wanted,
				Math.max(0, base[1] - ABOVE_GROUND) / Math.max(1e-3, shape.reach),
			);
			laid.push({
				at: base,
				direction: heading(azimuth, -hang),
				piece: named.index,
				scale,
				group: ranks.length,
				share: radicalInverse(k),
				place: laid.length,
				y: base[1],
				reach: shape.reach * scale,
				rank: 0,
			});
		}
	}
	// Each socket's rank, once across the plant: by its share in its group, then by its group.
	const ranked = laid
		.map((socket, i) => ({ socket, i }))
		.sort(
			(a, b) => a.socket.share - b.socket.share || a.socket.group - b.socket.group || a.i - b.i,
		);
	// The rank is read from each frond's tip, not its base: every base stands at the growing point,
	// so a rank read there would keep the first fronds of the order rather than a spread of the crown.
	const ranksOf = thinningRanks(
		ranked.map(({ socket }) => [
			socket.at[0] + socket.direction[0] * socket.reach,
			socket.at[1] + socket.direction[1] * socket.reach,
			socket.at[2] + socket.direction[2] * socket.reach,
		]),
	);
	const rankAt = new Map<number, number>();
	ranked.forEach(({ i }, rank) => {
		rankAt.set(i, ranksOf[rank] as number);
	});
	return laid.map((socket, i) => ({ ...socket, rank: rankAt.get(i) ?? i }));
}

/**
 * The sockets sparseness and a maximum keep: the plant's own rank, the dead skirt after the living
 * under a cap, and each kept frond whole. The layout is the same at every state, so a sparser plant
 * is a subset of a denser one.
 *
 * @param input The layout's own input, the share sparseness keeps and the fronds a maximum pays for.
 * @returns The kept sockets, how many the layout laid, and the full ranked layout.
 */
export function layRosette(
	input: RosetteLayoutInput & {
		/** The share of the fronds sparseness keeps. */
		readonly leaves: number;
		/** The fronds a maximum pays a card for; absent when no maximum bites. */
		readonly cards?: number;
	},
): {
	readonly kept: RosetteSocket[];
	readonly laid: number;
	readonly all: readonly RosetteSocket[];
} {
	const all = layoutRosette(input);
	const ranks = shapeOf(input.record).ranks;
	const capped = input.cards !== undefined;
	const order = all.slice().sort((a, b) => {
		// A maximum drops the dead skirt before any living frond: the living fountain carries the
		// species at a low cap, and the skirt is the first thing the owner's standard gives up.
		if (capped) {
			const aDead = a.group >= ranks.length ? 1 : 0;
			const bDead = b.group >= ranks.length ? 1 : 0;
			if (aDead !== bDead) return aDead - bDead;
		}
		return a.rank - b.rank || a.place - b.place;
	});
	// A maximum keeps the fronds its cards pay for; sparseness keeps its own share. A frond is kept
	// whole, so a sparse or capped crown is a set of whole fronds, never half of one.
	const keep = Math.min(
		Math.max(0, Math.min(1, input.leaves)),
		input.cards === undefined ? 1 : Math.max(0, Math.min(1, input.cards / Math.max(1, all.length))),
	);
	const most = Math.max(0, Math.round(all.length * keep));
	return { kept: order.slice(0, most), laid: all.length, all };
}

/** A piece's points in the plant at one socket, and the piece's own middle, turned as it is held. */
function placedPoints(
	record: Species,
	socket: RosetteSocket,
): { readonly points: readonly Vector3[]; readonly middle: Vector3 } {
	const rule = (record.pieces ?? [])[socket.piece] as PieceRule;
	const spin = [0, 0, 0, 1];
	const rolled = [0, 0, 0, 1];
	const turned = pieceTurn(rule.attitude, socket.direction);
	quatAxisAngle([0, 1, 0], radians(rule.roll ?? 0), spin);
	quatMultiply(turned, 0, spin, 0, rolled);
	const shape = pieceShape(record, socket.piece, rule);
	const at = socket.at;
	const placed = (local: Readonly<Vector3>): Vector3 => {
		const out: Vector3 = [0, 0, 0];
		quatRotate(rolled, 0, local, out);
		return [
			at[0] + out[0] * socket.scale,
			at[1] + out[1] * socket.scale,
			at[2] + out[2] * socket.scale,
		];
	};
	return { points: shape.points.map(placed), middle: placed(shape.middle) };
}

/**
 * Writes the frond-crown and rosette family's intermediate model at one state: the trunk axis, one
 * socket a frond with its carrier, and the pieces their own measured figures state. The adapter
 * writes no geometry, material or level; the shared stages price, grow, close, allocate and bake
 * the model (D-377). Its crown box is read from the pieces, never stated beside them.
 *
 * @param input The layout's input, the share sparseness keeps and the share of the adult height the
 *   state stands at.
 * @returns The model.
 * @category api/vegetation
 */
function modelOf(
	record: Species,
	all: readonly RosetteSocket[],
	trunk: {
		readonly at: Readonly<Vector3>;
		readonly height: number;
		readonly topRadius: number;
		readonly trunkNodes: readonly { readonly y: number; readonly radius: number }[];
	},
	floor: number,
	leaves: number,
	scale: number,
): PlantModel {
	const { at, height, topRadius, trunkNodes } = trunk;
	const floorShare = Math.max(0, Math.min(1, floor));
	const least = Math.max(1, Math.round(all.length * floorShare));
	const sockets: ModelSocket[] = all.map((socket) => ({
		axis: 0,
		order: 1,
		share: Math.max(0, Math.min(1, socket.at[1] / Math.max(1e-9, height))),
		at: socket.at,
		direction: socket.direction,
		piece: socket.piece,
		scale: socket.scale,
		keep: socket.rank < least ? 0 : (socket.rank - least + 1) / (all.length - least + 1),
		group: socket.group,
	}));
	const pieces: ModelPiece[] = (record.pieces ?? []).map((rule, index) => {
		const shape = pieceShape(record, index, rule);
		const carriers = all.filter((socket) => socket.piece === index);
		const own = Math.max(1e-9, carriers[0]?.scale ?? 1);
		let top = 0;
		let reach = 0;
		let bottom = 0;
		for (const socket of carriers) {
			for (const point of placedPoints(record, socket).points) {
				const dx = point[0] - socket.at[0];
				const dz = point[2] - socket.at[2];
				top = Math.max(top, point[1] - socket.at[1]);
				bottom = Math.max(bottom, socket.at[1] - point[1]);
				reach = Math.max(reach, Math.sqrt(dx * dx + dz * dz));
			}
		}
		// The piece's own breadth and depth, not its rachis: the frond is its pinnae, and the
		// shared price and bake read the piece's size and the leaf figures, never the stem alone.
		let halfWidth = 0;
		let halfDepth = 0;
		for (const point of shape.points) {
			halfWidth = Math.max(halfWidth, Math.abs(point[0]));
			halfDepth = Math.max(halfDepth, Math.abs(point[2]));
		}
		const leaf =
			record.foliage.kind === 'blade'
				? record.foliage.leaf
				: record.foliage.kind === 'needle' || record.foliage.kind === 'fascicle'
					? record.foliage.needle
					: undefined;
		const leafLength = leaf ? spreadMean(leaf.length) : 0;
		const leafBreadth = leaf !== undefined && 'breadth' in leaf ? (leaf.breadth ?? 0) : 0;
		const rachis = rule.stem.radius[0] * 2;
		return {
			name: rule.name,
			length: spreadMean(rule.stem.length),
			width: halfWidth * 2,
			depth: halfDepth * 2,
			top: top / own,
			reach: reach / own,
			bottom: bottom / own,
			middle: shape.middle,
			figures: {
				frondLength: spreadMean(rule.stem.length),
				frondWidth: halfWidth * 2,
				frondDepth: halfDepth * 2,
				leafLength,
				leafBreadth,
				pinnae: shape.leaves,
				rachis,
				top: top / own,
				reach: reach / own,
				bottom: bottom / own,
				...(rule.browning === undefined ? {} : { browning: rule.browning }),
			},
		};
	});
	const foot = trunkNodes[0] ?? { y: 0, radius: topRadius };
	const axis: ModelAxis = {
		order: 0,
		parent: -1,
		parentShare: 0,
		from: [0, 0, 0],
		to: [at[0], at[1], at[2]],
		nodes: trunkNodes.map((node) => ({
			at: [
				at[0] * (node.y / Math.max(1e-9, height)),
				node.y,
				at[2] * (node.y / Math.max(1e-9, height)),
			],
			radius: node.radius,
		})),
		radius: [foot.radius, topRadius],
		body: true,
	};
	const crown = crownOf(sockets, pieces);
	return {
		species: record.id,
		axes: [axis],
		sockets,
		pieces,
		least,
		scale,
		keepShare: Math.max(0, Math.min(1, leaves)),
		crown: { top: crown.top, reach: crown.reach, base: crown.base },
	};
}

/**
 * Writes a planned rosette's intermediate model at one state: the trunk axis, one socket a frond
 * with its carrier, and the pieces their own measured figures state. The adapter writes no
 * geometry, material or level; the shared stages price, grow, close, allocate and bake the model
 * (D-377). Its crown box is read from the pieces, never stated beside them.
 *
 * @param input The layout's input, the share sparseness keeps and the share of the adult height the
 *   state stands at.
 * @returns The model.
 * @category api/vegetation
 */
export function emitRosette(
	input: RosetteLayoutInput & {
		/** The share of the fronds the state's sparseness keeps. */
		readonly leaves: number;
		/** The share of the adult height the emitted state stands at. */
		readonly scale: number;
		/** The share of the fronds the sparsest plant keeps; the planned record's own curve by default. */
		readonly floor?: number;
	},
): PlantModel {
	const all = layoutRosette(input);
	const floor =
		input.floor ?? Math.max(0, Math.min(1, curveAt((input.record.growth as Planned).leavesAt, 1)));
	return modelOf(
		input.record,
		all,
		{
			at: input.at,
			height: input.height,
			topRadius: input.topRadius,
			trunkNodes: input.trunkNodes,
		},
		floor,
		input.leaves,
		input.scale,
	);
}

/**
 * Writes a frond crown's intermediate model at its record's own adult: the trunk axis, one socket a
 * frond with its carrier, the dead skirt and the pieces' measured figures. The adapter writes no
 * geometry, material or level.
 *
 * @param input The record, the seed and the variant.
 * @returns The model.
 * @category api/vegetation
 */
export function emitFrondCrown(input: {
	readonly record: Species;
	readonly seed: number;
	readonly variant: number;
}): PlantModel {
	const growth = input.record.growth;
	if (growth.model !== 'frond-crown')
		throw new Error(`@null3d/vegetation: '${input.record.id}' does not grow a frond crown`);
	const crown = growth as FrondCrown;
	const height = crown.trunk.height;
	const at: Vector3 = [0, height, 0];
	const topRadius = curveAt(crown.trunk.width, 1) / 2;
	const steps = Math.max(2, Math.round(height / 0.3));
	const trunkNodes = Array.from({ length: steps + 1 }, (_, k) => ({
		y: (height * k) / steps,
		radius: curveAt(crown.trunk.width, k / steps) / 2,
	}));
	const all = layoutRosette({
		record: input.record,
		growth,
		seed: input.seed,
		variant: input.variant,
		at,
		height,
		adultHeight: height,
		topRadius,
		trunkNodes,
	});
	const floor = Math.max(0, Math.min(1, input.record.sparse?.foliage ?? 0.08));
	return modelOf(input.record, all, { at, height, topRadius, trunkNodes }, floor, 1, 1);
}

/**
 * Fills a rosette into a skeleton: a bud a kept frond, and the croziers as the trunk's own wood.
 * The crown's box comes from the fronds' pieces, so the plant's top and its lowest foliage are the
 * pieces' own reach.
 *
 * @param input The record, the growth, the builder, the trunk's built axis and top, the share that
 *   sparseness keeps and the fronds a maximum pays for.
 * @returns The fill's counts, the clumps and the crown's box.
 */
export function fillRosette(input: {
	readonly record: Species;
	readonly growth: Planned;
	readonly builder: SkeletonBuilder;
	readonly seed: number;
	readonly variant: number;
	readonly at: Readonly<Vector3>;
	readonly height: number;
	readonly adultHeight: number;
	readonly topRadius: number;
	readonly trunkAxis: number;
	readonly trunkTop: number;
	readonly trunkNodes: readonly { readonly y: number; readonly radius: number }[];
	/** The share of the fronds sparseness keeps. */
	readonly leaves: number;
	/** The fronds a maximum pays a card for; absent when no maximum bites. */
	readonly cards?: number;
	readonly croziersAllowed: boolean;
}): RosetteFill {
	const { record, growth, builder, seed, variant, at, height, adultHeight, topRadius, trunkAxis } =
		input;
	const rosette = growth.rosette as PlannedRosette;
	const { kept, laid, all } = layRosette({
		record,
		growth,
		seed,
		variant,
		at,
		height,
		adultHeight,
		topRadius,
		trunkNodes: input.trunkNodes,
		leaves: input.leaves,
		...(input.cards === undefined ? {} : { cards: input.cards }),
	});
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const frame = [0, 0, 0, 1];
	const sky: Vector3 = [0, 1, 0];
	const rolled = [0, 0, 0, 1];
	const spin = [0, 0, 0, 1];
	const point: Vector3 = [0, 0, 0];
	const held: Vector3 = [0, 0, 0];
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
	let crownBase = Number.POSITIVE_INFINITY;
	/** The turn that holds a socket's piece in the plant, and the piece's own shape. */
	const hold = (socket: RosetteSocket): { shape: PieceShape; rolled: number[] } => {
		const rule = (record.pieces ?? [])[socket.piece] as PieceRule;
		const turned = pieceTurn(rule.attitude, socket.direction);
		quatAxisAngle([0, 1, 0], radians(rule.roll ?? 0), spin);
		quatMultiply(turned, 0, spin, 0, rolled);
		return { shape: pieceShape(record, socket.piece, rule), rolled };
	};
	// The crown's box is read from every frond the plant carries at this age, before sparseness and
	// the maximum take any: neither may move the crown's box.
	for (const socket of all) {
		const { shape, rolled: turn } = hold(socket);
		for (const local of shape.points) {
			turnPoint(local, turn, socket.scale, socket.at, point);
			for (let c = 0; c < 3; c++) {
				min[c] = Math.min(min[c] as number, point[c] as number);
				max[c] = Math.max(max[c] as number, point[c] as number);
			}
			crownBase = Math.min(crownBase, point[1]);
		}
	}
	const clumps: ClumpData[] = [];
	const origins = new Uint32Array(kept.length);
	kept.forEach((socket, b) => {
		quatFromFrame(socket.direction, sky, frame);
		builder.addBud({
			node: input.trunkTop,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: trunkAxis,
			woodRadius: radiusAt(input.trunkNodes, socket.at[1]),
			socket: { scale: socket.scale, rank: b, lobe: b, piece: socket.piece },
		});
		origins[b] = socket.place;
		// A kept frond's own card stands at its piece's middle, its half-size the piece's reach.
		const { shape, rolled: turn } = hold(socket);
		quatRotate(turn, 0, shape.middle, held);
		const middle: Vector3 = [
			socket.at[0] + held[0] * socket.scale,
			socket.at[1] + held[1] * socket.scale,
			socket.at[2] + held[2] * socket.scale,
		];
		const radius = shape.reach * socket.scale;
		clumps.push({ id: b, centre: middle, radius: Math.max(1e-4, radius), depth: 3, birth: 0 });
	});
	// The trunk's own wood is part of the plant's box, and the ground its bottom.
	min[0] = Math.min(0, min[0], at[0]);
	min[1] = Math.min(0, min[1]);
	min[2] = Math.min(0, min[2], at[2]);
	max[0] = Math.max(0, max[0], at[0]);
	max[1] = Math.max(height, max[1]);
	max[2] = Math.max(0, max[2], at[2]);
	for (let c = 0; c < 3; c++) {
		if (!Number.isFinite(min[c] as number)) min[c] = 0;
		if (!Number.isFinite(max[c] as number)) max[c] = 0;
	}
	const crown = Number.isFinite(crownBase) ? crownBase : height;
	const top = Math.max(height, max[1]);
	// The croziers stand at the centre as the trunk's own wood; a low cap gives them up.
	if (input.croziersAllowed && rosette.croziers) {
		const croziers = rosette.croziers;
		const length = {
			mean: spreadMean(croziers.length) * height,
			spread: (typeof croziers.length === 'number' ? 0 : croziers.length.spread) * height,
		};
		const n = Math.max(0, Math.round(spreadAt(croziers.count, draw(DRAW.croziers))));
		for (let k = 0; k < n; k++)
			layCrozier(
				builder,
				{ ...croziers, length },
				trunkAxis,
				input.trunkTop,
				at,
				topRadius,
				k,
				n,
				draw,
			);
	}
	return {
		laid,
		sockets: kept.length,
		shed: laid - kept.length,
		origins,
		clumps,
		bounds: { min, max },
		height: top,
		crownBase: crown,
	};
}
