// The directed frame: a plant's wood laid in a stated order from measured figures. A species states
// its stems and, under each, the axes that leave it: how many, where along the parent, how they
// stand round it, the angle they leave at, the way they bend, how long they run and how thick they
// are beside the wood they leave. Nothing is grown and cut back. Every axis is a row of arches
// joined where their tangents match, so a limb bends gently and never runs dead straight, and each
// axis thins evenly from the measured share of its parent's radius.
//
// `planFrame` gives the frame as plain data with the foliage patches beside it; `frameSockets` gives
// the wood ends that carry foliage, ranked once across the plant; `frameSkeleton` writes the frame
// into a skeleton, and `growFrame` writes it with its sockets as bud sites, for a record that
// states its frame as its growth.
import { archPath } from '../core/arch';
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	acos,
	asin,
	atan2,
	cos,
	PI,
	quatFromFrame,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import { thinningRanks } from '../core/rank';
import type { Framed, Species } from '../core/record';
import { type Curve, curveAt, spreadAt, spreadMean } from '../core/types';
import type { GrowInput } from '../stages';
import type { Grower } from './models';

/** The golden angle in degrees, which turns each axis of a spiral on from the last. */
const GOLDEN = 137.50776405;
/**
 * The most degrees one piece of an axis turns from the piece before it.
 *
 * @category api/vegetation
 */
export const FRAME_TURN_MOST = 6;
/** The longest piece of an axis as a share of its length, and its bounds in metres. */
const STEP_SHARE = 1 / 12;
const STEP_LEAST = 0.012;
const STEP_MOST = 0.45;
/** The degrees under which a stretch counts as straight, and how much longer its pieces may be. */
const STRAIGHT_TURN = 0.5;
const STRAIGHT_STEP = 3;
/** Steps a trial course is summed over while its length is found, and the passes that find it. */
const TRIAL_STEPS = 32;
const LENGTH_PASSES = 22;
/**
 * The steps a course is walked in to find where it first runs under the crown's lower boundary, and
 * the halvings that place the crossing inside a step.
 */
const UNDER_STEPS = 16;
const UNDER_PASSES = 10;
/**
 * How far a crooked axis may stray from its own line, sideways and up or down, as shares of its
 * rule's sway: wide enough that its mean line wanders, and bounded so it keeps its course.
 */
const WANDER_SIDE = 0.8;
const WANDER_NOD = 0.5;
/**
 * Axes that keep apart: the share of an axis's length past which its wood is held clear of other
 * wood (nearer its base it stands beside the wood it leaves), how many times an axis may be shaped,
 * and the step between one shaping's hash keys and the next's.
 */
const OUTER_FROM = 0.2;
const APART_TRIES = 8;
const SHAPE_STEP = 16384;
/** The rise of a unit direction above which a parent stands near plumb and has no ground side. */
const PLUMB_NEAR = 0.9;
/** The least radius a bend may have, in diameters of the wood where it bends. */
const BEND_DIAMETERS = 3.4;
/** The thinnest wood of a frame, in metres. */
const RADIUS_LEAST = 0.0008;
/** The most of its parent's radius an axis may take where it leaves. */
const BASE_MOST = 0.95;
/** Years the oldest wood of a plant has stood, for the bark's age. */
const AGE_MOST = 12;

/** The choices a plant makes, each its own hash purpose. */
const Purpose = {
	Height: 1,
	Heading: 2,
	Round: 3,
	Jitter: 4,
	Stagger: 5,
	Side: 6,
	SwaySide: 7,
	Sway: 8,
	Vary: 9,
	Angle: 10,
	Lean: 11,
	Spot: 12,
	Nod: 13,
} as const;

/**
 * What an axis of a frame is.
 *
 * @category api/vegetation
 */
export type FrameRole = 'stem' | 'limb' | 'branch' | 'whip' | 'shoot';

/**
 * One bend of an axis: over a stretch of its length it turns in its own upright plane.
 *
 * @category api/vegetation
 */
export interface FrameBend {
	/** The shares of the axis's length where the turn starts and ends. */
	readonly from: number;
	readonly to: number;
	/**
	 * Degrees it turns toward the ground over the stretch, by the axis's place among its siblings. A
	 * negative figure turns it up.
	 */
	readonly by?: Curve;
	/**
	 * Degrees above level it points at the stretch's end, by the axis's place among its siblings.
	 * Stated, it stands in place of `by`.
	 */
	readonly level?: Curve;
}

/**
 * How long an axis runs. Each curve is read at the axis's place among its siblings, from the first
 * (0) to the last (1).
 *
 * @category api/vegetation
 */
export type FrameLength =
	/** A share of the plant's height. */
	| { readonly share: Curve }
	/** A share of its parent's length. */
	| { readonly parent: Curve }
	/**
	 * Its tip stands on the crown outline drawn in to this share toward the crown's middle, which is
	 * the trunk's line at the height of the outline's widest row.
	 */
	| { readonly outline: Curve }
	/** Its tip stands at this share of the plant's height. */
	| { readonly height: Curve };

/**
 * The foliage patch an axis carries: the region its sockets fill.
 *
 * @category api/vegetation
 */
export interface FramePatchRule {
	/** What the patch holds: hanging strands, a clump, a level tier, a leafy shoot. */
	readonly kind: string;
	/** Its width and depth as shares of the plant's height, by the axis's place. */
	readonly width: Curve;
	readonly depth: Curve;
	/**
	 * Where it stands against the axis's end, in depths: -0.5 hangs under the end, 0 is centred on it
	 * and 0.5 sits on top of it. Left out, 0.
	 */
	readonly offset?: number;
	/**
	 * The share of the axis's length where the patch begins when it clothes the axis itself, as a
	 * hanging whip's or a leafy shoot's does. Left out, the patch stands at the axis's end.
	 */
	readonly along?: number;
}

/** What every axis rule states. */
interface FrameAxisRule {
	/** The rule's name, which each axis it makes carries. */
	readonly name: string;
	/** The bends of its course, in order along it. */
	readonly bends?: readonly FrameBend[];
	/** Degrees the course turns at each elbow, to one side and the other in turn. */
	readonly sway: number;
	/** The elbows of the course. */
	readonly elbows: number;
	/**
	 * How crooked the course is, from 0 to 0.9: the share of the stretch between two elbows that runs
	 * straight. At 0 the course is an even wave that turns all the way along. Above 0 the elbows
	 * stand at uneven steps, each a short rounded turn that also nods up or down, and an elbow
	 * stands where a child axis leaves. Left out, 0.
	 */
	readonly crook?: number;
	/**
	 * The share of each child's cross-section that the axis loses where the child leaves, from 0 to
	 * 1: at 1 the wood past a fork is as thick as the fork leaves it, and at 0 the axis thins
	 * evenly whatever leaves it. A stem's width is stated, so it loses nothing. Left out, 0.
	 */
	readonly shed?: number;
	/**
	 * The share an axis's length may differ by, either way, and the shortest and the longest it may
	 * run as shares of the height, by its place.
	 */
	readonly vary?: number;
	readonly least?: Curve;
	readonly most?: Curve;
	/** The foliage patch each axis carries. */
	readonly patch?: FramePatchRule;
	/** The axes that leave each axis. */
	readonly children?: readonly FrameBranchRule[];
}

/**
 * The stems of a plant: one trunk, or several from one base.
 *
 * @category api/vegetation
 */
export interface FrameStemRule extends FrameAxisRule {
	/** Stems, and how many of them stand at the base's middle. */
	readonly count: number;
	readonly inner?: number;
	/** Degrees round the plant where the first stem stands. */
	readonly first?: number;
	/** Each stem's distance from the base's middle as a share of the height, by its place. */
	readonly ring?: Curve;
	/** Degrees each stem leans from plumb, away from the middle, by its place. */
	readonly lean?: Curve;
	/** The stem's width as a share of the height, by the distance along it as a share of the height. */
	readonly width: Curve;
	/** How long each stem runs. */
	readonly length: FrameLength;
}

/**
 * The axes that leave a parent axis.
 *
 * @category api/vegetation
 */
export interface FrameBranchRule extends FrameAxisRule {
	readonly role: Exclude<FrameRole, 'stem'>;
	/**
	 * How many leave each parent; or one for each stated share of the height along the stretch of the
	 * parent they leave from, within a least and a most; or a total that the rule's parents share as
	 * evenly as whole numbers allow.
	 */
	readonly count:
		| number
		| { readonly every: number; readonly least: number; readonly most: number }
		| { readonly total: number };
	/** The shares of the parent's length between which they leave, the first and the last on them. */
	readonly along: readonly [number, number];
	/** How far each may stand off its even place along the parent, as a share of the step between. */
	readonly stagger?: number;
	/**
	 * How they stand round the parent: each turned on from the last by the golden angle, evenly round
	 * it, in opposite pairs each crossed on the last, to one side and the other in turn, or each at
	 * its own stated degrees, which states every axis by itself.
	 */
	readonly around: 'spiral' | 'ring' | 'opposite' | 'sides' | readonly number[];
	/** Degrees round the parent where the first one stands. Left out, each parent draws its own. */
	readonly first?: number;
	/**
	 * Degrees the two sides are raised toward the parent's sky side when they stand to one side and
	 * the other: 0 leaves them level with the parent, 90 puts every one on its sky side, and a
	 * negative figure lowers them toward its ground side.
	 */
	readonly lift?: number;
	/**
	 * The least gap, as a share of the height, between the wood of one of these axes past its first
	 * fifth and the wood of every axis built before it, the axis it leaves apart. An axis that
	 * would run nearer is shaped again with other elbows, a few times, and the shape that stands
	 * clearest is kept, so no limb runs along another or passes through it. Left out, the axes are
	 * laid without regard to each other.
	 */
	readonly apart?: number;
	/**
	 * Degrees of the parent's ground side that no axis leaves toward, when they stand round it on a
	 * spiral or a ring: their places are drawn in round its sky side, so a level limb carries nothing
	 * straight beneath it. A parent that stands near plumb has no ground side and is clothed all
	 * round. Left out, 0.
	 */
	readonly clear?: number;
	/** Degrees each may stand off its place round the parent. */
	readonly jitter?: number;
	/** Degrees each leaves at, by its place, measured from plumb or from the parent's own direction. */
	readonly angle: Curve;
	readonly from: 'plumb' | 'parent';
	/** Degrees the leaving angle may differ, either way. */
	readonly angleSpread?: number;
	/** How long each runs. */
	readonly length: FrameLength;
	/** Its radius where it leaves as a share of the parent's radius there, by its place. */
	readonly radius: Curve;
	/** Its radius at its tip as a share of its radius where it leaves. */
	readonly taper: number;
}

/**
 * One side of a crown's outline: what a whole view of the plant shows to one side of the trunk's
 * line. A view gives two sides, and each is stated by itself.
 *
 * @category api/vegetation
 */
export interface FrameSide {
	/** The direction round the plant that the side faces, in degrees from 0 to 360. */
	readonly toward: number;
	/** The crown's reach to this side as a share of the height, by the share of the height. */
	readonly reach: Curve;
	/**
	 * The crown's lower boundary on this side, as the view that looks across the side shows it: the
	 * height that no foliage stands under, by the distance from the trunk's line in that view, both
	 * as shares of the height.
	 */
	readonly under: Curve;
}

/**
 * A plant's directed frame as a species states it.
 *
 * @category api/vegetation
 */
export interface FrameSpec {
	/**
	 * The crown's outline: its sides in their order round the plant, two or more. Between two sides
	 * the plan runs as a quarter of an ellipse runs between its half-axes.
	 */
	readonly outline: readonly FrameSide[];
	/** The stems. */
	readonly stems: FrameStemRule;
}

/** One point of an axis of the frame. */
export interface FrameNode {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The wood's radius in metres. */
	readonly radius: number;
}

/**
 * One axis of the frame.
 *
 * @category api/vegetation
 */
export interface FrameAxis {
	/** The rule that made it. */
	readonly rule: string;
	readonly role: FrameRole;
	/** Its order: 0 for a stem, one more for each parent between it and a stem. */
	readonly order: number;
	/** The axis it leaves, or -1 for a stem, and the node of that axis where it leaves. */
	readonly parent: number;
	readonly parentNode: number;
	/** Its number among the axes its rule made on its parent, and its place from 0 to 1 among them. */
	readonly index: number;
	readonly place: number;
	/** Degrees round the plant that it leaves toward, from +X toward +Z. */
	readonly azimuth: number;
	/** Metres along its course. */
	readonly length: number;
	/** Its radius where it leaves, in metres: a stem's at the ground. */
	readonly base: number;
	/** Its nodes: a stem's from the ground, any other's from the first past its parent's line. */
	readonly nodes: readonly FrameNode[];
	/** The share of its length at each node. */
	readonly along: readonly number[];
}

/**
 * A foliage patch of the frame: a region whose sockets carry an axis's foliage.
 *
 * @category api/vegetation
 */
export interface FramePatch {
	/** What the patch holds. */
	readonly kind: string;
	/** The axis it belongs to, by its index in the plan. */
	readonly axis: number;
	/** The patch's middle in plant space, in metres. */
	readonly centre: Vector3;
	/** Metres from the plant's centre line to the patch's near edge. */
	readonly begins: number;
	/** The patch's width in metres, along its axis and across it. */
	readonly width: number;
	/** The patch's depth in metres, along plant +Y. */
	readonly depth: number;
	/** The level direction the axis runs in at the patch, a unit vector. */
	readonly along: Vector3;
}

/**
 * A plant's frame: its axes and their foliage patches.
 *
 * @category api/vegetation
 */
export interface FramePlan {
	/** The plant's height in metres: the top of its highest node or patch. */
	readonly height: number;
	/** The height the species' shares were multiplied by, in metres. */
	readonly scale: number;
	/** The axes, every parent before its children. */
	readonly axes: readonly FrameAxis[];
	/** The foliage patches. */
	readonly patches: readonly FramePatch[];
	/** The height of the lowest patch's underside in metres. */
	readonly crownBase: number;
}

/** A number kept within a range. */
function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

/** The unit direction that stands `lift` radians above level and heads `heading` radians round. */
function direction(lift: number, heading: number): Vector3 {
	return [cos(lift) * cos(heading), sin(lift), cos(lift) * sin(heading)];
}

/** A vector scaled to unit length, or +Y for none. */
function unit(x: number, y: number, z: number): Vector3 {
	const length = Math.sqrt(x * x + y * y + z * z);
	return length > 1e-12 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/** The degrees between two unit directions. */
function between(a: Readonly<Vector3>, b: Readonly<Vector3>): number {
	return (acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * 180) / PI;
}

/**
 * Where a lean stands after a turn, held inside a bound either way: the turn goes the way it was
 * drawn where that keeps the lean inside, the other way where only that does, and to the bound's
 * farther edge where neither does.
 */
function strayed(lean: number, turn: number, bound: number): number {
	if (Math.abs(lean + turn) <= bound) return lean + turn;
	if (Math.abs(lean - turn) <= bound) return lean - turn;
	return lean >= 0 ? -bound : bound;
}

/** A course cut into points. */
interface Laid {
	/** The points after the start. */
	readonly points: Vector3[];
	/** The share of the length at each point. */
	readonly along: number[];
	/** The point that stands at each asked share. */
	readonly at: number[];
}

/**
 * Lays a course from its tangent at every share of its length. The course is cut at the stated
 * shares, and each stretch between two cuts is one arch from the tangent at its start to the
 * tangent at its end, so neighbouring arches join where their tangents match. An arch is cut so no
 * piece turns more than the bound and none runs longer than a step.
 */
function lay(
	from: Readonly<Vector3>,
	tangent: (share: number) => Vector3,
	length: number,
	knots: readonly number[],
	asked: readonly number[],
): Laid {
	const step = clamp(length * STEP_SHARE, STEP_LEAST, STEP_MOST);
	// Two cuts closer than a quarter of a step are one cut.
	const near = Math.min(0.5, (step * 0.25) / Math.max(length, 1e-6));
	const cuts: number[] = [];
	for (const share of [...knots, ...asked, 1].sort((a, b) => a - b)) {
		if (share < near || share > 1) continue;
		const last = cuts[cuts.length - 1];
		if (last !== undefined && share - last < near) continue;
		cuts.push(share);
	}
	if (cuts.length === 0 || (cuts[cuts.length - 1] as number) < 1 - 1e-9) {
		if (cuts.length > 0 && 1 - (cuts[cuts.length - 1] as number) < near) cuts[cuts.length - 1] = 1;
		else cuts.push(1);
	}
	const points: Vector3[] = [];
	const along: number[] = [];
	const cutPoint: number[] = [];
	let x = from[0];
	let y = from[1];
	let z = from[2];
	let before = 0;
	let t0 = tangent(0);
	for (const cut of cuts) {
		const t1 = tangent(cut);
		const run = (cut - before) * length;
		const turn = between(t0, t1);
		const dot = t0[0] * t1[0] + t0[1] * t1[1] + t0[2] * t1[2];
		const normal = unit(t1[0] - dot * t0[0], t1[1] - dot * t0[1], t1[2] - dot * t0[2]);
		// A stretch that holds its direction needs no more pieces than its taper does.
		const reach = turn < STRAIGHT_TURN ? step * STRAIGHT_STEP : step;
		const least = Math.max(1, Math.ceil(run / reach), Math.ceil(turn / FRAME_TURN_MOST));
		const path = archPath({ length: run, leave: 0, turn: turn < 1e-6 ? 0 : -turn }, 0, least);
		for (let i = 1; i <= path.segments; i++) {
			const out = path.out[i] as number;
			const up = path.up[i] as number;
			points.push([
				x + t0[0] * out + normal[0] * up,
				y + t0[1] * out + normal[1] * up,
				z + t0[2] * out + normal[2] * up,
			]);
			along.push(before + (cut - before) * (path.along[i] as number));
		}
		const end = points[points.length - 1] as Vector3;
		x = end[0];
		y = end[1];
		z = end[2];
		cutPoint.push(points.length - 1);
		before = cut;
		t0 = t1;
	}
	const at = asked.map((share) => {
		let best = 0;
		for (let i = 1; i < cuts.length; i++)
			if (Math.abs((cuts[i] as number) - share) < Math.abs((cuts[best] as number) - share))
				best = i;
		return cutPoint[best] as number;
	});
	return { points, along, at };
}

/** Where a course of a stated length ends, summed in even steps. */
function tipOf(
	from: Readonly<Vector3>,
	tangent: (share: number) => Vector3,
	length: number,
): Vector3 {
	let x = from[0];
	let y = from[1];
	let z = from[2];
	const step = length / TRIAL_STEPS;
	for (let k = 0; k < TRIAL_STEPS; k++) {
		const t = tangent((k + 0.5) / TRIAL_STEPS);
		x += t[0] * step;
		y += t[1] * step;
		z += t[2] * step;
	}
	return [x, y, z];
}

/** An axis while its plan is built. */
interface Built {
	rule: string;
	role: FrameRole;
	order: number;
	parent: number;
	parentNode: number;
	index: number;
	place: number;
	azimuth: number;
	length: number;
	base: number;
	nodes: FrameNode[];
	along: number[];
}

/**
 * An outline that is the same to both sides of each of its two axes: the stated reach along one
 * axis and a share of it along the other. It states a crown that one curve was read for, and no
 * lower boundary; a crown read side by side states its sides.
 *
 * @param reach The crown's reach along its wide axis as a share of the height, by the share of the
 * height.
 * @param narrow The reach along the other axis as a share of that.
 * @param turn The degrees round the plant that the wide axis lies at.
 * @returns The four sides.
 * @category api/vegetation
 */
export function evenOutline(reach: Curve, narrow: number, turn = 0): FrameSide[] {
	const share = clamp(narrow, 0.5, 1);
	const drawn: Curve =
		typeof reach === 'number' ? reach * share : reach.map(([at, width]) => [at, width * share]);
	return [0, 90, 180, 270].map((quarter) => ({
		toward: (((turn + quarter) % 360) + 360) % 360,
		reach: quarter % 180 === 0 ? reach : drawn,
		under: 0,
	}));
}

/** A side's reach at a share of the height; outside the heights the side states there is no crown. */
function reachAt(side: FrameSide, at: number): number {
	if (typeof side.reach !== 'number') {
		const first = side.reach[0];
		const last = side.reach[side.reach.length - 1];
		if ((last && at > last[0]) || (first && at < first[0])) return 0;
	}
	return curveAt(side.reach, at);
}

/**
 * The two stated sides a direction stands between, and each one's weight there: all the first's on
 * the first side, all the second's on the second, as the squares of a quarter turn's cosine and
 * sine between them.
 */
function sidesAt(
	spec: FrameSpec,
	azimuth: number,
): {
	readonly from: FrameSide;
	readonly to: FrameSide;
	readonly first: number;
	readonly second: number;
} {
	const sides = spec.outline;
	const degrees = ((((azimuth * 180) / PI) % 360) + 360) % 360;
	for (let k = 0; k < sides.length; k++) {
		const from = sides[k] as FrameSide;
		const to = sides[(k + 1) % sides.length] as FrameSide;
		const span = (((to.toward - from.toward) % 360) + 360) % 360 || 360;
		const off = (((degrees - from.toward) % 360) + 360) % 360;
		if (off > span) continue;
		const quarter = ((off / span) * PI) / 2;
		const c = cos(quarter);
		const s = sin(quarter);
		return { from, to, first: c * c, second: s * s };
	}
	const only = sides[0] as FrameSide;
	return { from: only, to: only, first: 1, second: 0 };
}

/** A weight under which a side has no say in a direction. */
const SIDE_LEAST = 1e-9;

/**
 * The crown outline's radius in metres at a height and a direction round the plant. On a stated
 * side it is that side's reach; between two it is the radius of the quarter ellipse whose half-axes
 * are the two reaches, so a view from either side shows the reach that side states.
 *
 * @param spec The frame.
 * @param scale The plant's height in metres.
 * @param y The height in metres.
 * @param azimuth Radians round the plant.
 * @returns The radius in metres.
 * @category api/vegetation
 */
export function outlineRadius(spec: FrameSpec, scale: number, y: number, azimuth: number): number {
	const { from, to, first, second } = sidesAt(spec, azimuth);
	const a = first > SIDE_LEAST ? reachAt(from, y / scale) : 1;
	const b = second > SIDE_LEAST ? reachAt(to, y / scale) : 1;
	// A side with no crown at the height draws the outline in to the trunk's line.
	if (a <= 0 || b <= 0) return 0;
	return scale / Math.sqrt(first / (a * a) + second / (b * b));
}

/**
 * The height that no foliage may stand under at a place beside the plant, in metres. Each stated
 * side's lower boundary is read as the view across that side shows it, by the place's distance from
 * the trunk's line in that view, and the place answers to every side it stands on: the highest of
 * their boundaries there.
 *
 * @param spec The frame.
 * @param scale The plant's height in metres.
 * @param x The place's x in metres.
 * @param z The place's z in metres.
 * @returns The height in metres.
 * @category api/vegetation
 */
export function outlineUnder(spec: FrameSpec, scale: number, x: number, z: number): number {
	let highest = 0;
	for (const side of spec.outline) {
		const toward = radians(side.toward);
		const reach = x * cos(toward) + z * sin(toward);
		if (reach >= 0) highest = Math.max(highest, curveAt(side.under, reach / scale));
	}
	return highest * scale;
}

/**
 * The heights an outline's crown stands between, as shares of the plant's height: the lowest
 * height any side states a reach at, and the highest.
 *
 * @param spec The frame.
 * @returns The crown's foot and its top.
 * @category api/vegetation
 */
export function outlineSpan(spec: FrameSpec): { readonly foot: number; readonly top: number } {
	let foot = Number.POSITIVE_INFINITY;
	let top = Number.NEGATIVE_INFINITY;
	for (const side of spec.outline) {
		const stated = typeof side.reach !== 'number' && side.reach.length > 0;
		foot = Math.min(foot, stated ? (side.reach[0] as readonly [number, number])[0] : 0);
		top = Math.max(
			top,
			stated ? (side.reach[side.reach.length - 1] as readonly [number, number])[0] : 1,
		);
	}
	return { foot, top };
}

/**
 * Plans one plant's frame: its stems, every axis that leaves them and each axis's foliage patch.
 *
 * @param spec The species' frame.
 * @param input The record, the seed, the variant and the season.
 * @returns The frame.
 * @category api/vegetation
 */
export function planFrame(spec: FrameSpec, input: GrowInput): FramePlan {
	const { record, variant } = input;
	const seed = input.seed >>> 0;
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, a = 0, b = 0): number =>
		unitAt(seed, salt, variant, purpose, a * 4096 + b);
	const scale = spreadAt(record.size.height, draw(Purpose.Height));
	const axes: Built[] = [];
	const patches: FramePatch[] = [];
	/** Every point of the wood built so far, with its radius and its axis, for the axes that keep apart. */
	const wood: { readonly at: Vector3; readonly radius: number; readonly axis: number }[] = [];
	// The height of the crown's widest row, in metres: the middle the outline is drawn in toward.
	let middle = scale / 2;
	let widest = Number.NEGATIVE_INFINITY;
	for (const side of spec.outline) {
		if (typeof side.reach === 'number') continue;
		for (const [at, radius] of side.reach)
			if (radius > widest) {
				widest = radius;
				middle = at * scale;
			}
	}

	/** Builds one axis and every axis under it. */
	const build = (
		rule: FrameStemRule | FrameBranchRule,
		role: FrameRole,
		start: Readonly<Vector3>,
		leave: Readonly<Vector3>,
		parent: number,
		parentNode: number,
		index: number,
		among: number,
		place: number,
		baseRadius: number,
		parentLength: number,
	): void => {
		const id = axes.length;
		const order = parent < 0 ? 0 : (axes[parent] as Built).order + 1;
		const flat = Math.sqrt(leave[0] * leave[0] + leave[2] * leave[2]);
		const heading = flat > 1e-6 ? atan2(leave[2], leave[0]) : draw(Purpose.Heading, id) * 2 * PI;
		const lift0 = (asin(clamp(leave[1], -1, 1)) * 180) / PI;

		interface Seat {
			readonly rule: FrameBranchRule;
			readonly index: number;
			readonly count: number;
			readonly share: number;
		}
		/**
		 * Shapes the axis once: its bends and elbows, its length, where its children leave, and its
		 * points. Each attempt draws its own elbows, so an axis that runs too near another of its
		 * kind may be shaped again.
		 */
		const drawn = (attempt: number) => {
			const shape = id + attempt * SHAPE_STEP;
			// The wood's radius along the axis before any fork thins it, which bounds how tightly it may
			// bend: no bend's radius is under a stated count of the wood's diameters there.
			const thick = (share: number, over: number): number =>
				'width' in rule
					? (curveAt(rule.width, (share * over) / scale) * scale) / 2
					: baseRadius * (1 - (1 - clamp(rule.taper, 0.02, 1)) * share);
			/** The most degrees a stretch of an axis may turn at a share of an axis of a length. */
			const turnMost = (share: number, stretch: number, over: number): number =>
				((stretch * over) / (BEND_DIAMETERS * 2 * Math.max(RADIUS_LEAST, thick(share, over)))) *
				(180 / PI);

			// The elbows: at each the course's lean changes over a short stretch, and it holds its lean
			// between them. An even course leans to one side and the other in turn and spends the whole
			// stretch between two elbows turning. A crooked one stands its elbows at uneven steps; each
			// turns by its own size toward its own side and nods up or down, so the axis's mean line
			// wanders, and it turns back before it has strayed past the rule's sway.
			const elbows = Math.max(1, Math.round(rule.elbows));
			const crook = clamp(rule.crook ?? 0, 0, 0.9);
			const half = ((1 - crook) * 0.5) / elbows;
			const spots: number[] = [];
			for (let k = 0; k < elbows; k++)
				spots.push((k + 0.5 + (draw(Purpose.Spot, shape, k) * 2 - 1) * 0.45 * crook) / elbows);
			const firstSide = draw(Purpose.SwaySide, shape) < 0.5 ? 1 : -1;
			/** How far each elbow's turn is eased, from 1 for none, so that no bend is too tight. */
			const eases = new Array<number>(elbows + 1).fill(1);
			/** The stretch of the axis each elbow turns over, as its first and last shares. */
			let ramps: [number, number][] = [];
			/** The lift, the lean and the nod at every share, shaped for an axis of a length. */
			let lifts: [number, number][] = [];
			let sways: [number, number][] = [];
			let dips: [number, number][] = [];
			const bent = (over: number): void => {
				// The lift at each share, from the bends in order. A bend turns no more than its stretch
				// of this wood may.
				lifts = [[0, lift0]];
				let lift = lift0;
				for (const bend of rule.bends ?? []) {
					const from = clamp(bend.from, 0, 1);
					const to = clamp(bend.to, from, 1);
					if (from > (lifts[lifts.length - 1] as [number, number])[0]) lifts.push([from, lift]);
					const asked =
						bend.level !== undefined
							? curveAt(bend.level, place) - lift
							: -curveAt(bend.by ?? 0, place);
					const most = turnMost((from + to) / 2, to - from, over);
					lift = clamp(lift + clamp(asked, -most, most), -90, 90);
					lifts.push([Math.max(to, from + 1e-6), lift]);
				}
				sways = [[0, 0]];
				dips = [[0, 0]];
				ramps = [];
				if (crook === 0) {
					// An even wave reaches each lean at its elbow and ends half way to the lean that
					// would follow, so every stretch of it turns, the first and the last too.
					let side = firstSide;
					const leans: number[] = [];
					for (let k = 0; k <= elbows; k++) {
						leans.push(
							side *
								(rule.sway / 2) *
								(0.7 + 0.6 * draw(Purpose.Sway, shape, k)) *
								(eases[k] as number),
						);
						side = -side;
					}
					// The whole wave is eased by one share where its tightest stretch would bend too far.
					let ease = 1;
					for (let k = 0; k < elbows; k++) {
						const turn = Math.abs((leans[k] as number) - (k > 0 ? (leans[k - 1] as number) : 0));
						const most = turnMost(spots[k] as number, 1 / elbows, over);
						if (turn > most) ease = Math.min(ease, most / turn);
					}
					spots.forEach((spot, k) => {
						ramps.push([k > 0 ? (spots[k - 1] as number) : 0, spot]);
						sways.push([spot, (leans[k] as number) * ease]);
					});
					ramps.push([spots[elbows - 1] as number, 1]);
					sways.push([1, (((leans[elbows - 1] as number) + (leans[elbows] as number)) / 2) * ease]);
					return;
				}
				let lean = 0;
				let nod = 0;
				spots.forEach((spot, k) => {
					// The elbow's own turn: its size, and how much of it is sideways and how much a nod.
					const size =
						rule.sway * (0.35 + 0.55 * draw(Purpose.Sway, shape, k)) * (eases[k] as number);
					const round = draw(Purpose.Nod, shape, k) * 2 * PI;
					// A sideways turn is never less than half the elbow's size, so no elbow is a straight.
					const sideways = Math.max(size / 2, Math.abs(size * cos(round)));
					const toward = draw(Purpose.SwaySide, shape, k + 1) < 0.5 ? 1 : -1;
					const turnSide = strayed(lean, sideways * toward, rule.sway * WANDER_SIDE) - lean;
					const turnNod = strayed(nod, size * 0.6 * sin(round), rule.sway * WANDER_NOD) - nod;
					// The elbow's room: half the way to the elbows either side of it, or to the axis's ends.
					const before = k > 0 ? (spot - (spots[k - 1] as number)) / 2 : spot;
					const after = k + 1 < spots.length ? ((spots[k + 1] as number) - spot) / 2 : 1 - spot;
					const room = Math.max(1e-6, Math.min(before, after));
					// Its stretch is as wide as this wood needs to turn that far, and where its room is
					// less, it turns less.
					const turn = Math.sqrt(turnSide * turnSide + turnNod * turnNod);
					const needs = turn / Math.max(1e-9, turnMost(spot, 1, over)) / 2;
					const wide = Math.min(room, Math.max(half, needs));
					const ease = needs > wide ? wide / needs : 1;
					const from = Math.max(spot - wide, (sways[sways.length - 1] as [number, number])[0]);
					const to = Math.min(1, Math.max(spot + wide, from + 1e-6));
					ramps.push([from, to]);
					sways.push([from, lean], [to, lean + turnSide * ease]);
					dips.push([from, nod], [to, nod + turnNod * ease]);
					lean += turnSide * ease;
					nod += turnNod * ease;
				});
			};
			const across: Vector3 = [-sin(heading), 0, cos(heading)];
			const tangent = (share: number): Vector3 => {
				const base = direction(radians(curveAt(lifts, share)), heading);
				const off = tan(radians(curveAt(sways, share)));
				const nod = tan(radians(curveAt(dips, share)));
				// The nod turns the course in its own upright plane, square to its line.
				const upX = across[1] * base[2] - across[2] * base[1];
				const upY = across[2] * base[0] - across[0] * base[2];
				const upZ = across[0] * base[1] - across[1] * base[0];
				return unit(
					base[0] + across[0] * off + upX * nod,
					base[1] + upY * nod,
					base[2] + across[2] * off + upZ * nod,
				);
			};
			/**
			 * Shapes the course for an axis of a length. A bend and an elbow that fall together turn more
			 * tightly than either alone, so the course is walked, and where its tightest turn is under the
			 * least radius the leans and nods are eased until it is not.
			 */
			const shaped = (over: number): void => {
				eases.fill(1);
				bent(over);
				for (let pass = 0; pass < 4; pass++) {
					let tight = false;
					let before = tangent(0);
					for (let k = 1; k <= TRIAL_STEPS * 2; k++) {
						const share = k / (TRIAL_STEPS * 2);
						const here = tangent(share);
						const turn = between(before, here);
						before = here;
						if (turn < 1e-6) continue;
						const most = turnMost(share, 1 / (TRIAL_STEPS * 2), over);
						if (turn <= most) continue;
						// The elbow whose stretch holds this place turns less.
						const middle = share - 0.5 / (TRIAL_STEPS * 2);
						for (let e = 0; e < ramps.length; e++) {
							const [from, to] = ramps[e] as [number, number];
							if (middle < from || middle > to) continue;
							eases[e] = Math.max(0.2, (eases[e] as number) * Math.max(0.5, most / turn));
							tight = true;
						}
					}
					if (!tight) break;
					bent(over);
				}
			};

			// The length: stated, or found so that the tip stands where the rule says.
			const lengthRule = rule.length;
			// A first length to shape the bends for, before the course is measured.
			let length =
				'share' in lengthRule
					? curveAt(lengthRule.share, place) * scale
					: 'parent' in lengthRule
						? curveAt(lengthRule.parent, place) * parentLength
						: 0.3 * scale;
			shaped(length);
			/**
			 * The length, up to a stated one, at which a course that runs down first takes its tip
			 * under the crown's lower boundary, or deeper under it than where it left. A course that
			 * does not run down keeps its length, since wood may run along the boundary.
			 */
			const aboveUnder = (most: number): number => {
				// A tip stands a length along the course's mean heading, whatever the length.
				const run = tipOf([0, 0, 0], tangent, 1);
				if (run[1] >= 0) return most;
				const under = (trial: number): number =>
					outlineUnder(spec, scale, start[0] + run[0] * trial, start[2] + run[2] * trial) -
					(start[1] + run[1] * trial);
				const from = Math.max(0, under(0));
				let clear = 0;
				for (let k = 1; k <= UNDER_STEPS; k++) {
					const trial = (most * k) / UNDER_STEPS;
					if (under(trial) <= from) {
						clear = trial;
						continue;
					}
					let low = clear;
					let high = trial;
					for (let pass = 0; pass < UNDER_PASSES; pass++) {
						const middle = (low + high) / 2;
						if (under(middle) <= from) low = middle;
						else high = middle;
					}
					return low;
				}
				return most;
			};
			/** Finds the length from the course as it stands. */
			const measure = (): void => {
				if ('share' in lengthRule) length = curveAt(lengthRule.share, place) * scale;
				else if ('parent' in lengthRule) length = curveAt(lengthRule.parent, place) * parentLength;
				else {
					/** How far past its mark a trial length's tip stands; it rises with the length. */
					const past = (trial: number): number => {
						const tip = tipOf(start, tangent, trial);
						if ('outline' in lengthRule) {
							// The outline drawn in toward the crown's middle: its radius and its height above
							// and below the widest row both take the share.
							const share = Math.max(0.05, curveAt(lengthRule.outline, place));
							const reach = Math.sqrt(tip[0] * tip[0] + tip[2] * tip[2]);
							const at = middle + (tip[1] - middle) / share;
							return reach - share * outlineRadius(spec, scale, at, atan2(tip[2], tip[0]));
						}
						return tip[1] - curveAt(lengthRule.height, place) * scale;
					};
					let low = 0.01 * scale;
					let high = 2 * scale;
					// A hanging axis nears its mark from above, so its measure falls as it lengthens.
					const falls = past(low) > 0 && 'height' in lengthRule;
					for (let pass = 0; pass < LENGTH_PASSES; pass++) {
						const trial = (low + high) / 2;
						const over = falls ? -past(trial) : past(trial);
						if (over < 0) low = trial;
						else high = trial;
					}
					length = (low + high) / 2;
				}
				if (rule.vary) length *= 1 + (draw(Purpose.Vary, id) * 2 - 1) * rule.vary;
				if (rule.most !== undefined) length = Math.min(length, curveAt(rule.most, place) * scale);
				if (rule.least !== undefined) length = Math.max(length, curveAt(rule.least, place) * scale);
				if ('outline' in lengthRule) length = aboveUnder(length);
				length = Math.max(length, 0.01 * scale);
			};
			// The bends are shaped for the length, and the length is found from the bends, twice over.
			for (let pass = 0; pass < 2; pass++) {
				measure();
				shaped(length);
			}
			measure();

			// Where each child leaves, as shares of this axis's length.
			const seats: Seat[] = [];
			(rule.children ?? []).forEach((child, c) => {
				const [from, to] = child.along;
				let count: number;
				if (typeof child.count === 'number') count = Math.max(0, Math.round(child.count));
				else if ('total' in child.count) {
					const total = Math.max(0, Math.round(child.count.total));
					count = Math.floor(((index + 1) * total) / among) - Math.floor((index * total) / among);
				} else
					count = clamp(
						Math.round(((to - from) * length) / Math.max(1e-6, child.count.every * scale)),
						child.count.least,
						child.count.most,
					);
				const places = child.around === 'opposite' ? Math.ceil(count / 2) : count;
				const gap = places > 1 ? (to - from) / (places - 1) : 0;
				for (let k = 0; k < count; k++) {
					const at = child.around === 'opposite' ? Math.floor(k / 2) : k;
					// The seat at the parent's own end stays there, so the parent does not end bare.
					const ends = at === places - 1 && to >= 1;
					const off = ends
						? 0
						: (draw(Purpose.Stagger, id, c * 256 + at) * 2 - 1) * (child.stagger ?? 0) * gap;
					seats.push({
						rule: child,
						index: k,
						count,
						share: clamp(places > 1 ? from + gap * at + off : (from + to) / 2, 0.02, 1),
					});
				}
			});

			// A crooked axis turns where a child leaves: the elbow nearest each seat moves onto it, where
			// that keeps the elbows in order and clear of each other, and the length is found again.
			if (crook > 0 && seats.length > 0) {
				const taken = new Set<number>();
				for (const seat of seats) {
					if (seat.share < half || seat.share > 1 - half) continue;
					let best = -1;
					for (let k = 0; k < spots.length; k++)
						if (
							!taken.has(k) &&
							(best < 0 ||
								Math.abs((spots[k] as number) - seat.share) <
									Math.abs((spots[best] as number) - seat.share))
						)
							best = k;
					if (best < 0 || Math.abs((spots[best] as number) - seat.share) > 0.5 / elbows) continue;
					const before = best > 0 ? (spots[best - 1] as number) : -1;
					const after = best + 1 < spots.length ? (spots[best + 1] as number) : 2;
					if (seat.share - before < 2 * half || after - seat.share < 2 * half) continue;
					spots[best] = seat.share;
					taken.add(best);
				}
				if (taken.size > 0) {
					shaped(length);
					measure();
					shaped(length);
				}
			}
			const stem = role === 'stem' ? (rule as FrameStemRule) : undefined;
			// A stem is also cut where its width is stated, so its foot's flare keeps its shape.
			const widths =
				stem && typeof stem.width !== 'number'
					? stem.width.map((knot) => (knot[0] * scale) / length).filter((share) => share < 1)
					: [];
			const knots = [...lifts.map((knot) => knot[0]), ...sways.map((knot) => knot[0]), ...widths];
			// What the axis keeps of its cross-section past each child, by the share where the child
			// leaves.
			const shed = stem ? 0 : clamp(rule.shed ?? 0, 0, 1);
			const forks: [number, number][] = [];
			if (shed > 0)
				for (const seat of seats) {
					const among = seat.count > 1 ? seat.index / (seat.count - 1) : 0;
					const ratio = Math.min(BASE_MOST, curveAt(seat.rule.radius, among));
					forks.push([seat.share, Math.sqrt(Math.max(0.05, 1 - shed * ratio * ratio))]);
				}
			const kept = (share: number): number => {
				let keeps = 1;
				for (const [at, keep] of forks) if (at < share - 1e-9) keeps *= keep;
				return keeps;
			};
			const laid = lay(
				start,
				tangent,
				length,
				knots,
				seats.map((seat) => seat.share),
			);
			return { laid, seats, length, tangent, stem, kept };
		};
		let pick = drawn(0);
		const apart = 'apart' in rule && rule.apart ? rule.apart * scale : 0;
		/**
		 * The least gap between the wood of an attempt's outer half and the wood of every axis built
		 * before it, the axis it leaves apart: the distance between their lines less both radii. The
		 * wood its parent grew from counts, so a branch does not end against its bough's own limb.
		 */
		const room = (attempt: typeof pick): number => {
			let least = Number.POSITIVE_INFINITY;
			attempt.laid.points.forEach((point, k) => {
				const share = attempt.laid.along[k] as number;
				if (share < OUTER_FROM) return;
				const own =
					baseRadius * (1 - (1 - clamp((rule as FrameBranchRule).taper, 0.02, 1)) * share);
				for (const other of wood) {
					if (other.axis === parent) continue;
					const dx = point[0] - other.at[0];
					const dy = point[1] - other.at[1];
					const dz = point[2] - other.at[2];
					least = Math.min(least, Math.sqrt(dx * dx + dy * dy + dz * dz) - other.radius - own);
				}
			});
			return least;
		};
		if (apart > 0 && wood.length > 0) {
			let clear = room(pick);
			for (let attempt = 1; attempt < APART_TRIES && clear < apart; attempt++) {
				const next = drawn(attempt);
				const found = room(next);
				if (found > clear) {
					pick = next;
					clear = found;
				}
			}
		}
		const { laid, seats, length, tangent, stem, kept } = pick;
		const taper = stem ? 1 : clamp((rule as FrameBranchRule).taper, 0.02, 1);
		const radiusAt = (share: number): number =>
			Math.max(
				RADIUS_LEAST,
				stem
					? (curveAt(stem.width, (share * length) / scale) * scale) / 2
					: baseRadius * (1 - (1 - taper) * share) * kept(share),
			);
		const nodes: FrameNode[] = [];
		const along: number[] = [];
		// A stem's first node is its foot; any other axis starts on its parent's node.
		const lead = stem ? 1 : 0;
		if (stem) {
			nodes.push({ x: start[0], y: start[1], z: start[2], radius: radiusAt(0) });
			along.push(0);
		}
		laid.points.forEach((point, k) => {
			const share = laid.along[k] as number;
			nodes.push({ x: point[0], y: point[1], z: point[2], radius: radiusAt(share) });
			along.push(share);
		});
		axes.push({
			rule: rule.name,
			role,
			order,
			parent,
			parentNode,
			index,
			place,
			azimuth: (heading * 180) / PI,
			length,
			base: radiusAt(0),
			nodes,
			along,
		});
		for (const node of nodes)
			wood.push({ at: [node.x, node.y, node.z], radius: node.radius, axis: id });

		const end = nodes[nodes.length - 1] as FrameNode;
		const lastTangent = tangent(1);
		const lastFlat = Math.sqrt(lastTangent[0] * lastTangent[0] + lastTangent[2] * lastTangent[2]);
		const level: Vector3 =
			lastFlat > 0.2
				? [lastTangent[0] / lastFlat, 0, lastTangent[2] / lastFlat]
				: [cos(heading), 0, sin(heading)];
		if (rule.patch) {
			const patch = rule.patch;
			let width = curveAt(patch.width, place) * scale;
			let depth = curveAt(patch.depth, place) * scale;
			let centre: Vector3;
			if (patch.along === undefined)
				// Foliage stands on the crown's lower boundary where its wood runs along it or ends at
				// it, and never under it.
				centre = [
					end.x,
					Math.max(
						end.y + (patch.offset ?? 0) * depth,
						outlineUnder(spec, scale, end.x, end.z) + depth / 2,
					),
					end.z,
				];
			else {
				// The patch clothes the axis: it holds every node past the share where it begins.
				const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
				const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
				nodes.forEach((node, k) => {
					if ((along[k] as number) < (patch.along as number) && k < nodes.length - 1) return;
					const point = [node.x, node.y, node.z];
					for (let a = 0; a < 3; a++) {
						low[a] = Math.min(low[a] as number, point[a] as number);
						high[a] = Math.max(high[a] as number, point[a] as number);
					}
				});
				const spanX = (high[0] as number) - (low[0] as number);
				const spanZ = (high[2] as number) - (low[2] as number);
				width = Math.max(width, Math.sqrt(spanX * spanX + spanZ * spanZ));
				depth = Math.max(depth, (high[1] as number) - (low[1] as number));
				centre = [
					((low[0] as number) + (high[0] as number)) / 2,
					((low[1] as number) + (high[1] as number)) / 2,
					((low[2] as number) + (high[2] as number)) / 2,
				];
			}
			patches.push({
				kind: patch.kind,
				axis: id,
				centre,
				begins: Math.max(0, Math.sqrt(centre[0] * centre[0] + centre[2] * centre[2]) - width / 2),
				width,
				depth,
				along: level,
			});
		}

		// The children, each from the node at its share.
		const phases = new Map<FrameBranchRule, number>();
		const sides = new Map<FrameBranchRule, number>();
		seats.forEach((seat, s) => {
			const child = seat.rule;
			const c = (rule.children ?? []).indexOf(child);
			const node = lead + (laid.at[s] as number);
			const here = nodes[node] as FrameNode;
			const share = along[node] as number;
			const t = tangent(share);
			const childPlace = seat.count > 1 ? seat.index / (seat.count - 1) : 0;
			if (!phases.has(child)) {
				phases.set(
					child,
					child.first !== undefined ? child.first : draw(Purpose.Round, id, c) * 360,
				);
				sides.set(child, draw(Purpose.Side, id, c) < 0.5 ? 1 : -1);
			}
			const phase = phases.get(child) as number;
			const jitter = (draw(Purpose.Jitter, id, c * 256 + seat.index) * 2 - 1) * (child.jitter ?? 0);
			let round: number;
			if (typeof child.around !== 'string')
				round = child.around[seat.index % Math.max(1, child.around.length)] ?? 0;
			else if (child.around === 'spiral') round = phase + seat.index * GOLDEN;
			else if (child.around === 'ring') round = phase + (seat.index * 360) / seat.count;
			else if (child.around === 'opposite')
				round = phase + Math.floor(seat.index / 2) * 90 + (seat.index % 2) * 180;
			else
				round =
					(seat.index % 2 === 0 ? 1 : -1) * (sides.get(child) as number) * (90 - (child.lift ?? 0));
			// Round a parent that leans, the places are drawn in away from its ground side.
			if (
				child.clear &&
				child.from === 'parent' &&
				(child.around === 'spiral' || child.around === 'ring') &&
				Math.abs(t[1]) < PLUMB_NEAR
			) {
				const wrapped = ((((round + jitter) % 360) + 540) % 360) - 180;
				round = wrapped * (1 - clamp(child.clear, 0, 300) / 360) - jitter;
			}
			round = radians(round + jitter);
			const angle = radians(
				curveAt(child.angle, childPlace) +
					(draw(Purpose.Angle, id, c * 256 + seat.index) * 2 - 1) * (child.angleSpread ?? 0),
			);
			let leaves: Vector3;
			if (child.from === 'plumb') leaves = direction(PI / 2 - angle, round);
			else {
				// The parent's own frame: `u` its sky side and `v` its level side.
				const tFlat = Math.sqrt(t[0] * t[0] + t[2] * t[2]);
				const u: Vector3 =
					tFlat > 0.05 ? unit(-t[0] * t[1], 1 - t[1] * t[1], -t[2] * t[1]) : [1, 0, 0];
				const v: Vector3 = [
					t[1] * u[2] - t[2] * u[1],
					t[2] * u[0] - t[0] * u[2],
					t[0] * u[1] - t[1] * u[0],
				];
				const cu = cos(round) * sin(angle);
				const cv = sin(round) * sin(angle);
				const ct = cos(angle);
				leaves = unit(
					t[0] * ct + u[0] * cu + v[0] * cv,
					t[1] * ct + u[1] * cu + v[1] * cv,
					t[2] * ct + u[2] * cu + v[2] * cv,
				);
			}
			build(
				child,
				child.role,
				[here.x, here.y, here.z],
				leaves,
				id,
				node,
				seat.index,
				seat.count,
				childPlace,
				Math.min(BASE_MOST, curveAt(child.radius, childPlace)) * here.radius,
				length,
			);
		});
	};

	// The stems: the inner ones evenly round the base's middle and the outer ones evenly round them,
	// each leaning away from the middle.
	const stems = spec.stems;
	const count = Math.max(1, Math.round(stems.count));
	const inner = clamp(Math.round(stems.inner ?? 0), 0, count);
	const first = stems.first ?? draw(Purpose.Round, 0, 4095) * 360;
	for (let k = 0; k < count; k++) {
		const place = count > 1 ? k / (count - 1) : 0;
		const among = k < inner ? inner : count - inner;
		const slot = k < inner ? k : k - inner;
		const round = radians(first + (k < inner ? 90 : 0) + (slot * 360) / among);
		const ring = curveAt(stems.ring ?? 0, place) * scale;
		const lean = radians(curveAt(stems.lean ?? 0, place));
		build(
			stems,
			'stem',
			[cos(round) * ring, 0, sin(round) * ring],
			direction(PI / 2 - lean, round),
			-1,
			-1,
			k,
			count,
			place,
			0,
			scale,
		);
	}

	let top = 0;
	let crownBase = Number.POSITIVE_INFINITY;
	for (const axis of axes) for (const node of axis.nodes) top = Math.max(top, node.y);
	for (const patch of patches) {
		top = Math.max(top, patch.centre[1] + patch.depth / 2);
		crownBase = Math.min(crownBase, patch.centre[1] - patch.depth / 2);
	}
	return {
		height: top,
		scale,
		axes,
		patches,
		crownBase: Number.isFinite(crownBase) ? Math.max(0, crownBase) : top,
	};
}

/** What a frame's axes are in a skeleton: each axis's index, its nodes and the metres along it. */
interface Written {
	readonly axis: number;
	readonly nodes: number[];
	readonly runs: number[];
}

/** Writes a frame's axes into a skeleton builder, every parent before its children. */
function writeAxes(plan: FramePlan, builder: SkeletonBuilder): Written[] {
	const ageAt = (y: number): number =>
		Math.round(clamp((plan.height - y) / Math.max(1, plan.height), 0, 1) * AGE_MOST);
	const written: Written[] = [];
	for (const axis of plan.axes) {
		const parent = axis.parent < 0 ? undefined : written[axis.parent];
		const parentNode = parent ? (parent.nodes[axis.parentNode] as number) : -1;
		const index = builder.addAxis({
			parent: parent ? parent.axis : -1,
			parentNode,
			order: axis.order,
			kind: axis.role === 'stem' ? AXIS_STEM : AXIS_LIMB,
			barkV: parent ? (parent.runs[axis.parentNode] as number) : 0,
			barkU: radians(axis.azimuth),
		});
		const nodes: number[] = [];
		const runs: number[] = [];
		let last = parentNode;
		axis.nodes.forEach((node, k) => {
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius,
				parent: last,
				axis: index,
				light: 1,
				age: ageAt(node.y),
			});
			nodes.push(last);
			runs.push((axis.along[k] as number) * axis.length);
		});
		written.push({ axis: index, nodes, runs });
	}
	return written;
}

/**
 * Writes a frame's axes into a skeleton. The foliage patches stay in the plan.
 *
 * @param plan The frame.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function frameSkeleton(plan: FramePlan): MacroSkeleton {
	const builder = new SkeletonBuilder();
	writeAxes(plan, builder);
	return builder.finish(plan.crownBase);
}

/**
 * A socket of a frame: the end of the wood under a foliage patch, which carries one piece.
 *
 * @category api/vegetation
 */
export interface FrameSocket {
	/** The patch it carries the foliage of, by its index in the plan: the socket's mass. */
	readonly patch: number;
	/** The axis whose end it is, by its index in the plan. */
	readonly axis: number;
	/** Where it stands, in metres. */
	readonly at: Vector3;
	/** The direction the wood runs in at its end, a unit vector: the way its piece grows. */
	readonly heading: Vector3;
	/**
	 * Its rank across the whole plant, from 0: the sockets below any rank stand spread through the
	 * crown, so a plant thinned to a rank keeps its outline.
	 */
	readonly rank: number;
}

/**
 * The sockets of a frame: one at the end of every axis that carries a foliage patch, ranked once
 * across the whole plant.
 *
 * @param plan The frame.
 * @returns The sockets, in the patches' order.
 * @category api/vegetation
 */
export function frameSockets(plan: FramePlan): FrameSocket[] {
	const ends = plan.patches.map((patch, index) => {
		const axis = plan.axes[patch.axis] as FrameAxis;
		const last = axis.nodes.length - 1;
		const end = axis.nodes[last] as FrameNode;
		const from =
			last > 0
				? (axis.nodes[last - 1] as FrameNode)
				: ((plan.axes[axis.parent]?.nodes[axis.parentNode] as FrameNode | undefined) ?? end);
		return {
			patch: index,
			axis: patch.axis,
			at: [end.x, end.y, end.z] as Vector3,
			heading: unit(end.x - from.x, end.y - from.y, end.z - from.z),
		};
	});
	const ranks = thinningRanks(ends.map((socket) => socket.at));
	return ends.map((socket, k) => ({ ...socket, rank: ranks[k] as number }));
}

/**
 * Grows one plant whose record states its frame as its growth: the frame's axes as a skeleton, and
 * each socket as a bud site with the socket record. A socket's frame has +Y along the wood's end
 * and +Z toward the sky; its scale is the plant's own height over the species' middle height, so a
 * taller plant carries larger pieces; its mass is its patch.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growFrame(input: GrowInput): MacroSkeleton {
	const growth = input.record.growth;
	if (growth.model !== 'frame')
		throw new Error(`@null3d/vegetation: ${input.record.id} does not grow by the frame model`);
	const plan = planFrame(growth.frame, input);
	const builder = new SkeletonBuilder();
	const written = writeAxes(plan, builder);
	const scale = plan.scale / Math.max(1e-6, spreadMean(input.record.size.height));
	const frame = new Float32Array(4);
	for (const socket of frameSockets(plan)) {
		const wood = written[socket.axis] as Written;
		const end = (plan.axes[socket.axis] as FrameAxis).nodes.length - 1;
		quatFromFrame(
			socket.heading,
			Math.abs(socket.heading[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0],
			frame,
		);
		builder.addBud({
			node: wood.nodes[end] as number,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: wood.axis,
			woodRadius: ((plan.axes[socket.axis] as FrameAxis).nodes[end] as FrameNode).radius,
			socket: { scale, rank: socket.rank, lobe: socket.patch },
		});
	}
	return builder.finish(plan.crownBase);
}

/**
 * A species' record with a frame as its growth, in place of the growth it is registered with. Its
 * forms state the registered growth's figures, so they are left out.
 *
 * @param record The species' registered record.
 * @param frame The species' frame.
 * @param sockets What each socket holds.
 * @returns The record that grows by the frame.
 * @category api/vegetation
 */
export function framedRecord(
	record: Species,
	frame: FrameSpec,
	sockets: Framed['sockets'],
): Species {
	const { forms: _forms, ...own } = record;
	return { ...own, growth: { model: 'frame', frame, sockets } };
}

/** The frame grower. */
export const grower: Grower = {
	grow: growFrame,
};
