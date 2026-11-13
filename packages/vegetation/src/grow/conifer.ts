// The conifer grower: a plant built in a set order from the record's measured figures. The trunk
// comes first, a plumb stem whose width at each height is the record's. The limbs follow from a
// schedule: stated levels, a stated count shared over them, each level's limbs spread evenly round
// the trunk and each level turned on from the last. A limb is one smooth course through three
// directions, the way it leaves, the way it runs and the way it ends, and it stops where its foliage
// patch begins. The crown's reach at each height, the spread of limb lengths and the limbs'
// thickness are the record's too, so nothing here is grown and then cut back.
//
// `planConifer` gives the frame as plain data with each limb's patch beside it, which the foliage's
// sockets are set from; `growConifer` writes the same frame into a skeleton.
import { AXIS_LIMB, AXIS_STEM, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { acos, atan2, cos, PI, radians, sin, tan, type Vector3 } from '../core/math';
import type { Conifer, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';
import type { Grower } from './models';

/** The golden angle in degrees, which turns each limb level on from the last. */
const GOLDEN = 137.50776405;
/** The most degrees one piece of an axis turns from the piece before it. */
export const TURN_MOST = 5;
/** The longest piece of a limb in metres, and of the trunk. */
const LIMB_STEP = 0.45;
const TRUNK_STEP = 0.4;
/** The length of the fine steps a course is first walked in, in metres, and the most of them. */
const FINE_STEP = 0.02;
const FINE_MOST = 4096;
/** The share of the turn bound a piece may use before the next one starts. */
const TURN_SHARE = 0.55;
/**
 * The length of one full sway of an axis's sideways wander, as a share of the plant's height. A long
 * limb sways about once along its length, and a short arm takes a small part of one sway, so no
 * axis bends more sharply than another.
 */
const WANDER_WAVE = 0.4;
/** The most of its limb's reach that a patch takes, so the limb's inner part stays bare. */
const PATCH_MOST = 0.6;
/** How much lower each further top limb's patch stands, as a share of its own depth. */
const TOP_STEP = 0.45;
/** The share of its patch's width that a limb runs on under it, and that an arm reaches. */
const UNDER_PATCH = 0.7;
const ARM_REACH = 0.36;
/** The shares of a limb's run under its patch between which its arms leave. */
const ARMS_FROM = 0.12;
const ARMS_TO = 0.62;
/** An arm's radius at its end over its radius where it leaves. */
const ARM_TAPER = 0.5;
/** The limbs that stand one toward each side of the crown's plan. */
const GREAT_LIMBS = 4;
/** Years the oldest wood of a plant has stood, for the bark's age. */
const AGE_MOST = 12;

/** The choices a plant makes, each its own hash purpose. */
const Purpose = {
	Height: 1,
	Turn: 2,
	Jitter: 3,
	Stagger: 4,
	Place: 5,
	First: 6,
	Narrow: 11,
	ArmSide: 12,
	ArmWander: 13,
	Wander: 7,
	TrunkPhase: 8,
	TrunkTurn: 9,
	TopTurn: 10,
} as const;

/** One point of an axis of the frame. */
export interface ConiferNode {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The wood's radius in metres. */
	readonly radius: number;
}

/**
 * The foliage patch at a limb's end: a region whose sockets carry the limb's foliage.
 *
 * @category api/vegetation
 */
export interface ConiferPatch {
	/** A level plate on top of the limb's end, a dome round it, or a tile of a closed shell. */
	readonly kind: Conifer['patch']['kind'];
	/** The limb it belongs to, by its index in the plan. */
	readonly limb: number;
	/** The patch's middle in plant space, in metres. The limb ends under it. */
	readonly centre: Vector3;
	/** Metres from the trunk's line to the patch's near edge: the limb's wood is bare up to there. */
	readonly begins: number;
	/** The patch's width in metres, along its limb and across it. */
	readonly width: number;
	/** The patch's depth in metres, along plant +Y. */
	readonly depth: number;
	/** The level direction the limb runs in under the patch, a unit vector. */
	readonly along: Vector3;
}

/**
 * One arm of a limb: a branch that leaves the limb under its patch and runs out level in the patch.
 *
 * @category api/vegetation
 */
export interface ConiferArm {
	/** The limb node it leaves, by its index in the limb's nodes. */
	readonly node: number;
	/** Its nodes from the first past the limb to its end. */
	readonly nodes: readonly ConiferNode[];
}

/**
 * One limb of the frame.
 *
 * @category api/vegetation
 */
export interface ConiferLimb {
	/** Its level, counted from the lowest; the top limbs take the number after the last level. */
	readonly level: number;
	/** Its place among its level's limbs. */
	readonly slot: number;
	/** Whether it is one of the limbs that carry on where the trunk divides. */
	readonly top: boolean;
	/** Degrees round the trunk where it leaves, from +X toward +Z. */
	readonly azimuth: number;
	/** Its place among the plant's limbs from the shortest (0) to the longest (1). */
	readonly place: number;
	/** Metres from the trunk's line to the far edge of its patch. */
	readonly reach: number;
	/** The trunk node it leaves. */
	readonly trunkNode: number;
	/** Its nodes from the first past the trunk to its end, under its patch. */
	readonly nodes: readonly ConiferNode[];
	/** The arms it divides into under its patch, in the order they leave. */
	readonly arms: readonly ConiferArm[];
	/** Its foliage patch. */
	readonly patch: ConiferPatch;
}

/**
 * A conifer's frame: the trunk, the limbs and each limb's foliage patch.
 *
 * @category api/vegetation
 */
export interface ConiferPlan {
	/** The plant's height in metres: the top of its highest patch. */
	readonly height: number;
	/** The trunk's nodes from the ground up. */
	readonly trunk: readonly ConiferNode[];
	/** The limbs, level by level from the lowest, then the top limbs. */
	readonly limbs: readonly ConiferLimb[];
	/** The limbs at each level, lowest first, without the top limbs. */
	readonly perLevel: readonly number[];
	/** The height of the lowest patch's underside in metres. */
	readonly crownBase: number;
}

/** The record's conifer growth, or an error for another model. */
function growthOf(record: Species): Conifer {
	if (record.growth.model !== 'conifer')
		throw new Error(`@null3d/vegetation: ${record.id} does not grow by the conifer model`);
	return record.growth;
}

/** A number kept within a range. */
function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

/** A share eased in and out: 0 at 0, 1 at 1, level at both ends. */
function eased(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

/**
 * The limbs at each level: the count shared over the levels as evenly as whole numbers allow, the
 * odd limbs spread through the levels rather than gathered at one end.
 *
 * @param count The limbs on the trunk.
 * @param levels The levels.
 * @returns The limbs at each level, lowest first.
 */
export function limbsPerLevel(count: number, levels: number): number[] {
	if (levels <= 0) return [];
	const whole = Math.max(levels, Math.round(count));
	const out: number[] = [];
	for (let k = 0; k < levels; k++)
		out.push(Math.floor(((k + 1) * whole) / levels) - Math.floor((k * whole) / levels));
	return out;
}

/** What one limb's course is drawn from. */
interface Course {
	/** Where it leaves, on the trunk's line. */
	readonly from: Vector3;
	/** Radians round the trunk where it leaves. */
	readonly azimuth: number;
	/** Degrees above level: the way it leaves, runs and ends. */
	readonly leave: number;
	readonly run: number;
	readonly end: number;
	/** Metres from the trunk's line to where it stops. */
	readonly out: number;
	/** Metres over which it turns from the way it leaves to the way it runs. */
	readonly riseOver: number;
	/** The share of its length over which it turns to the way it ends. */
	readonly endOver: number;
	/** Degrees it strays sideways, the metres of one full sway, and where in a sway it starts. */
	readonly wander: number;
	readonly wave: number;
	readonly phase: number;
}

/** A limb's course as points, the first one piece past the trunk's line. */
interface Path {
	readonly points: Vector3[];
	/** Metres along the course to each point. */
	readonly along: number[];
	/** Metres of the whole course. */
	readonly length: number;
	/** The level direction of its last piece. */
	readonly heading: Vector3;
}

/** The unit direction of a course `s` metres along a length of `length`. */
function courseDirection(course: Course, s: number, length: number): Vector3 {
	const rise = Math.min(course.riseOver, length / 2);
	const tail = clamp(course.endOver, 0, 1) * Math.max(0, length - rise);
	let lift = course.run;
	if (s < rise) lift = course.leave + (course.run - course.leave) * eased(s / Math.max(rise, 1e-6));
	else if (s > length - tail)
		lift = course.run + (course.end - course.run) * eased((s - (length - tail)) / tail);
	// The sway is none where the axis leaves, so it leaves in its own direction.
	const sway = course.wander * (sin((2 * PI * s) / course.wave + course.phase) - sin(course.phase));
	const heading = course.azimuth + radians(sway);
	const up = radians(lift);
	return [cos(up) * cos(heading), sin(up), cos(up) * sin(heading)];
}

/** The degrees between two unit directions. */
function between(a: Readonly<Vector3>, b: Readonly<Vector3>): number {
	return (acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * 180) / PI;
}

/** Where a course of a stated length ends, walked in fine steps. */
function courseEnd(course: Course, length: number): Vector3 {
	const steps = clamp(Math.ceil(length / FINE_STEP), 16, FINE_MOST);
	const step = length / steps;
	let x = course.from[0];
	let y = course.from[1];
	let z = course.from[2];
	for (let k = 0; k < steps; k++) {
		const d = courseDirection(course, (k + 0.5) * step, length);
		x += d[0] * step;
		y += d[1] * step;
		z += d[2] * step;
	}
	return [x, y, z];
}

/**
 * A course as points: long enough that its end stands `out` metres from the trunk's line, in pieces
 * that end where the course has turned by a share of the bound or run a full step, so a bend takes
 * short pieces and a straight run long ones.
 */
function coursePath(course: Course): Path {
	// The length that carries the end out to its distance, found from the distance a trial reaches.
	let length = Math.max(0.05, course.out);
	for (let pass = 0; pass < 6; pass++) {
		const end = courseEnd(course, length);
		const reached = Math.sqrt(
			(end[0] - course.from[0]) * (end[0] - course.from[0]) +
				(end[2] - course.from[2]) * (end[2] - course.from[2]),
		);
		if (reached < 1e-6) break;
		length *= course.out / reached;
	}
	const steps = clamp(Math.ceil(length / FINE_STEP), 16, FINE_MOST);
	const step = length / steps;
	const points: Vector3[] = [];
	const along: number[] = [];
	let x = course.from[0];
	let y = course.from[1];
	let z = course.from[2];
	let from = 0;
	let held = courseDirection(course, 0.5 * step, length);
	let heading: Vector3 = [cos(course.azimuth), 0, sin(course.azimuth)];
	for (let k = 0; k < steps; k++) {
		const d = courseDirection(course, (k + 0.5) * step, length);
		x += d[0] * step;
		y += d[1] * step;
		z += d[2] * step;
		const s = (k + 1) * step;
		const next = k + 1 < steps ? courseDirection(course, (k + 1.5) * step, length) : d;
		if (k === steps - 1 || s - from >= LIMB_STEP || between(held, next) >= TURN_MOST * TURN_SHARE) {
			points.push([x, y, z]);
			along.push(s);
			from = s;
			held = next;
		}
		const flat = Math.sqrt(d[0] * d[0] + d[2] * d[2]);
		if (flat > 1e-6) heading = [d[0] / flat, 0, d[2] / flat];
	}
	return { points, along, length, heading };
}

/**
 * A top limb's course: the way it runs is found so that its end stands at a stated height. A
 * steeper run ends higher, so the search halves the range that holds the height.
 */
function courseTo(course: Course, height: number): Path {
	let low = -60;
	let high = 85;
	let path = coursePath(course);
	for (let pass = 0; pass < 24; pass++) {
		const run = (low + high) / 2;
		path = coursePath({ ...course, run });
		const end = path.points[path.points.length - 1] as Vector3;
		if (Math.abs(end[1] - height) < 1e-3) break;
		if (end[1] < height) low = run;
		else high = run;
	}
	return path;
}

/**
 * Plans one conifer: its trunk, its limbs and each limb's foliage patch.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The frame.
 * @category api/vegetation
 */
export function planConifer(input: GrowInput): ConiferPlan {
	const { record, variant } = input;
	const seed = input.seed >>> 0;
	const salt = record.seedSalt >>> 0;
	const g = growthOf(record);
	const draw = (purpose: number, a = 0, b = 0): number =>
		unitAt(seed, salt, variant, purpose, a * 4096 + b);
	const height = spreadAt(record.size.height, draw(Purpose.Height));
	const radiusAt = (y: number): number => (curveAt(g.trunk.width, y / height) * height) / 2;
	const levels = g.limbs.levels;
	const perLevel = limbsPerLevel(g.limbs.count, levels.length);
	const dividesAt = clamp(g.trunk.dividesAt, 0.05, 1);
	const trunkTop = dividesAt * height;

	// The limbs' places round the trunk and up it. Each level stands its limbs evenly and turns on
	// from the level below by the golden angle, so no limb stands over another.
	interface Seat {
		readonly level: number;
		readonly slot: number;
		readonly y: number;
		readonly azimuth: number;
	}
	const turn = draw(Purpose.Turn) * 360;
	const seats: Seat[] = [];
	levels.forEach((level, k) => {
		const count = perLevel[k] as number;
		for (let slot = 0; slot < count; slot++) {
			const y = clamp(
				(level + (draw(Purpose.Stagger, k, slot) * 2 - 1) * g.limbs.stagger) * height,
				0.02 * height,
				trunkTop,
			);
			const azimuth =
				turn +
				k * GOLDEN +
				(slot * 360) / count +
				(draw(Purpose.Jitter, k, slot) * 2 - 1) * g.limbs.jitter;
			seats.push({ level: k, slot, y, azimuth });
		}
	});

	/** The crown's reach in metres at a height, toward an azimuth in degrees. */
	const reachAt = (y: number, azimuth: number): number => {
		const narrow = clamp(g.limbs.plan.narrow, 0.5, 1);
		const off = radians(azimuth - g.limbs.plan.turn);
		const plan = 1 - ((1 - narrow) / 2) * (1 - cos(2 * off));
		return curveAt(g.limbs.reach, y / height) * height * plan;
	};

	// Each limb's place in the length order, longest first. The two longest are the pair of seats on
	// different levels that stand most nearly opposite, where the crown reaches far; the whole plant
	// turns so that the pair lies along the plan's wide side. The next two take the free seats
	// nearest the plan's narrow sides. Each further limb takes the free seat that best balances the
	// limbs already placed, so long and short limbs stand on every side of the trunk.
	const places = seats.map((_, i) => (seats.length > 1 ? i / (seats.length - 1) : 1));
	const placeOf = new Array<number>(seats.length).fill(-1);
	let reachMost = 0;
	for (const seat of seats)
		reachMost = Math.max(reachMost, curveAt(g.limbs.reach, seat.y / height));
	/** The share of the crown's greatest reach that a seat's level lacks. */
	const lacks = (seat: Seat): number =>
		1 - curveAt(g.limbs.reach, seat.y / height) / Math.max(reachMost, 1e-6);
	/** Degrees between two directions, from 0 to 180. */
	const apart = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
	let pair: readonly [number, number] | undefined;
	let pairScore = Number.POSITIVE_INFINITY;
	for (let a = 0; a < seats.length; a++)
		for (let b = a + 1; b < seats.length; b++) {
			const first = seats[a] as Seat;
			const second = seats[b] as Seat;
			if (first.level === second.level) continue;
			const score =
				180 - apart(first.azimuth, second.azimuth) + 180 * (lacks(first) + lacks(second));
			if (score < pairScore - 1e-9) {
				pairScore = score;
				pair = [a, b];
			}
		}
	const flip = draw(Purpose.First) < 0.5;
	const longest = pair ? (flip ? pair[1] : pair[0]) : 0;
	const second = pair ? (flip ? pair[0] : pair[1]) : -1;
	// The pair stands a few degrees short of opposite: the turn shares that shortfall between the
	// two, so both lie as near the wide side as each other.
	const short =
		second >= 0
			? (((((seats[second] as Seat).azimuth - (seats[longest] as Seat).azimuth - 180) % 360) +
					540) %
					360) -
				180
			: 0;
	const swing = g.limbs.plan.turn - short / 2 - (seats[longest] as Seat).azimuth;
	for (let i = 0; i < seats.length; i++) {
		const seat = seats[i] as Seat;
		seats[i] = { ...seat, azimuth: seat.azimuth + swing };
	}
	let pullX = 0;
	let pullZ = 0;
	const seatLimb = (i: number, n: number): void => {
		const seat = seats[i] as Seat;
		const reach = curveAt(g.limbs.reachShare, places[n] as number) * reachAt(seat.y, seat.azimuth);
		pullX += cos(radians(seat.azimuth)) * reach;
		pullZ += sin(radians(seat.azimuth)) * reach;
		placeOf[i] = places[n] as number;
	};
	let n = seats.length - 1;
	seatLimb(longest, n--);
	if (second >= 0) seatLimb(second, n--);
	const narrowFirst = draw(Purpose.Narrow) < 0.5 ? 90 : 270;
	for (; n >= 0; n--) {
		const share = curveAt(g.limbs.reachShare, places[n] as number);
		const great = seats.length - 1 - n;
		const side =
			great < GREAT_LIMBS
				? g.limbs.plan.turn + (great === 2 ? narrowFirst : 360 - narrowFirst)
				: undefined;
		let best = -1;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let i = 0; i < seats.length; i++) {
			if ((placeOf[i] as number) >= 0) continue;
			const seat = seats[i] as Seat;
			let score: number;
			if (side === undefined) {
				const reach = share * reachAt(seat.y, seat.azimuth);
				const x = pullX + cos(radians(seat.azimuth)) * reach;
				const z = pullZ + sin(radians(seat.azimuth)) * reach;
				score = x * x + z * z;
			} else score = apart(seat.azimuth, side) + 180 * lacks(seat);
			if (score < bestScore - 1e-9) {
				bestScore = score;
				best = i;
			}
		}
		seatLimb(best, n);
	}

	// The trunk: a node at every limb's height and at even steps between, each offset a little by a
	// slow sway. Its last node is where it divides, or its tip.
	const heights = new Set<number>();
	for (let y = 0; y < trunkTop; y += TRUNK_STEP) heights.add(Math.round(y * 1000) / 1000);
	for (const seat of seats) heights.add(Math.round(seat.y * 1000) / 1000);
	heights.add(Math.round(trunkTop * 1000) / 1000);
	const sorted = [...heights].sort((a, b) => a - b);
	const trunkHeights: number[] = [];
	for (const y of sorted) {
		const last = trunkHeights[trunkHeights.length - 1];
		// Two nodes within a few centimetres would draw a ring thinner than the bark's own figure.
		if (last !== undefined && y - last < 0.04 && !seats.some((seat) => Math.abs(seat.y - y) < 1e-3))
			continue;
		trunkHeights.push(y);
	}
	const sway = (tan(radians(clamp(g.trunk.wander, 0, 20))) * height) / (2 * PI);
	const swayTurn = draw(Purpose.TrunkTurn) * 2 * PI;
	const swayPhase = draw(Purpose.TrunkPhase) * 2 * PI;
	const lineAt = (y: number): [number, number] => {
		const off = sway * (sin((2 * PI * y) / height + swayPhase) - sin(swayPhase));
		return [cos(swayTurn) * off, sin(swayTurn) * off];
	};
	const trunk: ConiferNode[] = trunkHeights.map((y) => {
		const [x, z] = lineAt(y);
		return { x, y, z, radius: Math.max(1e-4, radiusAt(y)) };
	});
	const trunkNodeAt = (y: number): number => {
		let best = 0;
		for (let i = 1; i < trunkHeights.length; i++)
			if (Math.abs((trunkHeights[i] as number) - y) < Math.abs((trunkHeights[best] as number) - y))
				best = i;
		return best;
	};

	const limbs: ConiferLimb[] = [];
	/** Adds one limb from its seat, its place in the length order and its course. */
	const addLimb = (
		level: number,
		slot: number,
		top: boolean,
		y: number,
		azimuth: number,
		place: number,
		share: number,
		baseRatio: number,
		lifts: { leave: number; run: number; end: number },
		lower?: number,
	): void => {
		const node = trunkNodeAt(y);
		const start = trunk[node] as ConiferNode;
		const reach = Math.max(start.radius * 2, share * reachAt(y, azimuth));
		const wide = (g.patch.width[0] + (g.patch.width[1] - g.patch.width[0]) * place) * height;
		const width = Math.min(wide, PATCH_MOST * reach);
		const depth = width * g.patch.depth;
		// The limb's wood runs on under its patch, past the patch's middle.
		const out = reach - width * (1 - UNDER_PATCH);
		const course: Course = {
			from: [start.x, start.y, start.z],
			azimuth: radians(azimuth),
			leave: lifts.leave,
			run: lifts.run,
			end: lifts.end,
			out,
			riseOver: g.limbs.riseOver * height,
			endOver: g.limbs.endOver,
			wander: g.limbs.wander,
			wave: WANDER_WAVE * height,
			phase: draw(Purpose.Wander, level, slot) * 2 * PI,
		};
		// A top limb ends where its patch's top stands at the plant's height, less its own step down.
		const path =
			lower === undefined
				? coursePath(course)
				: courseTo(course, height - depth * (1 + TOP_STEP * lower));
		// The radius beside the trunk is the record's ratio of the trunk's; the swelling fades over
		// the collar's distance, and the limb then thins evenly to where its patch begins.
		const beside = Math.max(1e-4, baseRatio * start.radius);
		const swell = Math.max(1, g.limbs.collar.swell);
		const collar = Math.max(1e-6, g.limbs.collar.over * height);
		const past = beside / swell;
		const nodes: ConiferNode[] = path.points.map((point, k) => {
			const s = path.along[k] as number;
			const fade = 1 + (swell - 1) * (1 - eased(s / collar));
			const thin = 1 - (1 - clamp(g.limbs.taper, 0.05, 1)) * (s / path.length);
			return { x: point[0], y: point[1], z: point[2], radius: Math.max(1e-4, past * fade * thin) };
		});
		const end = path.points[path.points.length - 1] as Vector3;
		// The arms leave to one side and the other in turn, level, each from its own node, so the
		// wood spreads under the whole patch and no two arms part from one point.
		const arms: ConiferArm[] = [];
		const count = Math.max(0, Math.round(g.limbs.arms.count));
		const under = width * UNDER_PATCH;
		const firstSide = draw(Purpose.ArmSide, level, slot) < 0.5 ? 1 : -1;
		for (let k = 0; k < count; k++) {
			const share = ARMS_FROM + ((ARMS_TO - ARMS_FROM) * (k + 0.5)) / count;
			const want = path.length - under * (1 - share);
			// The nearest node that no arm has taken and that is not the limb's own end.
			let at = -1;
			for (let i = 0; i < path.along.length - 1; i++) {
				if (arms.some((arm) => arm.node === i)) continue;
				if (
					at < 0 ||
					Math.abs((path.along[i] as number) - want) < Math.abs((path.along[at] as number) - want)
				)
					at = i;
			}
			if (at < 0) break;
			const here = path.points[at] as Vector3;
			const before = at > 0 ? (path.points[at - 1] as Vector3) : course.from;
			const flat = atan2(here[2] - before[2], here[0] - before[0]);
			const rise =
				(atan2(
					here[1] - before[1],
					Math.sqrt(
						(here[0] - before[0]) * (here[0] - before[0]) +
							(here[2] - before[2]) * (here[2] - before[2]),
					),
				) *
					180) /
				PI;
			const side = k % 2 === 0 ? firstSide : -firstSide;
			const armPath = coursePath({
				from: here,
				azimuth: flat + side * radians(g.limbs.arms.angle),
				leave: rise,
				run: rise,
				end: rise,
				out: width * ARM_REACH,
				riseOver: 0,
				endOver: 0,
				wander: g.limbs.wander,
				wave: WANDER_WAVE * height,
				phase: draw(Purpose.ArmWander, level, slot * 16 + k) * 2 * PI,
			});
			const foot = (nodes[at] as ConiferNode).radius * g.limbs.arms.radius;
			arms.push({
				node: at,
				nodes: armPath.points.map((point, i) => ({
					x: point[0],
					y: point[1],
					z: point[2],
					radius: Math.max(
						1e-4,
						foot * (1 - (1 - ARM_TAPER) * ((armPath.along[i] as number) / armPath.length)),
					),
				})),
			});
		}
		const index = limbs.length;
		limbs.push({
			level,
			slot,
			top,
			azimuth,
			place,
			reach,
			trunkNode: node,
			nodes,
			arms,
			patch: {
				kind: g.patch.kind,
				limb: index,
				centre: [
					end[0] - path.heading[0] * (under - width / 2),
					end[1] + depth / 2,
					end[2] - path.heading[2] * (under - width / 2),
				],
				begins: reach - width,
				width,
				depth,
				along: path.heading,
			},
		});
	};

	seats.forEach((seat, i) => {
		const place = placeOf[i] as number;
		const at = seat.y / height;
		addLimb(
			seat.level,
			seat.slot,
			false,
			seat.y,
			seat.azimuth,
			place,
			curveAt(g.limbs.reachShare, place),
			g.limbs.radius[0] + (g.limbs.radius[1] - g.limbs.radius[0]) * place,
			{
				leave: curveAt(g.limbs.leave, at),
				run: curveAt(g.limbs.run, at),
				end: curveAt(g.limbs.end, at),
			},
		);
	});

	// The top limbs carry on where the trunk divides, evenly round it. The first one's patch tops out
	// at the plant's height, and each further one stands a step lower and reaches a little less, so
	// the top is a stack of plates.
	let top = trunkTop;
	if (g.top && dividesAt < 1) {
		const count = Math.max(1, Math.round(g.top.limbs));
		// The first top limb lies near the plan's wide side, so the top is as wide as the record says
		// from the side the wide plan is seen from.
		const start = g.limbs.plan.turn + (draw(Purpose.TopTurn) * 2 - 1) * g.limbs.jitter;
		for (let slot = 0; slot < count; slot++)
			addLimb(
				levels.length,
				slot,
				true,
				trunkTop,
				start + (slot * 360) / count,
				1 - slot / (2 * count),
				1 - (0.2 * slot) / count,
				g.top.radius,
				{ leave: g.top.leave, run: g.top.leave / 2, end: g.top.end },
				slot,
			);
	}
	let crownBase = height;
	for (const limb of limbs) {
		top = Math.max(top, limb.patch.centre[1] + limb.patch.depth / 2);
		crownBase = Math.min(crownBase, limb.patch.centre[1] - limb.patch.depth / 2);
	}
	return { height: top, trunk, limbs, perLevel, crownBase: Math.max(0, crownBase) };
}

/**
 * Grows one conifer: the plan's trunk and limbs as a skeleton. The foliage patches stay in the plan.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growConifer(input: GrowInput): MacroSkeleton {
	const plan = planConifer(input);
	const builder = new SkeletonBuilder();
	const ageAt = (y: number): number =>
		Math.round(clamp((plan.height - y) / Math.max(1, plan.height), 0, 1) * AGE_MOST);
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const trunkNodes: number[] = [];
	let previous = -1;
	for (const node of plan.trunk) {
		previous = builder.addNode({
			x: node.x,
			y: node.y,
			z: node.z,
			radius: node.radius,
			parent: previous,
			axis: stem,
			light: 1,
			age: ageAt(node.y),
		});
		trunkNodes.push(previous);
	}
	for (const limb of plan.limbs) {
		const parentNode = trunkNodes[limb.trunkNode] as number;
		const from = plan.trunk[limb.trunkNode] as ConiferNode;
		const axis = builder.addAxis({
			parent: stem,
			parentNode,
			order: 1,
			kind: AXIS_LIMB,
			barkV: from.y,
			barkU: radians(limb.azimuth),
		});
		let last = parentNode;
		const limbNodes: number[] = [];
		let run = 0;
		let before: ConiferNode = from;
		const runs: number[] = [];
		for (const node of limb.nodes) {
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius,
				parent: last,
				axis,
				light: 1,
				age: ageAt(node.y),
			});
			limbNodes.push(last);
			run += Math.sqrt(
				(node.x - before.x) * (node.x - before.x) +
					(node.y - before.y) * (node.y - before.y) +
					(node.z - before.z) * (node.z - before.z),
			);
			runs.push(run);
			before = node;
		}
		limb.arms.forEach((arm, k) => {
			const armAxis = builder.addAxis({
				parent: axis,
				parentNode: limbNodes[arm.node] as number,
				order: 2,
				kind: AXIS_LIMB,
				barkV: runs[arm.node] as number,
				barkU: k % 2 === 0 ? 0 : PI,
			});
			let armLast = limbNodes[arm.node] as number;
			for (const node of arm.nodes)
				armLast = builder.addNode({
					x: node.x,
					y: node.y,
					z: node.z,
					radius: node.radius,
					parent: armLast,
					axis: armAxis,
					light: 1,
					age: ageAt(node.y),
				});
		});
	}
	return builder.finish(plan.crownBase);
}

/** The conifer grower. */
export const grower: Grower = {
	grow: growConifer,
};
