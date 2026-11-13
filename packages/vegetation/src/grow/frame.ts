// The directed frame: a plant's wood laid in a stated order from measured figures. A species states
// its stems and, under each, the axes that leave it: how many, where along the parent, how they
// stand round it, the angle they leave at, the way they bend, how long they run and how thick they
// are beside the wood they leave. Nothing is grown and cut back. Every axis is a row of arches
// joined where their tangents match, so a limb bends gently and never runs dead straight, and each
// axis thins evenly from the measured share of its parent's radius.
//
// `planFrame` gives the frame as plain data with the foliage patches beside it, which the foliage's
// sockets are set from; `frameSkeleton` writes the same frame into a skeleton.
import { archPath } from '../core/arch';
import { AXIS_LIMB, AXIS_STEM, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { acos, asin, atan2, cos, PI, radians, sin, tan, type Vector3 } from '../core/math';
import { type Curve, curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';

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
	/** Degrees each arch of the course turns sideways, to one side and the other in turn. */
	readonly sway: number;
	/** The arches the course is made of: the sway's turns. */
	readonly elbows: number;
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
	 * it, in opposite pairs each crossed on the last, or to one side and the other in turn.
	 */
	readonly around: 'spiral' | 'ring' | 'opposite' | 'sides';
	/** Degrees round the parent where the first one stands. Left out, each parent draws its own. */
	readonly first?: number;
	/**
	 * Degrees the two sides are raised toward the parent's sky side when they stand to one side and
	 * the other: 0 leaves them level with the parent, 90 puts every one on its sky side, and a
	 * negative figure lowers them toward its ground side.
	 */
	readonly lift?: number;
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
 * A plant's directed frame as a species states it.
 *
 * @category api/vegetation
 */
export interface FrameSpec {
	/** The crown's radius on its wide side as a share of the height, by the share of the height. */
	readonly outline: Curve;
	/** The crown's narrow side as a share of its wide side, and the degrees its wide side lies at. */
	readonly plan: { readonly narrow: number; readonly turn: number };
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
 * The crown outline's radius in metres at a height and a direction round the plant: the species'
 * wide-side radius, drawn in across the plan's wide side to the plan's narrow share.
 *
 * @param spec The frame.
 * @param scale The plant's height in metres.
 * @param y The height in metres.
 * @param azimuth Radians round the plant.
 * @returns The radius in metres.
 * @category api/vegetation
 */
export function outlineRadius(spec: FrameSpec, scale: number, y: number, azimuth: number): number {
	// Above the outline's last stated height there is no crown.
	const last = typeof spec.outline === 'number' ? undefined : spec.outline[spec.outline.length - 1];
	if (last && y / scale > last[0]) return 0;
	const wide = curveAt(spec.outline, y / scale) * scale;
	const off = azimuth - radians(spec.plan.turn);
	const narrow = clamp(spec.plan.narrow, 0.5, 1);
	// An ellipse's radius toward a direction, its long half-axis 1 and its short one the narrow share.
	const c = cos(off);
	const s = sin(off) / narrow;
	return wide / Math.sqrt(c * c + s * s);
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
	// The height of the crown's widest row, in metres: the middle the outline is drawn in toward.
	let middle = scale / 2;
	if (typeof spec.outline !== 'number') {
		let widest = Number.NEGATIVE_INFINITY;
		for (const [at, radius] of spec.outline)
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

		// The course's lift at each share of its length, from the bends in order.
		const lifts: [number, number][] = [[0, lift0]];
		let lift = lift0;
		for (const bend of rule.bends ?? []) {
			const from = clamp(bend.from, 0, 1);
			const to = clamp(bend.to, from, 1);
			if (from > (lifts[lifts.length - 1] as [number, number])[0]) lifts.push([from, lift]);
			lift =
				bend.level !== undefined ? curveAt(bend.level, place) : lift - curveAt(bend.by ?? 0, place);
			lift = clamp(lift, -90, 90);
			lifts.push([Math.max(to, from + 1e-6), lift]);
		}
		// The sideways sway: the course leans to one side and the other in turn, once an elbow, and
		// leaves in its own direction. The first lean is reached half an elbow along, so every
		// stretch between two leans turns the whole way across, and the course ends half way to
		// the lean that would follow, so its last stretch turns too.
		const elbows = Math.max(1, Math.round(rule.elbows));
		const sways: [number, number][] = [[0, 0]];
		let side = draw(Purpose.SwaySide, id) < 0.5 ? 1 : -1;
		let lean = 0;
		for (let k = 0; k <= elbows; k++) {
			const next = side * (rule.sway / 2) * (0.7 + 0.6 * draw(Purpose.Sway, id, k));
			if (k < elbows) sways.push([(k + 0.5) / elbows, next]);
			else sways.push([1, (lean + next) / 2]);
			lean = next;
			side = -side;
		}
		const across: Vector3 = [-sin(heading), 0, cos(heading)];
		const tangent = (share: number): Vector3 => {
			const base = direction(radians(curveAt(lifts, share)), heading);
			const off = tan(radians(curveAt(sways, share)));
			return unit(base[0] + across[0] * off, base[1], base[2] + across[2] * off);
		};

		// The length: stated, or found so that the tip stands where the rule says.
		const lengthRule = rule.length;
		let length: number;
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
				const middle = (low + high) / 2;
				const over = falls ? -past(middle) : past(middle);
				if (over < 0) low = middle;
				else high = middle;
			}
			length = (low + high) / 2;
		}
		if (rule.vary) length *= 1 + (draw(Purpose.Vary, id) * 2 - 1) * rule.vary;
		if (rule.most !== undefined) length = Math.min(length, curveAt(rule.most, place) * scale);
		if (rule.least !== undefined) length = Math.max(length, curveAt(rule.least, place) * scale);
		length = Math.max(length, 0.01 * scale);

		// Where each child leaves, as shares of this axis's length.
		interface Seat {
			readonly rule: FrameBranchRule;
			readonly index: number;
			readonly count: number;
			readonly share: number;
		}
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

		const stem = role === 'stem' ? (rule as FrameStemRule) : undefined;
		// A stem is also cut where its width is stated, so its foot's flare keeps its shape.
		const widths =
			stem && typeof stem.width !== 'number'
				? stem.width.map((knot) => (knot[0] * scale) / length).filter((share) => share < 1)
				: [];
		const knots = [...lifts.map((knot) => knot[0]), ...sways.map((knot) => knot[0]), ...widths];
		const laid = lay(
			start,
			tangent,
			length,
			knots,
			seats.map((seat) => seat.share),
		);
		const taper = stem ? 1 : clamp((rule as FrameBranchRule).taper, 0.02, 1);
		const radiusAt = (share: number): number =>
			Math.max(
				RADIUS_LEAST,
				stem
					? (curveAt(stem.width, (share * length) / scale) * scale) / 2
					: baseRadius * (1 - (1 - taper) * share),
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
			if (patch.along === undefined) centre = [end.x, end.y + (patch.offset ?? 0) * depth, end.z];
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
			if (child.around === 'spiral') round = phase + seat.index * GOLDEN;
			else if (child.around === 'ring') round = phase + (seat.index * 360) / seat.count;
			else if (child.around === 'opposite')
				round = phase + Math.floor(seat.index / 2) * 90 + (seat.index % 2) * 180;
			else
				round =
					(seat.index % 2 === 0 ? 1 : -1) * (sides.get(child) as number) * (90 - (child.lift ?? 0));
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

/**
 * Writes a frame's axes into a skeleton. The foliage patches stay in the plan.
 *
 * @param plan The frame.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function frameSkeleton(plan: FramePlan): MacroSkeleton {
	const builder = new SkeletonBuilder();
	const ageAt = (y: number): number =>
		Math.round(clamp((plan.height - y) / Math.max(1, plan.height), 0, 1) * AGE_MOST);
	/** Each axis's skeleton index, its nodes' skeleton indices and the metres along it to each. */
	const written: { axis: number; nodes: number[]; runs: number[] }[] = [];
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
	return builder.finish(plan.crownBase);
}
