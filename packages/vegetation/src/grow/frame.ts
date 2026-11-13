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
	quatAxisAngle,
	quatFromFrame,
	quatMultiply,
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
 * The passes in which a course cut short by the boundary is shaped again for its new length, and
 * the share of the height its tip may stand past the cut before it is cut again.
 */
const SETTLE_PASSES = 4;
const SETTLE_WITHIN = 0.0005;
/**
 * How far a crooked axis may stray from its own line, sideways and up or down, as shares of its
 * rule's sway: wide enough that its mean line wanders, and bounded so it keeps its course.
 */
const WANDER_SIDE = 0.8;
const WANDER_NOD = 0.5;
/**
 * Axes that keep apart: the share of an axis's length over which it stands beside the wood it
 * leaves, and is held clear only of other wood, how many times an axis may be shaped, and the step
 * between one shaping's hash keys and the next's.
 */
const OUTER_FROM = 0.2;
const APART_TRIES = 8;
/**
 * The wood built so far is kept so that the wood near a piece is found without a read of all of
 * it: runs of wood up to this radius, as a share of the height, stand in a grid of cells this
 * wide, and the few thicker runs are read one by one.
 */
const WOOD_THIN = 0.01;
const WOOD_CELL = 0.03;
/** Half the cells a grid holds along one line, which no plant's wood reaches. */
const WOOD_CELLS = 4096;
/**
 * Fine wood that fills a patch. A twig's piece runs this share of the pitch; a socket stands this
 * share of the piece's length inside the patch's surface, since a piece lies out at an angle; a
 * point of the surface is inside another patch under this share of that patch's own radius; a
 * twig is this share of the wood it leaves at most, and this many times its own end's radius at
 * most; it stands this share of the height clear of other wood; and the twigs grow for this many
 * rounds at most.
 */
const FILL_STEP = 0.6;
const FILL_INSET = 0.7;
const FILL_INSIDE = 0.8;
const FILL_SHARE = 0.7;
const FILL_STOUT = 3;
const FILL_CLEAR = 0.001;
const FILL_ROUNDS = 16;
/**
 * The shells a patch's sockets stand on, from the outermost in: each one's size as a share of the
 * outermost's, and the share of the outermost's spacing of points it keeps over its own surface, so
 * the inner twigs carry fewer pieces the nearer the patch's middle they stand.
 */
const FILL_SHELLS: readonly (readonly [size: number, keep: number])[] = [
	[1, 1],
	[0.65, 0.85],
	[0.35, 0.6],
];
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
	Fill: 14,
	Turn: 15,
} as const;
/**
 * The steps of the plastic number's sequence, which spreads pairs of shares evenly over a run of
 * any length: a piece's roll takes the first and its tilt the second.
 */
const SPREAD_ROLL = 0.7548776662466927;
const SPREAD_TILT = 0.5698402909980532;

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
	/**
	 * Sockets along the wood under the patch, beside the one at the wood's end: the share of the
	 * plant's height from one to the next, and the degrees each stands out from the wood's line.
	 * They run back from the end for half the patch's width, or over the whole run a patch that
	 * clothes its axis clothes, each turned on round the wood from the last and none on the wood's
	 * underside. Left out, the patch has the one socket at the end.
	 */
	readonly sockets?: { readonly every: number; readonly angle: number };
	/**
	 * Fine wood that clothes the patch: twigs grown from the wood under it toward points spread
	 * over its surface, each twig ending in a socket. `pitch` is the share of the plant's height
	 * from one such point to the next over the surface, which is the width of the piece a socket
	 * carries, and `reach` is that piece's length, which the sockets stand inside the surface by.
	 * A point is left out where the surface stands inside another patch or under the crown's lower
	 * boundary. Left out, the patch has no wood of its own.
	 */
	readonly fill?: { readonly pitch: number; readonly reach: number };
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
	/**
	 * The direction round the plant, in degrees, that the view showing this side was taken from. A
	 * place behind the trunk from there, inside the trunk's width, is hidden by the trunk in that
	 * view, so this side's lower boundary does not bind it. Left out, the boundary binds every place
	 * on the side.
	 */
	readonly seen?: number;
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
	/** The sockets along the wood under the patch: the metres between them and their angle. */
	readonly sockets?: { readonly every: number; readonly angle: number };
	/**
	 * The share of its axis's length from which the patch clothes the axis itself, as a hanging
	 * whip's does. Absent, the patch stands at the axis's end.
	 */
	readonly clothes?: number;
}

/** A patch while its plan is built, with the fine wood it asks for, in metres. */
interface Mass extends FramePatch {
	readonly fill?: { readonly pitch: number; readonly reach: number };
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

/** The least distance between two straight runs, each from one point to another. */
function runsApart(
	a0: Readonly<Vector3>,
	a1: Readonly<Vector3>,
	b0: Readonly<Vector3>,
	b1: Readonly<Vector3>,
): number {
	const ux = a1[0] - a0[0];
	const uy = a1[1] - a0[1];
	const uz = a1[2] - a0[2];
	const vx = b1[0] - b0[0];
	const vy = b1[1] - b0[1];
	const vz = b1[2] - b0[2];
	const wx = a0[0] - b0[0];
	const wy = a0[1] - b0[1];
	const wz = a0[2] - b0[2];
	const a = ux * ux + uy * uy + uz * uz;
	const b = ux * vx + uy * vy + uz * vz;
	const c = vx * vx + vy * vy + vz * vz;
	const d = ux * wx + uy * wy + uz * wz;
	const e = vx * wx + vy * wy + vz * wz;
	const square = a * c - b * b;
	let s = square > 1e-12 ? clamp((b * e - c * d) / square, 0, 1) : 0;
	const t = c > 1e-12 ? clamp((b * s + e) / c, 0, 1) : 0;
	s = a > 1e-12 ? clamp((b * t - d) / a, 0, 1) : 0;
	const x = wx + s * ux - t * vx;
	const y = wy + s * uy - t * vy;
	const z = wz + s * uz - t * vz;
	return Math.sqrt(x * x + y * y + z * z);
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

/** A twig's node while a patch is filled: where it stands and the node it grew from. */
interface Sprout {
	readonly at: Vector3;
	readonly from: number;
	/** The node of the patch's own axis it is, or -1 for a node of a twig. */
	readonly seed: number;
	/** Whether a socket stands at it. */
	readonly socket: boolean;
}

/** A run of the wood already built: a straight piece from one of its points to the next. */
interface WoodPoint {
	readonly from: Vector3;
	readonly at: Vector3;
	readonly radius: number;
	readonly axis: number;
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
 * their boundaries there. A side does not bind a place that its view sees only as the trunk, behind
 * it and inside its width.
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
		if (reach < 0) continue;
		if (side.seen !== undefined) {
			// The trunk's half width where the view shows its bole bare, which hides what stands
			// behind it.
			const bare = curveAt(side.under, 0);
			const hidden = (curveAt(spec.stems.width, bare) * scale) / 2;
			const from = radians(side.seen);
			if (x * cos(from) + z * sin(from) < 0 && reach < hidden) continue;
		}
		highest = Math.max(highest, curveAt(side.under, reach / scale));
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
	const patches: Mass[] = [];
	/** The wood built so far, each run with its radius and its axis, for the axes that keep apart. */
	const thick: WoodPoint[] = [];
	const thin = new Map<number, WoodPoint[]>();
	const cell = WOOD_CELL * scale;
	const cellOf = (at: number): number => Math.floor(at / cell);
	const cellKey = (i: number, j: number, k: number): number =>
		((i + WOOD_CELLS) * 2 * WOOD_CELLS + j + WOOD_CELLS) * 2 * WOOD_CELLS + k + WOOD_CELLS;
	/**
	 * The least gap between a piece of wood of a radius, from one point to another, and the wood
	 * built so far, apart from the axes asked to be left out: the distance between their straight
	 * runs less both radii. Where no wood stands nearer than the gap asked for, the figure is only
	 * known to be at least that gap.
	 */
	const gapAt = (
		from: Readonly<Vector3>,
		point: Readonly<Vector3>,
		own: number,
		skip: (axis: number) => boolean,
		asked: number,
	): number => {
		let least = Number.POSITIVE_INFINITY;
		const gap = (other: WoodPoint): void => {
			if (skip(other.axis)) return;
			least = Math.min(least, runsApart(from, point, other.from, other.at) - other.radius - own);
		};
		for (const other of thick) gap(other);
		// Thin wood farther off than this stands clear by more than the gap asked for. A run is kept
		// in every cell its box touches, so the cells round the piece's own box hold every run near it.
		const near = asked + own + WOOD_THIN * scale;
		for (
			let i = cellOf(Math.min(from[0], point[0]) - near);
			i <= cellOf(Math.max(from[0], point[0]) + near);
			i++
		)
			for (
				let j = cellOf(Math.min(from[1], point[1]) - near);
				j <= cellOf(Math.max(from[1], point[1]) + near);
				j++
			)
				for (
					let c = cellOf(Math.min(from[2], point[2]) - near);
					c <= cellOf(Math.max(from[2], point[2]) + near);
					c++
				) {
					const held = thin.get(cellKey(i, j, c));
					if (held) for (const other of held) gap(other);
				}
		return least;
	};
	const addWood = (run: WoodPoint): void => {
		if (run.radius > WOOD_THIN * scale) {
			thick.push(run);
			return;
		}
		for (
			let i = cellOf(Math.min(run.from[0], run.at[0]));
			i <= cellOf(Math.max(run.from[0], run.at[0]));
			i++
		)
			for (
				let j = cellOf(Math.min(run.from[1], run.at[1]));
				j <= cellOf(Math.max(run.from[1], run.at[1]));
				j++
			)
				for (
					let c = cellOf(Math.min(run.from[2], run.at[2]));
					c <= cellOf(Math.max(run.from[2], run.at[2]));
					c++
				) {
					const key = cellKey(i, j, c);
					const held = thin.get(key);
					if (held) held.push(run);
					else thin.set(key, [run]);
				}
	};
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
			/** Whether the lower boundary cut the axis short, and shorter than its rule's least. */
			let cut = false;
			let stunted = false;
			/** The length the course was last shaped for. */
			let shapedFor = 0;
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
				shapedFor = over;
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
			 * under the crown's lower boundary, or deeper under it than where it left; for an axis
			 * whose patch is clothed with pieces, where the piece at its end first would. A course
			 * that does not run down keeps its length, since wood may run along the boundary.
			 */
			const aboveUnder = (most: number): number => {
				// A tip stands a length along the course's mean heading, whatever the length.
				const run = tipOf([0, 0, 0], tangent, 1);
				if (run[1] >= 0) return most;
				// The piece at the end of a clothed axis lies out along the axis's last run, so the course
				// ends where that piece's foot stands on the boundary, read under the piece's middle, or
				// where the tip itself does, whichever comes first.
				const fill = rule.patch?.fill;
				const last = tangent(1);
				const drop = clamp(-last[1], 0, 1);
				const reach = (fill?.reach ?? 0) * scale;
				const hang = fill ? drop * reach + (fill.pitch * scale * (1 - drop)) / 6 : 0;
				const under = (trial: number): number => {
					const x = start[0] + run[0] * trial;
					const y = start[1] + run[1] * trial;
					const z = start[2] + run[2] * trial;
					return Math.max(
						outlineUnder(spec, scale, x, z) - y,
						outlineUnder(spec, scale, x + (last[0] * reach) / 2, z + (last[2] * reach) / 2) -
							(y - hang),
					);
				};
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
				if ('outline' in lengthRule) {
					const kept = aboveUnder(length);
					stunted = rule.least !== undefined && kept < curveAt(rule.least, place) * scale - 1e-9;
					if (kept < length - 1e-9) cut = true;
					length = kept;
				}
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
			// The last shaping moves the tip, so a course that runs down is read against the lower
			// boundary once more as it now stands. A course the boundary cuts is shaped again for its
			// new length, so its bends are not drawn tighter than its wood allows, and read again,
			// until its shape fits its length and its tip holds; past the last pass it is cut as it
			// stands. A course the boundary never cuts keeps its shape.
			if ('outline' in lengthRule)
				for (let pass = 0; pass <= SETTLE_PASSES; pass++) {
					const kept = Math.max(aboveUnder(length), 0.01 * scale);
					const short = kept < length - SETTLE_WITHIN * scale;
					if (short) {
						length = kept;
						cut = true;
						if (rule.least !== undefined && kept < curveAt(rule.least, place) * scale - 1e-9)
							stunted = true;
					}
					if (!cut || (!short && Math.abs(length - shapedFor) <= SETTLE_WITHIN * scale)) break;
					if (pass < SETTLE_PASSES) shaped(length);
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
			return { laid, seats, length, tangent, stem, kept, stunted };
		};
		let pick = drawn(0);
		const apart = 'apart' in rule && rule.apart ? rule.apart * scale : 0;
		/**
		 * The wood an axis stands beside where it leaves: its parent, the wood its parent leaves and
		 * the axes that leave its parent too, which stand together with it at its base.
		 */
		const beside = new Set<number>([parent]);
		const grand = axes[parent]?.parent ?? -1;
		if (grand >= 0) beside.add(grand);
		axes.forEach((other, k) => {
			if (other.parent === parent) beside.add(k);
		});
		const skipBeside = (axis: number): boolean => beside.has(axis);
		const skipParent = (axis: number): boolean => axis === parent;
		const onlyParent = (axis: number): boolean => axis !== parent;
		// Where it leaves, an axis stands inside its parent's thickness as far as both radii reach.
		const seat = parent >= 0 ? (axes[parent] as Built).nodes[parentNode] : undefined;
		const junction = (seat?.radius ?? 0) + baseRadius;
		/**
		 * The least gap between the wood of an attempt and the wood of every axis built before it:
		 * the distance between their straight runs less both radii. Over its first stretch an axis
		 * stands beside the wood it leaves, so there the wood beside it is left out. Past that
		 * stretch the wood its parent grew from counts, so a branch does not end against its
		 * bough's own limb; and once it has left its parent's thickness its parent counts too, which
		 * it must not pass back through, though it may run as near it as it likes.
		 */
		const room = (attempt: typeof pick): number => {
			let least = Number.POSITIVE_INFINITY;
			const taper = clamp((rule as FrameBranchRule).taper, 0.02, 1);
			attempt.laid.points.forEach((point, k) => {
				const share = attempt.laid.along[k] as number;
				const radius = baseRadius * (1 - (1 - taper) * share);
				const prior = k > 0 ? (attempt.laid.points[k - 1] as Vector3) : start;
				if (share < OUTER_FROM) {
					least = Math.min(least, gapAt(prior, point, radius, skipBeside, apart));
					return;
				}
				least = Math.min(least, gapAt(prior, point, radius, skipParent, apart));
				const dx = point[0] - start[0];
				const dy = point[1] - start[1];
				const dz = point[2] - start[2];
				if (dx * dx + dy * dy + dz * dz >= junction * junction)
					least = Math.min(least, gapAt(prior, point, radius, onlyParent, 0) + apart);
			});
			return least;
		};
		if (apart > 0 && axes.length > 0) {
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
		const { laid, seats, length, tangent, stem, kept, stunted } = pick;
		// An axis that the lower boundary cuts shorter than its rule's least is not grown, nor the
		// axes it would carry; and one that carries foliage and no other axis, and ends under the
		// boundary, would hang its foliage under it, so it is not grown either.
		const tip = laid.points[laid.points.length - 1];
		if (
			!stem &&
			(stunted ||
				(rule.patch &&
					seats.length === 0 &&
					tip &&
					tip[1] < outlineUnder(spec, scale, tip[0], tip[2])))
		)
			return;
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
		nodes.forEach((node, k) => {
			const prior = k > 0 ? (nodes[k - 1] as FrameNode) : undefined;
			addWood({
				from: prior ? [prior.x, prior.y, prior.z] : [start[0], start[1], start[2]],
				at: [node.x, node.y, node.z],
				radius: node.radius,
				axis: id,
			});
		});

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
			if (patch.along === undefined) {
				centre = [end.x, end.y + (patch.offset ?? 0) * depth, end.z];
				// A patch with no wood of its own is cut where it would hang under the crown's lower
				// boundary: its top stays and its foot stands on the boundary.
				const under = outlineUnder(spec, scale, end.x, end.z);
				const over = centre[1] + depth / 2;
				if (!patch.fill && centre[1] - depth / 2 < under && over > under) {
					depth = over - under;
					centre[1] = (over + under) / 2;
				}
			} else {
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
				...(patch.sockets
					? { sockets: { every: patch.sockets.every * scale, angle: patch.sockets.angle } }
					: {}),
				...(patch.along === undefined ? {} : { clothes: patch.along }),
				...(patch.fill
					? { fill: { pitch: patch.fill.pitch * scale, reach: patch.fill.reach * scale } }
					: {}),
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

	/**
	 * Clothes each patch that asks for fine wood, after every stated axis is built, so the stated
	 * wood stands as it did. Points are spread evenly over the patch's surface, and one is kept
	 * where the surface is the crown's own: not inside another patch, and not under the lower
	 * boundary. A socket stands a piece's reach inside each kept point, and more stand on smaller
	 * shells deeper in, more thinly the deeper they are. Twigs then grow from the
	 * wood under the patch toward the sockets by space colonisation: in each round every socket
	 * not yet reached pulls the twig end nearest it, each pulled end grows one piece toward the
	 * sockets that pull it, and a socket within one piece of an end is reached by a last piece. A
	 * piece that would stand against other wood is not grown. Each socket takes the place of the
	 * patch as a small patch of its own, the size of the piece it carries.
	 *
	 * @returns The plan's patches: those with no fine wood as they were, and the sockets' own.
	 */
	const fillMasses = (): FramePatch[] => {
		const out: FramePatch[] = [];
		const tip = RADIUS_LEAST * scale;
		const clear = FILL_CLEAR * scale;
		/** A socket's patch: the piece it carries, lying out along the wood's last run. */
		const spray = (
			axis: number,
			at: Readonly<Vector3>,
			run: Readonly<Vector3>,
			fill: { readonly pitch: number; readonly reach: number },
		): FramePatch => {
			const rise = Math.abs(run[1]);
			let depth = (fill.pitch / 3) * (1 - rise) + fill.reach * rise;
			const centre: Vector3 = [
				at[0] + (run[0] * fill.reach) / 2,
				at[1] + (run[1] * fill.reach) / 2,
				at[2] + (run[2] * fill.reach) / 2,
			];
			// A piece that would dip under the lower boundary is drawn in to it.
			const under = outlineUnder(spec, scale, centre[0], centre[2]);
			if (centre[1] - depth / 2 < under) {
				const over = Math.max(centre[1] + depth / 2, under + tip);
				depth = over - under;
				centre[1] = (over + under) / 2;
			}
			const flat = Math.sqrt(run[0] * run[0] + run[2] * run[2]);
			return {
				kind: 'spray',
				axis,
				centre,
				begins: Math.max(
					0,
					Math.sqrt(centre[0] * centre[0] + centre[2] * centre[2]) - fill.pitch / 2,
				),
				width: fill.pitch,
				depth,
				along: flat > 0.2 ? [run[0] / flat, 0, run[2] / flat] : [1, 0, 0],
			};
		};
		patches.forEach((mass, index) => {
			const fill = mass.fill;
			if (!fill) {
				out.push(mass);
				return;
			}
			const main = axes[mass.axis] as Built;
			const patchAxis = (axis: number): boolean => axis === mass.axis;
			const a = mass.width / 2;
			const b = mass.depth / 2;
			const [cx, cy, cz] = mass.centre;
			const step = fill.pitch * FILL_STEP;
			const inset = fill.reach * FILL_INSET;
			const innerA = Math.max(a - inset, a * 0.3);
			const innerB = Math.max(b - inset, b * 0.3);
			// The surface of the patch's rounded body, near enough, over one piece's footprint.
			const count = Math.max(
				1,
				Math.round((4 * PI * (a * a + 2 * a * b)) / 3 / (fill.pitch * fill.pitch)),
			);
			const turn = draw(Purpose.Fill, mass.axis) * 2 * PI;
			/** Whether a point stands inside another patch, which fills that place itself. */
			const owned = (point: Readonly<Vector3>): boolean => {
				for (let m = 0; m < patches.length; m++) {
					if (m === index) continue;
					const other = patches[m] as Mass;
					const ox = (point[0] - other.centre[0]) / (other.width / 2);
					const oy = (point[1] - other.centre[1]) / (other.depth / 2);
					const oz = (point[2] - other.centre[2]) / (other.width / 2);
					if (ox * ox + oy * oy + oz * oz < FILL_INSIDE * FILL_INSIDE) return true;
				}
				return false;
			};
			// The sockets stand on shells through the patch's depth: the outermost a piece's reach
			// inside its surface, where a surface point the patch owns gives one, and each deeper shell
			// smaller and more thinly set, so the patch is clothed through and not only at its rim.
			const goals: Vector3[] = [];
			FILL_SHELLS.forEach(([size, keep], shell) => {
				const shellA = innerA * size;
				const shellB = innerB * size;
				const many = Math.round(count * size * size * keep);
				for (let k = 0; k < many; k++) {
					const y = 1 - (2 * (k + 0.5)) / many;
					const ring = Math.sqrt(1 - y * y);
					const angle = turn + shell * radians(GOLDEN / 3) + k * radians(GOLDEN);
					const dx = ring * cos(angle);
					const dz = ring * sin(angle);
					const point: Vector3 = [cx + shellA * dx, cy + shellB * y, cz + shellA * dz];
					// The outermost shell answers for the surface over it; a deeper one for its own place.
					const outer: Vector3 = shell === 0 ? [cx + a * dx, cy + b * y, cz + a * dz] : point;
					const low = Math.min(outer[1], point[1]) - fill.pitch / 6;
					if (
						low < outlineUnder(spec, scale, outer[0], outer[2]) ||
						low < outlineUnder(spec, scale, point[0], point[2])
					)
						continue;
					if (!owned(outer)) goals.push(point);
				}
			});

			const tree: Sprout[] = [];
			const last = main.nodes.length - 1;
			// The thickest a twig of this patch can be, which each piece is held clear at.
			let stout = tip;
			main.nodes.forEach((node, k) => {
				const nx = (node.x - cx) / a;
				const ny = (node.y - cy) / b;
				const nz = (node.z - cz) / a;
				if (k !== last && nx * nx + ny * ny + nz * nz >= 1) return;
				tree.push({ at: [node.x, node.y, node.z], from: -1, seed: k, socket: false });
				stout = Math.max(stout, Math.min(node.radius * FILL_SHARE, tip * FILL_STOUT));
			});
			/**
			 * Whether a piece grown from a node would pass through a piece of this patch's twigs
			 * already grown, each read as a straight run. The pieces that meet at the node it grows
			 * from stand beside it there and are left out.
			 */
			const crosses = (from: number, at: Readonly<Vector3>, radius: number): boolean => {
				const start = (tree[from] as Sprout).at;
				for (let k = 0; k < tree.length; k++) {
					const sprout = tree[k] as Sprout;
					if (sprout.from < 0 || sprout.from === from || k === from) continue;
					const other = (tree[sprout.from] as Sprout).at;
					if (runsApart(start, at, other, sprout.at) < radius + stout + clear) return true;
				}
				return false;
			};
			let open = goals;
			for (let round = 0; round < FILL_ROUNDS && open.length > 0; round++) {
				const pulls = new Map<number, Vector3>();
				const still: Vector3[] = [];
				const grown = tree.length;
				for (const goal of open) {
					let nearest = -1;
					let least = Number.POSITIVE_INFINITY;
					for (let k = 0; k < grown; k++) {
						const sprout = tree[k] as Sprout;
						if (sprout.socket) continue;
						const dx = goal[0] - sprout.at[0];
						const dy = goal[1] - sprout.at[1];
						const dz = goal[2] - sprout.at[2];
						const away = Math.sqrt(dx * dx + dy * dy + dz * dz);
						if (away < least) {
							least = away;
							nearest = k;
						}
					}
					if (nearest < 0) continue;
					if (least <= step) {
						const reached = (tree[nearest] as Sprout).at;
						// A piece whose middle would stand under the lower boundary is dropped with its
						// twig; one that only dips under it is drawn in to it.
						const length = Math.max(1e-9, least);
						const middle: Vector3 = [
							goal[0] + ((goal[0] - reached[0]) / length) * (fill.reach / 2),
							goal[1] + ((goal[1] - reached[1]) / length) * (fill.reach / 2),
							goal[2] + ((goal[2] - reached[2]) / length) * (fill.reach / 2),
						];
						if (middle[1] < outlineUnder(spec, scale, middle[0], middle[2])) continue;
						if (
							gapAt(reached, goal, tip, patchAxis, clear) >= clear &&
							!crosses(nearest, goal, tip)
						)
							tree.push({ at: goal, from: nearest, seed: -1, socket: true });
						continue;
					}
					const from = (tree[nearest] as Sprout).at;
					const pull = pulls.get(nearest) ?? [0, 0, 0];
					pull[0] += (goal[0] - from[0]) / least;
					pull[1] += (goal[1] - from[1]) / least;
					pull[2] += (goal[2] - from[2]) / least;
					pulls.set(nearest, pull);
					still.push(goal);
				}
				let grew = false;
				for (const [k, pull] of pulls) {
					const size = Math.sqrt(pull[0] * pull[0] + pull[1] * pull[1] + pull[2] * pull[2]);
					if (size < 1e-6) continue;
					const from = (tree[k] as Sprout).at;
					const at: Vector3 = [
						from[0] + (pull[0] / size) * step,
						from[1] + (pull[1] / size) * step,
						from[2] + (pull[2] / size) * step,
					];
					if (gapAt(from, at, stout, patchAxis, clear) < clear || crosses(k, at, stout)) continue;
					tree.push({ at, from: k, seed: -1, socket: false });
					grew = true;
				}
				open = still;
				if (!grew) break;
			}

			// The sockets each node feeds; a node that feeds none is no wood.
			const feeds = tree.map((sprout): number => (sprout.socket ? 1 : 0));
			for (let k = tree.length - 1; k >= 0; k--) {
				const from = (tree[k] as Sprout).from;
				if (from >= 0) feeds[from] = (feeds[from] as number) + (feeds[k] as number);
			}
			const kids: number[][] = tree.map(() => []);
			tree.forEach((sprout, k) => {
				if (sprout.from >= 0 && (feeds[k] as number) > 0) (kids[sprout.from] as number[]).push(k);
			});
			for (const list of kids)
				list.sort((p, q) => (feeds[q] as number) - (feeds[p] as number) || p - q);

			// The patch's own axis ends in a socket, as every twig does.
			const end = main.nodes[last] as FrameNode;
			const before = (main.nodes[last - 1] ?? axes[main.parent]?.nodes[main.parentNode]) as
				| FrameNode
				| undefined;
			out.push(
				spray(
					mass.axis,
					[end.x, end.y, end.z],
					before ? unit(end.x - before.x, end.y - before.y, end.z - before.z) : [0, 1, 0],
					fill,
				),
			);

			// Each twig is a run of nodes that follows the heaviest way on; the others leave it.
			const starts: { first: number; parent: number; node: number; from: FrameNode }[] = [];
			tree.forEach((sprout, k) => {
				if (sprout.seed < 0) return;
				for (const kid of kids[k] as number[])
					starts.push({
						first: kid,
						parent: mass.axis,
						node: sprout.seed,
						from: main.nodes[sprout.seed] as FrameNode,
					});
			});
			for (let next = 0; next < starts.length; next++) {
				const { first, parent, node, from } = starts[next] as (typeof starts)[number];
				const id = axes.length;
				const cap = Math.min(from.radius * FILL_SHARE, tip * FILL_STOUT);
				const run: number[] = [first];
				for (let at = first; (kids[at] as number[]).length > 0; ) {
					at = (kids[at] as number[])[0] as number;
					run.push(at);
				}
				const nodes: FrameNode[] = run.map((k) => {
					const at = (tree[k] as Sprout).at;
					const radius = Math.max(tip, Math.min(cap, tip * Math.sqrt(feeds[k] as number)));
					return { x: at[0], y: at[1], z: at[2], radius };
				});
				const lengths: number[] = [];
				let length = 0;
				nodes.forEach((point, k) => {
					const prior = k === 0 ? from : (nodes[k - 1] as FrameNode);
					const dx = point.x - prior.x;
					const dy = point.y - prior.y;
					const dz = point.z - prior.z;
					length += Math.sqrt(dx * dx + dy * dy + dz * dz);
					lengths.push(length);
				});
				const head = nodes[0] as FrameNode;
				axes.push({
					rule: 'twig',
					role: 'branch',
					order: (axes[parent] as Built).order + 1,
					parent,
					parentNode: node,
					index: next,
					place: 0,
					azimuth: (atan2(head.z - from.z, head.x - from.x) * 180) / PI,
					length,
					base: head.radius,
					nodes,
					along: lengths.map((at) => at / Math.max(1e-9, length)),
				});
				run.forEach((k, at) => {
					const rest = (kids[k] as number[]).slice(1);
					for (const kid of rest)
						starts.push({ first: kid, parent: id, node: at, from: nodes[at] as FrameNode });
				});
				const socket = nodes[nodes.length - 1] as FrameNode;
				const prior = (nodes[nodes.length - 2] ?? from) as FrameNode;
				out.push(
					spray(
						id,
						[socket.x, socket.y, socket.z],
						unit(socket.x - prior.x, socket.y - prior.y, socket.z - prior.z),
						fill,
					),
				);
				nodes.forEach((point, k) => {
					const prior = k > 0 ? (nodes[k - 1] as FrameNode) : from;
					addWood({
						from: [prior.x, prior.y, prior.z],
						at: [point.x, point.y, point.z],
						radius: point.radius,
						axis: id,
					});
				});
			}
		});
		return out;
	};

	const clothed = fillMasses();

	let top = 0;
	let crownBase = Number.POSITIVE_INFINITY;
	for (const axis of axes) for (const node of axis.nodes) top = Math.max(top, node.y);
	for (const patch of clothed) {
		top = Math.max(top, patch.centre[1] + patch.depth / 2);
		crownBase = Math.min(crownBase, patch.centre[1] - patch.depth / 2);
	}
	return {
		height: top,
		scale,
		axes,
		patches: clothed,
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
 * A socket of a frame: a place on its wood that carries foliage.
 *
 * @category api/vegetation
 */
export interface FrameSocket {
	/** The patch it carries the foliage of, by its index in the plan: the socket's mass. */
	readonly patch: number;
	/** The axis it stands on, by its index in the plan. */
	readonly axis: number;
	/** The node of that axis it hangs from, and the share of the axis's length it stands at. */
	readonly node: number;
	readonly along: number;
	/** Where it stands, in metres. */
	readonly at: Vector3;
	/** The way its piece grows, a unit vector: along the wood at the wood's end, out from it elsewhere. */
	readonly heading: Vector3;
	/**
	 * Its rank across the whole plant, from 0: the sockets below any rank stand spread through the
	 * crown, so a plant thinned to a rank keeps its outline.
	 */
	readonly rank: number;
}

/** The share of an axis's length, from its end, that sockets along the wood may run back over. */
const SOCKETS_BACK = 0.8;
/** The degrees to each side of the wood's upper side that a socket along the wood may stand at. */
const SOCKETS_ROUND = 110;

/**
 * The sockets of a frame: one at the end of each axis that carries a patch, and, where the patch
 * states them, more along the wood under it, each standing out from the wood and turned on round
 * it from the last. All are ranked once across the plant.
 *
 * @param plan The frame.
 * @returns The sockets, patch by patch, each patch's end socket first.
 * @category api/vegetation
 */
export function frameSockets(plan: FramePlan): FrameSocket[] {
	const found: Omit<FrameSocket, 'rank'>[] = [];
	plan.patches.forEach((patch, index) => {
		const axis = plan.axes[patch.axis] as FrameAxis;
		const last = axis.nodes.length - 1;
		const end = axis.nodes[last] as FrameNode;
		const from =
			last > 0
				? (axis.nodes[last - 1] as FrameNode)
				: ((plan.axes[axis.parent]?.nodes[axis.parentNode] as FrameNode | undefined) ?? end);
		found.push({
			patch: index,
			axis: patch.axis,
			node: last,
			along: 1,
			at: [end.x, end.y, end.z],
			heading: unit(end.x - from.x, end.y - from.y, end.z - from.z),
		});
		const rule = patch.sockets;
		if (!rule || last < 1 || !(rule.every > 0)) return;
		// A patch that clothes its axis takes sockets over the whole run it clothes; any other, back
		// from the axis's end for half its width.
		const back =
			patch.clothes === undefined
				? Math.min(patch.width / 2, axis.length * SOCKETS_BACK)
				: axis.length * (1 - patch.clothes);
		let node = last - 1;
		for (let k = 1; k * rule.every <= back; k++) {
			const share = 1 - (k * rule.every) / axis.length;
			while (node > 0 && (axis.along[node] as number) > share) node--;
			const a = axis.nodes[node] as FrameNode;
			const b = axis.nodes[node + 1] as FrameNode;
			const span = (axis.along[node + 1] as number) - (axis.along[node] as number);
			const t = span > 0 ? (share - (axis.along[node] as number)) / span : 0;
			const line = unit(b.x - a.x, b.y - a.y, b.z - a.z);
			// The wood's upper side, square to its line, and the level direction square to both. A
			// plumb axis has no upper side, and its sockets stand all round it.
			const plumb = Math.abs(line[1]) > PLUMB_NEAR;
			const up = plumb
				? unit(1 - line[0] * line[0], -line[0] * line[1], -line[0] * line[2])
				: unit(-line[1] * line[0], 1 - line[1] * line[1], -line[1] * line[2]);
			const side: Vector3 = [
				line[1] * up[2] - line[2] * up[1],
				line[2] * up[0] - line[0] * up[2],
				line[0] * up[1] - line[1] * up[0],
			];
			// Each is turned on from the last by the golden angle, folded onto the arc it may stand in.
			const turned = (((index + k) * GOLDEN) % 360) / 360;
			const round = radians(plumb ? turned * 360 : (turned * 2 - 1) * SOCKETS_ROUND);
			const out: Vector3 = [
				up[0] * cos(round) + side[0] * sin(round),
				up[1] * cos(round) + side[1] * sin(round),
				up[2] * cos(round) + side[2] * sin(round),
			];
			const lean = radians(rule.angle);
			const radius = a.radius + (b.radius - a.radius) * t;
			found.push({
				patch: index,
				axis: patch.axis,
				node,
				along: share,
				at: [
					a.x + (b.x - a.x) * t + out[0] * radius,
					a.y + (b.y - a.y) * t + out[1] * radius,
					a.z + (b.z - a.z) * t + out[2] * radius,
				],
				heading: unit(
					line[0] * cos(lean) + out[0] * sin(lean),
					line[1] * cos(lean) + out[1] * sin(lean),
					line[2] * cos(lean) + out[2] * sin(lean),
				),
			});
		}
	});
	const ranks = thinningRanks(found.map((socket) => socket.at));
	return found.map((socket, k) => ({ ...socket, rank: ranks[k] as number }));
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
	// Shoot rows grow with the plant; a branch piece is the size its leaves make it.
	const scale =
		growth.sockets.piece === undefined
			? plan.scale / Math.max(1e-6, spreadMean(input.record.size.height))
			: 1;
	const frame = new Float32Array(4);
	const spin = new Float32Array(4);
	// Each piece's roll and tilt are its socket's place in two evenly spread runs of shares, each
	// started at the plant's own draw.
	const turn = growth.sockets.turn;
	const seed = input.seed >>> 0;
	const salt = input.record.seedSalt >>> 0;
	const rollFrom = unitAt(seed, salt, input.variant, Purpose.Turn, 0);
	const tiltFrom = unitAt(seed, salt, input.variant, Purpose.Turn, 1);
	frameSockets(plan).forEach((socket, k) => {
		const wood = written[socket.axis] as Written;
		quatFromFrame(
			socket.heading,
			Math.abs(socket.heading[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0],
			frame,
		);
		if (turn) {
			const share = (from: number, step: number): number => ((from + k * step) % 1) * 2 - 1;
			quatAxisAngle([0, 1, 0], radians(share(rollFrom, SPREAD_ROLL) * turn.roll), spin);
			quatMultiply(frame, 0, spin, 0, frame);
			quatAxisAngle([1, 0, 0], radians(share(tiltFrom, SPREAD_TILT) * turn.tilt), spin);
			quatMultiply(frame, 0, spin, 0, frame);
		}
		builder.addBud({
			node: wood.nodes[socket.node] as number,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: wood.axis,
			woodRadius: ((plan.axes[socket.axis] as FrameAxis).nodes[socket.node] as FrameNode).radius,
			socket: { scale, rank: socket.rank, lobe: socket.patch },
		});
	});
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
