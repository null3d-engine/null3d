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
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { acos, atan2, cos, PI, quatFromFrame, radians, sin, tan, type Vector3 } from '../core/math';
import type { Conifer, Species } from '../core/record';
import { type Curve, curveAt, spreadAt, spreadMean } from '../core/types';
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
/**
 * The most of its limb's reach that a patch takes, so the limb's inner part stays bare, and the most
 * that a top limb's patch takes.
 */
const PATCH_MOST = 0.45;
const PATCH_MOST_TOP = 0.8;
/** The most of its reach that the leader's patch takes: it stands over the trunk's line and past it. */
const PATCH_MOST_LEADER = 1.5;
/** How much shorter the last top limb's reach is than the first's, as a share of it. */
const TOP_SHORTER = 0.2;
/** Passes that find the crown's stretch across its plan. */
const PLAN_PASSES = 6;
/** How much lower each further top limb's patch stands, as a share of its own depth. */
const TOP_STEP = 0.45;
/** The share of its patch's width that a limb runs on under it, and that an arm reaches. */
const UNDER_PATCH = 0.92;
const ARM_REACH = 0.4;
/**
 * Where a limb carries a patch at each end: the share of its length, at its outer end, along which
 * its arms leave, and an arm's reach in patch widths, so the patches stand apart.
 */
const ARMS_OVER = 0.5;
const ARM_APART = 1.15;
/** The shares of a limb's run under its patch between which its arms leave. */
const ARMS_FROM = 0.1;
const ARMS_TO = 0.55;
/** The share of a patch's radius inside which an arm ends. */
const ARM_INSIDE = 0.95;
/** A limb's radius at its end over its radius where its patch begins. */
const LIMB_END = 0.35;
/** An arm's radius at its end over its radius where it leaves. */
const ARM_TAPER = 0.5;
/** The most degrees an arm runs above or below level, and the step it lowers by under the plant's height. */
const ARM_LIFT_MOST = 20;
const ARM_LIFT_STEP = 10;
/** The least share of its reach that a limb keeps where the plant's height cuts it short. */
const REACH_LEAST = 0.1;
/**
 * The share of its length that a piece reaches from its socket to the outside of its foliage, and
 * the least share of a patch's half width or depth that the dome of its sockets keeps.
 */
const PIECE_REACH = 0.85;
const SHELL_LEAST = 0.3;
/**
 * The share of its length that a piece standing up a closed shell reaches out from its socket: its
 * half depth and the lean of its tip.
 */
const SHELL_FACE = 0.2;
/** The heights a shell's outline is walked in, from its foot to its top. */
const SHELL_STEPS = 512;
/** The share of a spacing that a shell socket may stand off its row and off its place in the row. */
const SHELL_JITTER = 0.15;
/** The least degrees a shell piece leans off plumb, so its face always looks out or in. */
const SHELL_LEAN_LEAST = 2;
/**
 * The most degrees a shell piece leans off plumb: where the outline tucks in to the stem, its
 * pieces stand up the tuck rather than splay out along it.
 */
const SHELL_LEAN_MOST = 30;
/** The passes that find how far a limb runs to stand inside a shell. */
const SHELL_PASSES = 20;
/**
 * The least share of its own size that a shell piece shrinks to where the outline closes over it,
 * the share it shrinks by at each step, and the most steps.
 */
const SHELL_SIZE_LEAST = 0.3;
const SHELL_FIT_STEP = 0.85;
const SHELL_FIT_PASSES = 12;
/** The limb number under which a socket draws its piece, past every real limb's. */
const PIECE_DRAW = 4095;
/** The most degrees a piece's line swings from the way its patch faces, to one side or the other. */
const BOUGH_SWING = 35;
/** The least and the most size of a piece in a patch over the piece's own. */
const BOUGH_SIZE = [0.8, 1.2] as const;
/** The most degrees above level that a piece's wood arrives at, which leaves a piece room to turn up. */
const LIFT_MOST = 55;
/** The wood order of a twig that leaves a limb or an arm. */
const TWIG_ORDER = 3;
/** How many twigs deep the wood of a patch divides: a twig, and a twig that leaves it. */
const TWIG_ORDERS = 2;
/**
 * How much longer a twig counts for each unit that the way to its socket lies off the way the
 * piece leaves there, from none along it to two against it.
 */
const TWIG_ASIDE = 0.25;
/** The most degrees a twig arrives off the straight way from its foot to its socket. */
const TWIG_ARRIVE = 30;
/**
 * The most degrees the way to a socket lies off the way a twig arrives at its end, and off the
 * straight way from the twig's foot to its end, for the twig to run on to it.
 */
const TWIG_ON = 60;
const TWIG_LINE = 45;
/** The share of the turn bound at which a piece of a twig ends: its curve is walked in fine steps. */
const TWIG_TURN_SHARE = 0.9;
/** The longest piece of a twig in metres, and the distance under which a socket stands on its foot. */
const TWIG_STEP = 0.3;
const TWIG_NONE = 0.05;
/** The bands a patch's dome is measured in, and the turns round each band. */
const DOME_STEPS = 64;
const DOME_TURNS = 32;
/** The least distance between two sockets of one patch, as a share of the pitch. */
const SOCKET_APART = 0.7;
/** A twig's radius where it leaves over its parent's radius there, at most. */
const TWIG_FOOT = 0.6;
/** The limbs that stand one toward each side of the crown's plan. */
const GREAT_LIMBS = 4;
/** The sectors round the trunk that the foliage is balanced over, and the samples across one patch. */
const SECTORS = 16;
const SECTOR_SAMPLES = 8;
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
	TwigSide: 14,
	Wander: 7,
	TrunkPhase: 8,
	TrunkTurn: 9,
	TopTurn: 10,
	ShellTurn: 15,
	ShellPlace: 16,
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
	/** The limb it belongs to, by its index in the plan, or -1 for the patch on the trunk's tip. */
	readonly limb: number;
	/** The patch's middle in plant space, in metres. The limb ends under it. */
	readonly centre: Vector3;
	/** Metres from the trunk's line to the patch's near edge: the limb's wood is bare up to there. */
	readonly begins: number;
	/** The patch's length in metres along its limb. A round patch is as long as it is wide. */
	readonly length: number;
	/** The patch's width in metres across its limb. */
	readonly width: number;
	/** The patch's depth in metres, along plant +Y. */
	readonly depth: number;
	/**
	 * The metres its floor rises for each metre along its limb's direction, measured from its middle:
	 * none where the limb runs level or rises, and below none where the limb falls under it.
	 */
	readonly slope: number;
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
	/** The patch at its end, on a plant whose every end carries one. */
	readonly patch?: ConiferPatch;
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
 * A twig of the frame: a short curved branch inside a patch that ends in a socket.
 *
 * @category api/vegetation
 */
export interface ConiferTwig {
	/** The limb it belongs to, and the arm of that limb whose wood it grows from (-1 for the limb itself). */
	readonly limb: number;
	readonly arm: number;
	/** The twig it leaves, by its index in the plan's twigs, or -1 where it leaves the limb or the arm. */
	readonly twig: number;
	/** The node it leaves, of that twig, arm or limb. */
	readonly node: number;
	/** Its nodes from the first past its parent to its end. */
	readonly nodes: readonly ConiferNode[];
}

/**
 * A socket of the frame: a place on the wood that carries one piece of foliage.
 *
 * @category api/vegetation
 */
export interface ConiferSocket {
	/** The patch it fills, by its index in the plan's patches. */
	readonly patch: number;
	/**
	 * Its rank in the plant, from 0, with no rank repeated. The sockets below any rank stand spread
	 * through the crown: they are the same share of every patch and spread over each. The ends of
	 * the limbs and their arms take the lowest ranks, so a thinned plant keeps every end clothed.
	 */
	readonly rank: number;
	/** The size of its piece over the piece's own. */
	readonly scale: number;
	/** The wood it stands on: a twig by its index, or with no twig a limb and its arm (-1 for the limb). */
	readonly twig: number;
	readonly limb: number;
	readonly arm: number;
	/** The node of that wood it stands at, and the wood's radius there. */
	readonly node: number;
	readonly radius: number;
	/** Its place in plant space, and the level direction its wood runs in there. */
	readonly at: Vector3;
	readonly heading: Vector3;
	/** The piece it carries, by its place among the record's pieces, where the sockets name several. */
	readonly piece?: number;
}

/**
 * A conifer's frame: the trunk, the limbs and each limb's foliage patch.
 *
 * @category api/vegetation
 */
export interface ConiferPlan {
	/** The frame's height in metres: the top of its highest patch. */
	readonly height: number;
	/** The trunk's nodes from the ground up. */
	readonly trunk: readonly ConiferNode[];
	/** The limbs, level by level from the lowest, then the top limbs. */
	readonly limbs: readonly ConiferLimb[];
	/** Every foliage patch: each limb's, then each arm's where the arms carry their own. */
	readonly patches: readonly ConiferPatch[];
	/** The twigs under the patches, and the sockets on the twigs and on the ends of limbs and arms. */
	readonly twigs: readonly ConiferTwig[];
	readonly sockets: readonly ConiferSocket[];
	/** The limbs at each level, lowest first, without the top limbs. */
	readonly perLevel: readonly number[];
	/** The inner body's nodes from its foot up the trunk's line, where the record gives one. */
	readonly body: readonly ConiferNode[];
	/** The height of the lowest patch's underside in metres. */
	readonly crownBase: number;
}

/** The names of the pieces a conifer's sockets carry, as the record names them. */
function socketPieceNames(g: Conifer): readonly string[] {
	const piece = g.patch.sockets?.piece;
	return piece === undefined ? [] : typeof piece === 'string' ? [piece] : piece;
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

/** `size` less a piece's reach, and no less than a share of itself. */
function shellInside(size: number, reach: number): number {
	return Math.max(size - reach, size * SHELL_LEAST);
}

/** The lowest and highest shares of the height a curve names; a constant names the whole height. */
function curveBounds(curve: Curve): readonly [number, number] {
	if (typeof curve === 'number' || curve.length === 0) return [0, 1];
	return [
		(curve[0] as readonly [number, number])[0],
		(curve[curve.length - 1] as readonly [number, number])[0],
	];
}

/** A socket's place on a closed shell, before a limb takes it. */
interface ShellPlace {
	readonly at: Vector3;
	readonly heading: Vector3;
	readonly scale: number;
	/** Whether it stands in the shell's lowest or highest row, which a thinned plant keeps. */
	readonly end: boolean;
}

/** What a closed shell's sockets are laid from. */
interface ShellRule {
	/** The outline's metres from the trunk's line at a height in metres, toward a direction in radians. */
	readonly outline: (y: number, azimuth: number) => number;
	/** The trunk's line at a height in metres. */
	readonly lineAt: (y: number) => readonly [number, number];
	/** The metres of the outline's foot and top. */
	readonly from: number;
	readonly to: number;
	/** Metres between neighbours in a row, and between one row and the next up the outline. */
	readonly pitch: number;
	readonly rise: number;
	/** Degrees a piece leans out from the outline. */
	readonly lean: number;
	/** Metres a socket stands inside the outline, and a piece's own length in metres. */
	readonly inset: number;
	readonly length: number;
	/** Radians round the trunk where the lowest row's first socket stands. */
	readonly turn: number;
	/** A draw from 0 to 1 for a row and a place in it. */
	readonly draw: (row: number, place: number) => number;
}

/**
 * The sockets of a closed shell: rows a rise apart up the outline from its foot to its top, each
 * row as many sockets as its round holds at the pitch, each row turned on from the one below by
 * half its spacing, as bricks lie. Each socket stands its inset inside the outline, and its piece
 * stands up the outline there, leaning out from it, so its face looks out, and no longer than keeps
 * its tip inside the outline.
 */
function shellPlaces(rule: ShellRule): ShellPlace[] {
	const { outline, lineAt, from, to, pitch, rise, lean, inset, draw } = rule;
	if (!(to > from)) return [];
	// The outline's length up its wide side to each walked height, so the rows stand a rise apart
	// along it however steeply it narrows.
	const heights: number[] = [];
	const lengths: number[] = [0];
	for (let k = 0; k <= SHELL_STEPS; k++) heights.push(from + ((to - from) * k) / SHELL_STEPS);
	for (let k = 1; k <= SHELL_STEPS; k++) {
		const dy = (heights[k] as number) - (heights[k - 1] as number);
		const dr = outline(heights[k] as number, 0) - outline(heights[k - 1] as number, 0);
		lengths.push((lengths[k - 1] as number) + Math.sqrt(dy * dy + dr * dr));
	}
	const whole = lengths[SHELL_STEPS] as number;
	const heightAt = (s: number): number => {
		let k = 1;
		while (k < SHELL_STEPS && (lengths[k] as number) < s) k++;
		const a = lengths[k - 1] as number;
		const b = lengths[k] as number;
		const t = b > a ? clamp((s - a) / (b - a), 0, 1) : 0;
		return (heights[k - 1] as number) + ((heights[k] as number) - (heights[k - 1] as number)) * t;
	};
	const rows = Math.max(1, Math.round(whole / rise));
	const step = whole / rows;
	const slopeStep = (to - from) / SHELL_STEPS;
	const places: ShellPlace[] = [];
	let phase = rule.turn;
	for (let row = 0; row < rows; row++) {
		const y0 = heightAt((row + 0.5) * step);
		// The row's round: the mean of its wide and narrow sides' distances, less the inset.
		const round = 2 * PI * Math.max(0, (outline(y0, 0) + outline(y0, PI / 2)) / 2 - inset);
		const count = Math.max(1, Math.round(round / pitch));
		const spacing = (2 * PI) / count;
		if (row > 0) phase += spacing / 2;
		for (let j = 0; j < count; j++) {
			const azimuth = phase + (j + (draw(row, j * 2) * 2 - 1) * SHELL_JITTER) * spacing;
			const y = clamp(y0 + (draw(row, j * 2 + 1) * 2 - 1) * SHELL_JITTER * step, from, to);
			const reach = outline(y, azimuth);
			const out = Math.max(reach - inset, reach * SHELL_LEAST);
			const [lx, lz] = lineAt(y);
			const c = cos(azimuth);
			const n = sin(azimuth);
			// The outline's slope there, outward over upward, and the piece's lean out from it.
			const below = outline(clamp(y - slopeStep, from, to), azimuth);
			const above = outline(clamp(y + slopeStep, from, to), azimuth);
			const rising = Math.min(to, y + slopeStep) - Math.max(from, y - slopeStep);
			const slope = rising > 0 ? (above - below) / rising : 0;
			const off = clamp((atan2(slope, 1) * 180) / PI + lean, -SHELL_LEAN_MOST, SHELL_LEAN_MOST);
			const tilt = radians(Math.abs(off) < SHELL_LEAN_LEAST ? SHELL_LEAN_LEAST : off);
			// A piece is no longer than keeps its tip inside the outline, so where the outline closes
			// over the top its pieces shorten and the top stays round.
			let scale = BOUGH_SIZE[0] + (BOUGH_SIZE[1] - BOUGH_SIZE[0]) * draw(row + rows, j);
			for (let pass = 0; pass < SHELL_FIT_PASSES && scale > SHELL_SIZE_LEAST; pass++) {
				const reach = rule.length * scale;
				if (out + sin(tilt) * reach <= outline(y + cos(tilt) * reach, azimuth)) break;
				scale = Math.max(SHELL_SIZE_LEAST, scale * SHELL_FIT_STEP);
			}
			places.push({
				at: [lx + c * out, y, lz + n * out],
				heading: [sin(tilt) * c, cos(tilt), sin(tilt) * n],
				scale,
				end: row === 0 || row === rows - 1,
			});
		}
	}
	return places;
}

/**
 * A shell's places thinned into clumps: a centre stands wherever a place lies a clump's spacing from
 * every centre before it, and a place is kept only while it stands within the clump's radius of one
 * of them. The pieces then carry the shell in rounded masses with bare shell between them, as a
 * crown's clumps stand against its shade, and the crown's rim breaks into lobes.
 *
 * @param places The shell's places, its rows from the foot up.
 * @param clump The clump's spacing and radius in metres, or undefined to keep every place.
 * @returns The places the clumps keep.
 */
function clumpShell(
	places: readonly ShellPlace[],
	clump: { readonly spacing: number; readonly radius: number } | undefined,
): ShellPlace[] {
	if (!clump) return [...places];
	const spacing = Math.max(0.05, clump.spacing);
	const radius = Math.max(0.01, Math.min(clump.radius, spacing / 2));
	const apart = (a: Readonly<Vector3>, b: Readonly<Vector3>): number =>
		(a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
	const centres: Vector3[] = [];
	for (const place of places)
		if (centres.every((centre) => apart(centre, place.at) >= spacing * spacing))
			centres.push(place.at);
	const reach = radius * radius;
	return places.filter((place) => centres.some((centre) => apart(centre, place.at) <= reach));
}

/**
 * A dome cut into level bands of equal height from its rim up, and each band into equal turns: half
 * an ellipsoid whose floor reaches `long` one way and `wide` the other and whose top stands `tall`
 * above it. Each band holds its area up to each turn, the last being the band's whole area.
 */
function domeBands(long: number, wide: number, tall: number): number[][] {
	const bands: number[][] = [];
	for (let k = 0; k < DOME_STEPS; k++) {
		const t = (k + 0.5) / DOME_STEPS;
		const ring = 1 - t * t;
		const turns: number[] = [0];
		let sum = 0;
		for (let j = 0; j < DOME_TURNS; j++) {
			const turn = ((j + 0.5) / DOME_TURNS) * 2 * PI;
			const c = cos(turn);
			const d = sin(turn);
			sum +=
				(Math.sqrt(
					tall * tall * ring * (wide * wide * c * c + long * long * d * d) +
						long * long * wide * wide * t * t,
				) *
					2 *
					PI) /
				(DOME_TURNS * DOME_STEPS);
			turns.push(sum);
		}
		bands.push(turns);
	}
	return bands;
}

/** The area of a dome in square metres. */
function domeArea(long: number, wide: number, tall: number): number {
	return domeBands(long, wide, tall).reduce((sum, band) => sum + (band[DOME_TURNS] as number), 0);
}

/**
 * `count` places on a dome, the highest first, with the same area of the dome to each: each one's
 * height as a share of the dome's and its turn round the dome in radians, from the long way. Each
 * place turns on from the last by the golden angle, measured in the area of its own band, so the
 * places stand evenly on a dome that is longer than wide.
 */
function domePlaces(
	long: number,
	wide: number,
	tall: number,
	count: number,
	phase: number,
): { t: number; turn: number }[] {
	const bands = domeBands(long, wide, tall);
	const whole = bands.reduce((sum, band) => sum + (band[DOME_TURNS] as number), 0);
	const places: { t: number; turn: number }[] = [];
	let band = DOME_STEPS - 1;
	let above = 0;
	for (let i = 0; i < count; i++) {
		// The area that lies above this place.
		const want = ((i + 0.5) / count) * whole;
		while (band > 0 && above + ((bands[band] as number[])[DOME_TURNS] as number) < want) {
			above += (bands[band] as number[])[DOME_TURNS] as number;
			band--;
		}
		const turns = bands[band] as number[];
		const into = clamp((want - above) / (turns[DOME_TURNS] as number), 0, 1);
		const round = (((phase + (i * GOLDEN) / 360) % 1) + 1) % 1;
		const held = round * (turns[DOME_TURNS] as number);
		let j = 0;
		while (j < DOME_TURNS - 1 && (turns[j + 1] as number) < held) j++;
		const step = (turns[j + 1] as number) - (turns[j] as number);
		const within = step > 0 ? clamp((held - (turns[j] as number)) / step, 0, 1) : 0;
		places.push({
			t: (band + 1 - into) / DOME_STEPS,
			turn: ((j + within) / DOME_TURNS) * 2 * PI,
		});
	}
	return places;
}

/** A place on a patch's wood where a twig can leave, or where a twig can run on. */
interface Foot {
	readonly at: Vector3;
	/** The wood's radius there on the limb or an arm; a twig's is found once the patch is grown. */
	readonly radius: number;
	/** The twig it is a node of, or -1 on the limb or an arm, the arm, and the node. */
	readonly twig: number;
	readonly arm: number;
	readonly node: number;
	/** How many twigs lie between it and the limb or arm. */
	readonly depth: number;
	/** Whether a new twig may leave here. */
	readonly forks: boolean;
	/** On a twig's end, the way the twig arrives there, until the twig runs on. */
	runs?: Vector3;
	/** On a twig's end, the straight way from where the twig leaves to that end. */
	readonly line?: Vector3;
}

/** A twig's course as points past its foot, the way it arrives, and the metres to each point. */
interface TwigPath {
	readonly points: Vector3[];
	readonly along: number[];
	readonly length: number;
	readonly arrives: Vector3;
}

/**
 * One curved run of a twig from a foot to a socket. A new twig arrives the way the piece leaves,
 * or as near that way as a stated turn off the straight way allows. A twig that runs on from its
 * own end leaves the way it arrived there, so it has no corner. Either bends evenly on the way.
 * Its pieces end where it has turned by a share of the bound or run a full step. A socket on its
 * foot needs no twig.
 */
function twigPath(
	from: Readonly<Vector3>,
	to: Readonly<Vector3>,
	heading: Readonly<Vector3>,
	leave?: Readonly<Vector3>,
): TwigPath | undefined {
	const x = to[0] - from[0];
	const y = to[1] - from[1];
	const z = to[2] - from[2];
	const far = Math.sqrt(x * x + y * y + z * z);
	if (far < TWIG_NONE) return undefined;
	const straight: Vector3 = [x / far, y / far, z / far];
	// The way it arrives: the piece's own way, turned toward the straight way where it lies too far off.
	let arrives: Vector3 = [heading[0], heading[1], heading[2]];
	const off = between(straight, heading);
	if (off > TWIG_ARRIVE) {
		const whole = radians(off);
		const share = TWIG_ARRIVE / off;
		const span = sin(whole);
		if (span < 1e-3) arrives = straight;
		else {
			const a = sin((1 - share) * whole) / span;
			const b = sin(share * whole) / span;
			arrives = [
				straight[0] * a + heading[0] * b,
				straight[1] * a + heading[1] * b,
				straight[2] * a + heading[2] * b,
			];
		}
	}
	// A curve through one middle point: it stands back from the socket along the way a new twig
	// arrives, or forward from the foot along the way a twig runs on.
	const middle: Vector3 = leave
		? [
				from[0] + (leave[0] * far) / 2,
				from[1] + (leave[1] * far) / 2,
				from[2] + (leave[2] * far) / 2,
			]
		: [
				to[0] - (arrives[0] * far) / 2,
				to[1] - (arrives[1] * far) / 2,
				to[2] - (arrives[2] * far) / 2,
			];
	const wayAt = (s: number): Vector3 => {
		const wx = (1 - s) * (middle[0] - from[0]) + s * (to[0] - middle[0]);
		const wy = (1 - s) * (middle[1] - from[1]) + s * (to[1] - middle[1]);
		const wz = (1 - s) * (middle[2] - from[2]) + s * (to[2] - middle[2]);
		const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
		return w > 1e-9 ? [wx / w, wy / w, wz / w] : arrives;
	};
	const placeAt = (s: number): Vector3 => [
		(1 - s) * (1 - s) * from[0] + 2 * s * (1 - s) * middle[0] + s * s * to[0],
		(1 - s) * (1 - s) * from[1] + 2 * s * (1 - s) * middle[1] + s * s * to[1],
		(1 - s) * (1 - s) * from[2] + 2 * s * (1 - s) * middle[2] + s * s * to[2],
	];
	const steps = clamp(Math.ceil(between(wayAt(0), wayAt(1)) * 16), 16, FINE_MOST);
	const points: Vector3[] = [];
	const along: number[] = [];
	let length = 0;
	let since = 0;
	let held = wayAt(0);
	let before: Vector3 = [from[0], from[1], from[2]];
	for (let k = 1; k <= steps; k++) {
		const here = placeAt(k / steps);
		const run = Math.sqrt(
			(here[0] - before[0]) * (here[0] - before[0]) +
				(here[1] - before[1]) * (here[1] - before[1]) +
				(here[2] - before[2]) * (here[2] - before[2]),
		);
		length += run;
		since += run;
		before = here;
		const next = wayAt(Math.min(1, (k + 0.5) / steps));
		if (k === steps || since >= TWIG_STEP || between(held, next) >= TURN_MOST * TWIG_TURN_SHARE) {
			points.push(here);
			along.push(length);
			since = 0;
			held = next;
		}
	}
	return { points, along, length, arrives: wayAt(1) };
}

/**
 * The sockets of a frame and the twigs that carry them. A patch that every end carries holds one
 * socket, on its end. A patch that a limb's arms spread under is filled from its outside in: its
 * sockets stand evenly over a dome inside the patch's own, one to each square pitch, and each pulls
 * one curved twig from the nearest wood, the nearest socket first. Every twig ends in a socket, so
 * no wood ends bare. Each patch orders its sockets so that any first share of them is spread over
 * it, and the plant's one rank takes the same share of every patch. On a closed shell the sockets
 * are the shell's own places, each filled from the limb whose end stands nearest it, and the
 * limbs' ends, inside the shell, carry none.
 */
function socketsOf(
	record: Species,
	limbs: readonly ConiferLimb[],
	patches: readonly ConiferPatch[],
	trunk: readonly ConiferNode[],
	shell: readonly ShellPlace[],
	draw: (limb: number, carrier: number) => number,
): { twigs: ConiferTwig[]; sockets: ConiferSocket[] } {
	const g = growthOf(record);
	const twigs: ConiferTwig[] = [];
	const sockets: ConiferSocket[] = [];
	const rule = g.patch.sockets;
	if (!rule) return { twigs, sockets };
	const pitch = Math.max(0.05, rule.pitch);
	// A twig thins to the radius of the piece's own cut end.
	const names = socketPieceNames(g);
	const piece = record.pieces?.find((candidate) => candidate.name === names[0]);
	// Where the sockets name several pieces, each name's place among the record's pieces, which the
	// kit builds in that order.
	const choices =
		names.length > 1
			? names.map((name) => record.pieces?.findIndex((candidate) => candidate.name === name) ?? -1)
			: [];
	const tipRadius = piece?.stem.radius[0] ?? 0.01;
	const pieceReach = piece ? spreadMean(piece.stem.length) * PIECE_REACH : 0;
	const steepest = clamp(rule.lift, 0, LIFT_MOST);
	const filled = g.patch.each === 'limb';
	const onShell = g.patch.kind === 'shell';
	const byLimb: ShellPlace[][] = limbs.map(() => []);
	for (const place of shell) {
		let nearest = -1;
		let least = Number.POSITIVE_INFINITY;
		limbs.forEach((limb, l) => {
			const last = limb.nodes[limb.nodes.length - 1] as ConiferNode;
			const far =
				(last.x - place.at[0]) * (last.x - place.at[0]) +
				(last.y - place.at[1]) * (last.y - place.at[1]) +
				(last.z - place.at[2]) * (last.z - place.at[2]);
			if (far < least) {
				least = far;
				nearest = l;
			}
		});
		if (nearest >= 0) (byLimb[nearest] as ShellPlace[]).push(place);
	}
	/** One patch's sockets before their ranks: the ends first. */
	interface Draft extends Omit<ConiferSocket, 'rank' | 'patch'> {
		readonly end: boolean;
	}
	/** Each patch's sockets in the patch's own order, with how many of them are ends. */
	const ordered: { patch: number; drafts: Draft[]; ends: number }[] = [];
	// A patch's own order: the ends of its limb and arms first, then each next socket the one that
	// stands farthest from every socket before it, so any first share of the order is spread over
	// the whole patch.
	const rankInto = (patch: number, drafts: readonly Draft[]): void => {
		const chosen = drafts.filter((draft) => draft.end);
		const ends = chosen.length;
		const rest = drafts.filter((draft) => !draft.end);
		const apart = (a: Draft, b: Draft): number =>
			(a.at[0] - b.at[0]) * (a.at[0] - b.at[0]) +
			(a.at[1] - b.at[1]) * (a.at[1] - b.at[1]) +
			(a.at[2] - b.at[2]) * (a.at[2] - b.at[2]);
		const near = rest.map((draft) =>
			chosen.reduce(
				(least, other) => Math.min(least, apart(draft, other)),
				Number.POSITIVE_INFINITY,
			),
		);
		const left = rest.map((_, i) => i);
		while (left.length > 0) {
			let best = 0;
			for (let k = 1; k < left.length; k++)
				if ((near[left[k] as number] as number) > (near[left[best] as number] as number)) best = k;
			const [taken] = left.splice(best, 1) as [number];
			const draft = rest[taken] as Draft;
			chosen.push(draft);
			for (const other of left)
				near[other] = Math.min(near[other] as number, apart(rest[other] as Draft, draft));
		}
		ordered.push({ patch, drafts: chosen, ends });
	};
	const patchIndex = new Map<ConiferPatch, number>();
	patches.forEach((patch, i) => {
		patchIndex.set(patch, i);
	});
	// The patch on the trunk's tip carries one socket, on the tip. A shell's top rows close the top
	// themselves, so its leader carries none: a piece there would stand above them as a spire.
	patches.forEach((patch, i) => {
		if (patch.limb >= 0 || onShell) return;
		const tip = trunk[trunk.length - 1] as ConiferNode;
		rankInto(i, [
			{
				end: true,
				scale: 1,
				twig: -1,
				limb: -1,
				arm: -1,
				node: trunk.length - 1,
				radius: tip.radius,
				at: [tip.x, tip.y, tip.z],
				heading: [0, 1, 0],
			},
		]);
	});
	limbs.forEach((limb, l) => {
		/** The level direction a run of nodes takes into its node `i`. */
		const headingAt = (nodes: readonly ConiferNode[], i: number, from: ConiferNode): Vector3 => {
			const here = nodes[i] as ConiferNode;
			const before = i > 0 ? (nodes[i - 1] as ConiferNode) : from;
			const x = here.x - before.x;
			const z = here.z - before.z;
			const flat = Math.sqrt(x * x + z * z);
			return flat > 1e-6 ? [x / flat, 0, z / flat] : [1, 0, 0];
		};
		const endOf = (
			nodes: readonly ConiferNode[],
			arm: number,
			from: ConiferNode,
			up = false,
		): Draft => {
			const last = nodes[nodes.length - 1] as ConiferNode;
			const before = nodes.length > 1 ? (nodes[nodes.length - 2] as ConiferNode) : from;
			const heading: Vector3 = up
				? [last.x - before.x, last.y - before.y, last.z - before.z]
				: headingAt(nodes, nodes.length - 1, from);
			const length = Math.sqrt(
				heading[0] * heading[0] + heading[1] * heading[1] + heading[2] * heading[2],
			);
			return {
				end: true,
				scale: 1,
				twig: -1,
				limb: l,
				arm,
				node: nodes.length - 1,
				radius: last.radius,
				at: [last.x, last.y, last.z],
				heading:
					length > 1e-6
						? [heading[0] / length, heading[1] / length, heading[2] / length]
						: [0, 1, 0],
			};
		};
		const trunkFrom = trunk[limb.trunkNode] as ConiferNode;
		/** Wood whose nodes a patch's twigs may leave: the limb's own (-1) or an arm's. */
		interface Wood {
			readonly arm: number;
			readonly nodes: readonly ConiferNode[];
			/** Whether every node may carry a twig, or only those under the patch. */
			readonly whole: boolean;
		}
		/** Fills one patch with sockets, after the sockets it starts with, from the wood it names. */
		const fill = (patch: ConiferPatch, drafts: Draft[], woods: readonly Wood[]): void => {
			const { centre, width, length, depth, slope, along } = patch;
			/** A place's metres from the patch's middle along its limb and across it. */
			const laid = (x: number, z: number): [number, number] => [
				(x - centre[0]) * along[0] + (z - centre[2]) * along[2],
				(z - centre[2]) * along[0] - (x - centre[0]) * along[2],
			];
			/** The height of the patch's floor at a place. */
			const floorAt = (x: number, z: number): number =>
				centre[1] - depth / 2 + slope * laid(x, z)[0];
			/** A socket the dome or the shell asks for, before wood reaches it. */
			const wanted: { at: Vector3; heading: Vector3; scale: number; end: boolean }[] = [];
			const least = pitch * SOCKET_APART * (pitch * SOCKET_APART);
			const apart = (a: Readonly<Vector3>, b: Readonly<Vector3>): boolean =>
				(a[0] - b[0]) * (a[0] - b[0]) +
					(a[1] - b[1]) * (a[1] - b[1]) +
					(a[2] - b[2]) * (a[2] - b[2]) >=
				least;
			const clear = (at: Readonly<Vector3>): boolean =>
				drafts.every((draft) => apart(draft.at, at)) && wanted.every((want) => apart(want.at, at));
			if (onShell) {
				for (const place of byLimb[l] as ShellPlace[]) if (clear(place.at)) wanted.push(place);
			} else {
				// The patch is a dome on its floor: as long as the patch along its limb, as wide across
				// it, as deep at its middle. The pieces' tips stand on the dome, so their sockets stand on
				// a dome inside it, a piece's reach smaller.
				const long = shellInside(length / 2, pieceReach);
				const half = shellInside(width / 2, pieceReach);
				const tall = shellInside(depth, pieceReach);
				// One socket to each square pitch of the dome that passes midway through the pieces.
				const count = Math.max(
					1,
					Math.round(
						domeArea((length / 2 + long) / 2, (width / 2 + half) / 2, (depth + tall) / 2) /
							(pitch * pitch),
					),
				);
				const places = domePlaces(long, half, tall, count, draw(l, 63));
				for (let i = 0; i < places.length; i++) {
					const { t, turn } = places[i] as (typeof places)[number];
					const ring = Math.sqrt(Math.max(0, 1 - t * t));
					const u = long * ring * cos(turn);
					const v = half * ring * sin(turn);
					const x = centre[0] + along[0] * u - along[2] * v;
					const z = centre[2] + along[2] * u + along[0] * v;
					const at: Vector3 = [x, floorAt(x, z) + tall * t, z];
					if (!clear(at)) continue;
					// A piece leaves the dome the way the dome faces, no steeper than the record's lift, and
					// swung to one side or the other by its own share of the most, so neighbours do not stand
					// as a comb. Each piece takes its own size.
					const outU = (ring * cos(turn)) / long;
					const outV = (ring * sin(turn)) / half;
					const out = Math.sqrt(outU * outU + outV * outV);
					const faceUp = (atan2(t / tall, out) * 180) / PI;
					const lift = radians(Math.min(faceUp, steepest));
					// The level way the dome faces there, in the plant's space.
					const faces = atan2(along[2] * outU + along[0] * outV, along[0] * outU - along[2] * outV);
					const swing = radians(
						(draw(l * 64 + 1, 4096 + i) < 0.5 ? 1 : -1) *
							BOUGH_SWING *
							(0.3 + 0.7 * draw(l * 64 + 2, 4096 + i)),
					);
					wanted.push({
						at,
						heading: [cos(lift) * cos(faces + swing), sin(lift), cos(lift) * sin(faces + swing)],
						scale: BOUGH_SIZE[0] + (BOUGH_SIZE[1] - BOUGH_SIZE[0]) * draw(l * 64 + 3, 8192 + i),
						end: false,
					});
				}
			}
			// The wood a twig can leave: the limb's run under the patch and each arm, then each twig
			// that leaves them. A twig that leaves a twig carries no twig of its own.
			const inside = (node: ConiferNode): boolean => {
				const [u, v] = laid(node.x, node.z);
				return (u * u) / ((length / 2) * (length / 2)) + (v * v) / ((width / 2) * (width / 2)) <= 1;
			};
			const feet: Foot[] = [];
			for (const wood of woods)
				wood.nodes.forEach((node, i) => {
					if (wood.whole || inside(node))
						feet.push({
							at: [node.x, node.y, node.z],
							radius: node.radius,
							twig: -1,
							arm: wood.arm,
							node: i,
							depth: 0,
							forks: true,
						});
				});
			const own = woods[0];
			if (feet.length === 0 && own && own.nodes.length > 0) {
				const end = own.nodes.length - 1;
				const last = own.nodes[end] as ConiferNode;
				feet.push({
					at: [last.x, last.y, last.z],
					radius: last.radius,
					twig: -1,
					arm: own.arm,
					node: end,
					depth: 0,
					forks: true,
				});
			}
			// The way a piece leaves its socket: the way its twig arrives, held between level and the
			// record's lift, so a piece on a twig that comes down to it still turns up.
			const leaves = (arrives: Readonly<Vector3>, wanted: Readonly<Vector3>): Vector3 => {
				const flat = Math.sqrt(arrives[0] * arrives[0] + arrives[2] * arrives[2]);
				if (flat < 1e-4) return [wanted[0], wanted[1], wanted[2]];
				const lift = radians(clamp((atan2(arrives[1], flat) * 180) / PI, 0, steepest));
				return [(cos(lift) * arrives[0]) / flat, sin(lift), (cos(lift) * arrives[2]) / flat];
			};
			type Want = (typeof wanted)[number];
			/** The way from a foot to a wanted socket, a unit vector, and its length. */
			const wayTo = (foot: Foot, want: Want): { way: Vector3; far: number } => {
				const x = want.at[0] - foot.at[0];
				const y = want.at[1] - foot.at[1];
				const z = want.at[2] - foot.at[2];
				const far = Math.sqrt(x * x + y * y + z * z);
				return { way: far < 1e-6 ? [0, 1, 0] : [x / far, y / far, z / far], far };
			};
			/**
			 * Whether the twig that ends at a foot can run on to a wanted socket: without a sharp turn,
			 * and on outward along the line from where the twig leaves to its end, so a twig reaches
			 * out from its wood and does not wind over the patch.
			 */
			const runsOn = (foot: Foot, want: Want): boolean => {
				if (foot.runs === undefined || foot.line === undefined) return false;
				const { way } = wayTo(foot, want);
				return between(way, foot.runs) <= TWIG_ON && between(way, foot.line) <= TWIG_LINE;
			};
			// What a twig from a foot to a wanted socket costs: its length, and more the further the way
			// to the socket lies from the way the piece leaves, so wood runs on into its piece. A foot
			// that no new twig may leave serves only the twig that ends there.
			const costOf = (foot: Foot, want: Want): number => {
				if (!foot.forks && !runsOn(foot, want)) return Number.POSITIVE_INFINITY;
				const { way, far } = wayTo(foot, want);
				const along =
					way[0] * want.heading[0] + way[1] * want.heading[1] + way[2] * want.heading[2];
				return far * (1 + TWIG_ASIDE * (1 - along));
			};
			const bestOf = (want: Want, from = 0): { foot: number; cost: number } => {
				let foot = 0;
				let cost = Number.POSITIVE_INFINITY;
				for (let f = from; f < feet.length; f++) {
					const c = costOf(feet[f] as Foot, want);
					if (c < cost) {
						cost = c;
						foot = f;
					}
				}
				return { foot, cost };
			};
			const best = wanted.map((want) => bestOf(want));
			/** A twig as it grows: where it leaves, its nodes, the metres to each, and what stands on it. */
			interface Growing {
				readonly foot: Foot;
				readonly depth: number;
				readonly points: Vector3[];
				readonly along: number[];
				/** The drafts of the sockets on it, and the node each stands at. */
				readonly carries: { draft: number; node: number }[];
				/** The foot at its end, which runs on while the twig does. */
				end: Foot;
			}
			const growing: Growing[] = [];
			const first = twigs.length;
			// Each socket in turn, the cheapest first, pulls wood from its best foot: the twig that ends
			// there runs on to it where that needs no sharp turn, and a new twig leaves otherwise. So
			// the wood grows outward from the limb and its arms, and one twig carries several pieces.
			const left = wanted.map((_, i) => i);
			while (left.length > 0) {
				let pick = 0;
				for (let k = 1; k < left.length; k++)
					if (
						(best[left[k] as number] as (typeof best)[number]).cost <
						(best[left[pick] as number] as (typeof best)[number]).cost
					)
						pick = k;
				const w = left[pick] as number;
				const want = wanted[w] as Want;
				const held = best[w] as (typeof best)[number];
				const foot = feet[held.foot] as Foot;
				// A foot whose twig has run on since it was chosen is chosen again.
				if (costOf(foot, want) > held.cost + 1e-9) {
					best[w] = bestOf(want);
					continue;
				}
				left.splice(pick, 1);
				const on = runsOn(foot, want) ? (growing[foot.twig - first] as Growing) : undefined;
				const path = twigPath(foot.at, want.at, want.heading, on ? foot.runs : undefined);
				if (!path) {
					// The socket stands on the wood itself.
					drafts.push({
						end: want.end,
						scale: want.scale,
						twig: foot.twig,
						limb: l,
						arm: foot.arm,
						node: foot.node,
						radius: foot.radius,
						at: [foot.at[0], foot.at[1], foot.at[2]],
						heading: want.heading,
					});
					continue;
				}
				const twig = on ? foot.twig : first + growing.length;
				const grown: Growing =
					on ??
					({
						foot,
						depth: foot.depth + 1,
						points: [],
						along: [],
						carries: [],
						end: foot,
					} satisfies Growing);
				if (!on) growing.push(grown);
				const before = grown.along[grown.along.length - 1] ?? 0;
				const start = grown.points.length;
				for (let k = 0; k < path.points.length; k++) {
					grown.points.push(path.points[k] as Vector3);
					grown.along.push(before + (path.along[k] as number));
				}
				grown.carries.push({ draft: drafts.length, node: grown.points.length - 1 });
				drafts.push({
					end: want.end,
					scale: want.scale,
					twig,
					limb: l,
					arm: foot.arm,
					node: grown.points.length - 1,
					radius: tipRadius,
					at: [want.at[0], want.at[1], want.at[2]],
					// A piece on a shell stands up the shell however its twig arrives.
					heading: onShell ? want.heading : leaves(path.arrives, want.heading),
				});
				// The twig's old end no longer runs on; its new end does. Every new node below the
				// deepest order is a place a new twig may leave.
				if (on) grown.end.runs = undefined;
				const forks = grown.depth < TWIG_ORDERS;
				const from = feet.length;
				for (let k = start; k < grown.points.length; k++) {
					const last = k === grown.points.length - 1;
					if (!forks && !last) continue;
					const made: Foot = {
						at: grown.points[k] as Vector3,
						radius: 0,
						twig,
						arm: foot.arm,
						node: k,
						depth: grown.depth,
						forks,
						...(last ? { runs: path.arrives, line: wayTo(grown.foot, want).way } : {}),
					};
					feet.push(made);
					if (last) grown.end = made;
				}
				for (const other of left) {
					const now = bestOf(wanted[other] as Want, from);
					if (now.cost < (best[other] as (typeof best)[number]).cost) best[other] = now;
				}
			}
			// A twig is as thick at each place as the pieces it carries past there ask: a piece's own
			// stem for one, and the cross-sections add. It is no thicker than a share of the wood it
			// leaves. The twigs are taken last first, so each has its own twigs' loads.
			const loads = growing.map((grown) => new Array<number>(grown.points.length).fill(0));
			for (let g = growing.length - 1; g >= 0; g--) {
				const grown = growing[g] as Growing;
				const load = loads[g] as number[];
				for (const carried of grown.carries) (load[carried.node] as number) += 1;
				for (let k = load.length - 2; k >= 0; k--) (load[k] as number) += load[k + 1] as number;
				if (grown.foot.twig >= first)
					((loads[grown.foot.twig - first] as number[])[grown.foot.node] as number) +=
						load[0] as number;
			}
			const radii: number[][] = [];
			growing.forEach((grown, g) => {
				const parent =
					grown.foot.twig >= first
						? ((radii[grown.foot.twig - first] as number[])[grown.foot.node] as number)
						: grown.foot.radius;
				const most = Math.min(parent, Math.max(tipRadius, parent * TWIG_FOOT));
				const load = loads[g] as number[];
				radii.push(
					load.map((carried) => Math.min(most, tipRadius * Math.sqrt(Math.max(1, carried)))),
				);
			});
			growing.forEach((grown, g) => {
				const radius = radii[g] as number[];
				twigs.push({
					limb: l,
					arm: grown.foot.arm,
					twig: grown.foot.twig,
					node: grown.foot.node,
					nodes: grown.points.map((point, k) => ({
						x: point[0],
						y: point[1],
						z: point[2],
						radius: radius[k] as number,
					})),
				});
				for (const carried of grown.carries)
					drafts[carried.draft] = {
						...(drafts[carried.draft] as Draft),
						radius: radius[carried.node] as number,
					};
			});
			rankInto(patchIndex.get(patch) as number, drafts);
		};
		const armFrom = (arm: ConiferArm): ConiferNode => limb.nodes[arm.node] as ConiferNode;
		if (filled)
			// One patch a limb: the limb's run under it and every arm carry its twigs.
			fill(
				limb.patch,
				onShell
					? []
					: [
							endOf(limb.nodes, -1, trunkFrom),
							...limb.arms.map((arm, a) => endOf(arm.nodes, a, armFrom(arm))),
						],
				[
					{ arm: -1, nodes: limb.nodes, whole: false },
					...limb.arms.map((arm, a) => ({ arm: a, nodes: arm.nodes, whole: true })),
				],
			);
		else {
			// A patch on each end: the end runs on into its own piece, and the rest of the patch
			// fills from that end's own wood.
			fill(
				limb.patch,
				[endOf(limb.nodes, -1, trunkFrom, true)],
				[{ arm: -1, nodes: limb.nodes, whole: false }],
			);
			limb.arms.forEach((arm, a) => {
				if (arm.patch)
					fill(
						arm.patch,
						[endOf(arm.nodes, a, armFrom(arm), true)],
						[{ arm: a, nodes: arm.nodes, whole: false }],
					);
			});
		}
	});
	// One order across the plant. Every end comes first. Each other socket then stands at its share
	// of its own patch's order, so the sockets below any rank are the same share of every patch,
	// spread over each.
	const keyed = ordered.flatMap(({ patch, drafts, ends }) =>
		drafts.map((draft, i) => ({
			draft,
			patch,
			key: i < ends ? -1 : (i - ends + 0.5) / Math.max(1, drafts.length - ends),
		})),
	);
	keyed
		.map((entry, i) => ({ entry, i }))
		.sort((a, b) => a.entry.key - b.entry.key || a.i - b.i)
		.forEach(({ entry }, rank) => {
			const { end: _end, ...socket } = entry.draft;
			const choice =
				choices.length > 0
					? choices[
							Math.min(choices.length - 1, Math.floor(draw(PIECE_DRAW, rank) * choices.length))
						]
					: undefined;
			sockets.push({
				...socket,
				patch: entry.patch,
				rank,
				...(choice !== undefined && choice >= 0 ? { piece: choice } : {}),
			});
		});
	// The sockets stand in their patches' order, as the bud sites are written.
	sockets.sort((a, b) => a.patch - b.patch || a.rank - b.rank);
	return { twigs, sockets };
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
	// The generator scales the grown plant so its drawn top stands at the record's height, so the
	// frame is built to the same draw and its proportions hold through that scale.
	const height = spreadAt(record.size.height, draw(Purpose.Height));
	const radiusAt = (y: number): number => (curveAt(g.trunk.width, y / height) * height) / 2;
	const levels = g.limbs.levels;
	const perLevel = limbsPerLevel(g.limbs.count, levels.length);
	const dividesAt = clamp(g.trunk.dividesAt, 0.05, 1);
	// A trunk that runs to the tip ends inside a patch of its own, whose top is the plant's height,
	// so the leader does not end bare.
	const tipWidth = dividesAt >= 1 ? g.patch.width[1] * height : 0;
	const tipDepth = tipWidth * g.patch.depth;
	const trunkTop = dividesAt * height - tipDepth / 2;

	// The limbs' places round the trunk and up it. Each level stands its limbs evenly and turns on
	// from the level below by the golden share of its own spacing, so no limb stands over another
	// and the levels together fill every direction.
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
				(((k * GOLDEN) / 360) % 1) * (360 / count) +
				(slot * 360) / count +
				(draw(Purpose.Jitter, k, slot) * 2 - 1) * g.limbs.jitter;
			seats.push({ level: k, slot, y, azimuth });
		}
	});

	/** The crown's reach in metres at a height, on its wide side. */
	const levelReach = (y: number): number => curveAt(g.limbs.reach, y / height) * height;
	/**
	 * A patch's width across its limb and its length along it, in metres. Its width is the record's
	 * for its limb's place in the length order. Where the record says how much of a limb's reach
	 * its patch lies along, a limb on the trunk carries a patch of that length, no wider than it is
	 * long. Any other patch is round and takes no more than a share of its limb's reach: a top
	 * limb's runs in nearly to the trunk's line, so the top limbs' patches close the crown's top.
	 */
	const patchSize = (
		place: number,
		reach: number,
		most: number,
		lies: boolean,
	): { width: number; length: number } => {
		const wide = (g.patch.width[0] + (g.patch.width[1] - g.patch.width[0]) * place) * height;
		if (lies && g.patch.along !== undefined) {
			const length = g.patch.along * reach;
			return { width: Math.min(wide, length), length };
		}
		const width = Math.min(wide, most * reach);
		return { width, length: width };
	};

	// The top limbs carry on where the trunk divides, evenly round it, the first near the plan's wide
	// side. Each further one reaches a little less.
	const topCount = g.top && dividesAt < 1 ? Math.max(1, Math.round(g.top.limbs)) : 0;
	const topStart = g.limbs.plan.turn + (draw(Purpose.TopTurn) * 2 - 1) * g.limbs.jitter;
	// The first carries on as the leader where the record says so: it reaches a share as far, and
	// its patch stands over the trunk's line.
	const leader = g.top?.leader;
	const tops = Array.from({ length: topCount }, (_, slot) => ({
		slot,
		azimuth: topStart + (slot * 360) / topCount,
		place: 1 - slot / (2 * topCount),
		span:
			levelReach(trunkTop) *
			(slot === 0 && leader !== undefined ? leader : 1 - (TOP_SHORTER * slot) / topCount),
		most: slot === 0 && leader !== undefined ? PATCH_MOST_LEADER : PATCH_MOST_TOP,
		lies: false,
	}));

	// Each limb's place in the length order, longest first. The two longest are the pair of seats on
	// different levels that stand most nearly opposite, where the crown reaches far; the whole plant
	// turns so that the pair lies along the plan's wide side. The next two take the free seats
	// nearest the plan's narrow sides. Each further limb takes the free seat that leaves the foliage
	// most evenly shared round the trunk and up it, counted in sectors with the top limbs' foliage
	// and by level, so no side of the crown and no height of it stands empty.
	const places = seats.map((_, i) => (seats.length > 1 ? i / (seats.length - 1) : 1));
	const placeOf = new Array<number>(seats.length).fill(-1);
	// The short limbs, whose share of the crown's reach lies nearer the shortest limb's than the
	// longest's, are shared over the levels by their seats as evenly as whole numbers allow, and a
	// long limb leaves free the seats its level keeps for them, so no level holds two short limbs
	// while another holds none.
	const midShare = (curveAt(g.limbs.reachShare, 0) + curveAt(g.limbs.reachShare, 1)) / 2;
	const isShort = (place: number): boolean => curveAt(g.limbs.reachShare, place) < midShare;
	const shorts = places.filter(isShort).length;
	// Each level's fair share of the short limbs, then whole numbers by the largest remainders.
	const fair = perLevel.map((count) => (shorts * count) / Math.max(1, seats.length));
	const quota = fair.map(Math.floor);
	for (let left = shorts - quota.reduce((sum, q) => sum + q, 0); left > 0; left--) {
		let most = 0;
		for (let k = 1; k < quota.length; k++)
			if (
				(fair[k] as number) - (quota[k] as number) >
				(fair[most] as number) - (quota[most] as number)
			)
				most = k;
		(quota[most] as number)++;
	}
	const shortsAt = new Array<number>(levels.length).fill(0);
	const freeAt = [...perLevel];
	/** Whether a limb of a place may take a seat and still leave its level's seats for its short limbs. */
	const fits = (i: number, place: number): boolean => {
		const level = (seats[i] as Seat).level;
		const owed = (quota[level] as number) - (shortsAt[level] as number);
		return isShort(place) ? owed > 0 : (freeAt[level] as number) - 1 >= owed;
	};
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
			if (first.level === second.level || !fits(a, 1) || !fits(b, 1)) continue;
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
	const sectors = new Array<number>(SECTORS).fill(0);
	const byLevel = new Array<number>(levels.length).fill(0);
	/**
	 * Adds one limb's foliage to the sectors its patch spans as seen from the trunk and to its
	 * level, and gives how unevenly the foliage then stands: the spread of the sectors about their
	 * mean and the spread of the levels about theirs, each as a share of its mean, squared. A sector
	 * counts a patch by its plan area. A level counts a limb by the square of its reach as a share
	 * of the crown's at its height, so a level high or low in the crown counts the same as one at
	 * its widest. A top limb has no level. With `keep` false nothing is added.
	 */
	const share = (
		azimuth: number,
		reach: number,
		place: number,
		most: number,
		level: number,
		keep: boolean,
	): number => {
		const { width, length } = patchSize(place, reach, most, level >= 0);
		const half = (atan2(width / 2, Math.max(1e-6, reach - length / 2)) * 180) / PI;
		const added = new Array<number>(SECTORS).fill(0);
		for (let k = 0; k < SECTOR_SAMPLES; k++) {
			const at = azimuth - half + ((k + 0.5) / SECTOR_SAMPLES) * 2 * half;
			const sector = Math.floor(((((at % 360) + 360) % 360) / 360) * SECTORS) % SECTORS;
			(added[sector] as number) += (width * length) / SECTOR_SAMPLES;
		}
		const long =
			reach / Math.max(1e-6, levelReach(level < 0 ? trunkTop : height * (levels[level] as number)));
		const uneven = (held: number[], extra: (k: number) => number): number => {
			let sum = 0;
			let squares = 0;
			for (let k = 0; k < held.length; k++) {
				const now = (held[k] as number) + extra(k);
				sum += now;
				squares += now * now;
				if (keep) held[k] = now;
			}
			return sum > 0 ? (squares * held.length) / (sum * sum) - 1 : 0;
		};
		return (
			uneven(sectors, (k) => added[k] as number) +
			uneven(byLevel, (k) => (k === level ? long * long : 0))
		);
	};
	const seatLimb = (i: number, n: number): void => {
		const seat = seats[i] as Seat;
		const place = places[n] as number;
		share(
			seat.azimuth,
			curveAt(g.limbs.reachShare, place) * levelReach(seat.y),
			place,
			PATCH_MOST,
			seat.level,
			true,
		);
		placeOf[i] = place;
		(freeAt[seat.level] as number)--;
		if (isShort(place)) (shortsAt[seat.level] as number)++;
	};
	for (const limb of tops) share(limb.azimuth, limb.span, limb.place, limb.most, -1, true);
	let n = seats.length - 1;
	seatLimb(longest, n--);
	if (second >= 0) seatLimb(second, n--);
	const narrowFirst = draw(Purpose.Narrow) < 0.5 ? 90 : 270;
	for (; n >= 0; n--) {
		const place = places[n] as number;
		const great = seats.length - 1 - n;
		const side =
			great < GREAT_LIMBS
				? g.limbs.plan.turn + (great === 2 ? narrowFirst : 360 - narrowFirst)
				: undefined;
		let best = -1;
		let bestScore = Number.POSITIVE_INFINITY;
		// A free seat that keeps its level's short seats, or any free seat where none does.
		const anyFits = seats.some((_, i) => (placeOf[i] as number) < 0 && fits(i, place));
		for (let i = 0; i < seats.length; i++) {
			if ((placeOf[i] as number) >= 0 || (anyFits && !fits(i, place))) continue;
			const seat = seats[i] as Seat;
			let score: number;
			if (side === undefined)
				score = share(
					seat.azimuth,
					curveAt(g.limbs.reachShare, place) * levelReach(seat.y),
					place,
					PATCH_MOST,
					seat.level,
					false,
				);
			else score = apart(seat.azimuth, side) + 180 * lacks(seat);
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

	// The crown's plan. Every limb's reach is stretched by its direction, none along the wide side
	// and by one factor across it, and that factor is found so that the built crown's narrow side is
	// the record's share of its wide side, measured over the patches' far edges.
	const spans = [
		...seats.map((seat, i) => ({
			azimuth: seat.azimuth,
			place: placeOf[i] as number,
			span: curveAt(g.limbs.reachShare, placeOf[i] as number) * levelReach(seat.y),
			most: PATCH_MOST,
			lies: true,
		})),
		...tops,
	];
	const narrow = clamp(g.limbs.plan.narrow, 0.5, 1);
	let across = 1;
	const stretch = (azimuth: number): number => {
		const off = radians(azimuth - g.limbs.plan.turn);
		const c = cos(off);
		const side = sin(off) * across;
		return Math.sqrt(c * c + side * side);
	};
	/** The crown's width along the wide side (0) or across it (90): the patches' far edges. */
	const planWidth = (quarter: number): number => {
		let low = 0;
		let high = 0;
		for (const limb of spans) {
			const reach = limb.span * stretch(limb.azimuth);
			const { width, length } = patchSize(limb.place, reach, limb.most, limb.lies);
			// The patch's far edges that way: its middle, and its half length and half width as
			// they show from there.
			const off = radians(limb.azimuth - g.limbs.plan.turn - quarter);
			const at = (reach - length / 2) * cos(off);
			const edge = Math.sqrt(
				(length / 2) * cos(off) * ((length / 2) * cos(off)) +
					(width / 2) * sin(off) * ((width / 2) * sin(off)),
			);
			low = Math.min(low, at - edge);
			high = Math.max(high, at + edge);
		}
		return high - low;
	};
	// A shell's outline is the crown's reach by height, so its narrow side is the record's share
	// of its wide side as it stands.
	const onShell = g.patch.kind === 'shell';
	if (onShell) across = narrow;
	else
		for (let pass = 0; pass < PLAN_PASSES; pass++) {
			const wide = planWidth(0);
			const cross = planWidth(90);
			if (!(wide > 0 && cross > 0)) break;
			across = clamp((across * narrow * wide) / cross, 0.5, 2);
		}
	// A shell stands from the lowest height its outline names to the highest, and each limb runs on
	// until it stands a piece's length inside it.
	const [shellFoot, shellTop] = curveBounds(g.limbs.reach);
	const shellFrom = shellFoot * height;
	const shellTo = shellTop * height;
	/** The shell's metres from the trunk's line at a height, toward a direction in radians. */
	const outline = (y: number, azimuth: number): number =>
		y < shellFrom || y > shellTo ? 0 : levelReach(y) * stretch((azimuth * 180) / PI);
	const socketPiece = record.pieces?.find((piece) => piece.name === socketPieceNames(g)[0]);
	const pieceLength = socketPiece ? spreadMean(socketPiece.stem.length) : 0;
	let outlineMost = 0;
	for (let k = 0; k <= SHELL_STEPS; k++)
		outlineMost = Math.max(
			outlineMost,
			levelReach(shellFrom + ((shellTo - shellFrom) * k) / SHELL_STEPS),
		);
	/**
	 * How far a limb's course runs out to stand its share of the way to a piece's length inside the
	 * shell, at the height its end reaches, and the shell's reach there.
	 */
	const shellOut = (
		courseOf: (out: number) => Course,
		share: number,
		azimuth: number,
	): { out: number; reach: number } => {
		const toward = radians(azimuth);
		let low = 0;
		let high = outlineMost;
		for (let pass = 0; pass < SHELL_PASSES; pass++) {
			const mid = (low + high) / 2;
			const walked = coursePath(courseOf(mid));
			const endY = (walked.points[walked.points.length - 1] as Vector3)[1];
			const wants = share * shellInside(outline(endY, toward), pieceLength);
			if (mid > wants) high = mid;
			else low = mid;
		}
		const walked = coursePath(courseOf(low));
		const endY = (walked.points[walked.points.length - 1] as Vector3)[1];
		return { out: low, reach: Math.max(low, outline(endY, toward)) };
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
		span: number,
		baseRatio: number,
		lifts: { leave: number; run: number; end: number },
		most: number,
		lower?: number,
	): void => {
		const node = trunkNodeAt(y);
		const start = trunk[node] as ConiferNode;
		const courseOf = (out: number): Course => ({
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
		});
		// On a shell the limb takes its share of the crown's reach at its own height, and its patch
		// reaches out to the shell where its end stands.
		const inShell = onShell
			? shellOut(courseOf, span / Math.max(1e-6, levelReach(y)), azimuth)
			: undefined;
		const reach = inShell?.reach ?? Math.max(start.radius * 2, span * stretch(azimuth));
		const { width, length } = patchSize(place, reach, most, !top);
		const depth = width * g.patch.depth;
		// Under one patch a limb, the wood runs on past the patch's middle. With a patch at each end,
		// the limb stops at the middle of its own.
		const perEnd = g.patch.each === 'end';
		const course = courseOf(
			inShell?.out ?? (perEnd ? reach - width / 2 : reach - length * (1 - UNDER_PATCH)),
		);
		// A patch's floor passes through its limb's end. It falls with the limb where the limb falls
		// under it, from where the limb comes under the patch to its end, and is level where the
		// limb rises or carries a patch on each end. The patch lies along the straight way between
		// those two places.
		const floorOf = (walked: Path): { slope: number; middle: number; lies: Vector3 } => {
			const last = walked.points[walked.points.length - 1] as Vector3;
			if (perEnd || onShell || lower !== undefined)
				return { slope: 0, middle: last[1], lies: walked.heading };
			const span = length * UNDER_PATCH;
			let at = walked.points.length - 1;
			while (at > 0 && walked.length - (walked.along[at - 1] as number) <= span) at--;
			const near = walked.points[at] as Vector3;
			const run = Math.sqrt(
				(last[0] - near[0]) * (last[0] - near[0]) + (last[2] - near[2]) * (last[2] - near[2]),
			);
			if (run < 1e-6) return { slope: 0, middle: last[1], lies: walked.heading };
			const slope = Math.min(0, (last[1] - near[1]) / run);
			return {
				slope,
				middle: last[1] - slope * (span - length / 2),
				lies: [(last[0] - near[0]) / run, 0, (last[2] - near[2]) / run],
			};
		};
		/** The height of a patch's top over its floor's middle: a dome on a sloped floor stands higher. */
		const rise = (slope: number): number =>
			Math.sqrt(depth * depth + ((slope * length) / 2) * ((slope * length) / 2));
		const topOf = (walked: Path): number => {
			const floor = floorOf(walked);
			return perEnd ? floor.middle + depth / 2 : floor.middle + rise(floor.slope);
		};
		// A top limb ends where its patch's top stands at the plant's height, less its own step down.
		// Any other limb whose patch would stand above the plant's height reaches less far, which
		// rounds the crown's top.
		let path =
			lower === undefined
				? coursePath(course)
				: courseTo(course, height - depth * (1 + TOP_STEP * lower));
		if (lower === undefined && !onShell && topOf(path) > height) {
			let low = course.out * REACH_LEAST;
			let high = course.out;
			for (let pass = 0; pass < 12; pass++) {
				const mid = (low + high) / 2;
				if (topOf(coursePath({ ...course, out: mid })) > height) high = mid;
				else low = mid;
			}
			path = coursePath({ ...course, out: low });
		}
		const floor = floorOf(path);
		// The radius beside the trunk is the record's ratio of the trunk's; the swelling fades over
		// the collar's distance, and the limb then thins evenly to the record's share where its
		// patch begins. Under the patch its arms and twigs take its wood, and it thins on to its
		// end. A top limb is the trunk divided, so it has no collar.
		const beside = Math.max(1e-4, baseRatio * start.radius);
		const swell = top ? 1 : Math.max(1, g.limbs.collar.swell);
		const collar = Math.max(1e-6, g.limbs.collar.over * height);
		const past = beside / swell;
		const taper = clamp(g.limbs.taper, 0.05, 1);
		const bare = Math.max(1e-6, path.length - (perEnd || onShell ? 0 : length * UNDER_PATCH));
		const nodes: ConiferNode[] = path.points.map((point, k) => {
			const s = path.along[k] as number;
			const fade = 1 + (swell - 1) * (1 - eased(s / collar));
			const thin =
				s <= bare
					? 1 - (1 - taper) * (s / bare)
					: taper * (1 - (1 - LIMB_END) * ((s - bare) / Math.max(1e-6, path.length - bare)));
			return { x: point[0], y: point[1], z: point[2], radius: Math.max(1e-4, past * fade * thin) };
		});
		const end = path.points[path.points.length - 1] as Vector3;
		// The arms leave to one side and the other in turn, level, each from its own node, so the
		// wood spreads under the whole patch and no two arms part from one point.
		const arms: ConiferArm[] = [];
		const count = Math.max(0, Math.round(g.limbs.arms.count));
		const under = perEnd || onShell ? path.length * ARMS_OVER : length * UNDER_PATCH;
		const patchAt = (
			centre: Vector3,
			heading: Vector3,
			begins: number,
			slope = 0,
		): ConiferPatch => ({
			kind: g.patch.kind,
			limb: limbs.length,
			centre,
			begins,
			length,
			width,
			depth,
			slope,
			along: heading,
		});
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
			// An arm runs no steeper than a stated lift, however steeply its limb hooks up there, and
			// lower still where its own patch would stand above the plant's height.
			const armCourse = (lift: number, out = width * (perEnd ? ARM_APART : ARM_REACH)): Path =>
				coursePath({
					from: here,
					azimuth: flat + side * radians(g.limbs.arms.angle),
					leave: lift,
					run: lift,
					end: lift,
					out,
					riseOver: 0,
					endOver: 0,
					wander: g.limbs.wander,
					wave: WANDER_WAVE * height,
					phase: draw(Purpose.ArmWander, level, slot * 16 + k) * 2 * PI,
				});
			// On a shell the arms rise beside their limb.
			let armLift = onShell ? rise : clamp(rise, -ARM_LIFT_MOST, ARM_LIFT_MOST);
			let armPath = armCourse(armLift);
			// Under one patch a limb, an arm that would end past the patch's rim reaches less far.
			if (!perEnd && !onShell) {
				const middle: readonly [number, number] = [
					end[0] - floor.lies[0] * (under - length / 2),
					end[2] - floor.lies[2] * (under - length / 2),
				];
				let reachOut = width * ARM_REACH;
				for (let pass = 0; pass < 8; pass++) {
					const tip = armPath.points[armPath.points.length - 1] as Vector3;
					// Where the arm's end lies in the patch, along it and across it, as shares of its
					// half length and half width.
					const u =
						((tip[0] - middle[0]) * floor.lies[0] + (tip[2] - middle[1]) * floor.lies[2]) /
						(length / 2);
					const v =
						((tip[2] - middle[1]) * floor.lies[0] - (tip[0] - middle[0]) * floor.lies[2]) /
						(width / 2);
					if (u * u + v * v <= ARM_INSIDE * ARM_INSIDE) break;
					reachOut *= 0.85;
					armPath = armCourse(armLift, reachOut);
				}
			}
			for (let pass = 0; pass < 8 && perEnd; pass++) {
				const armTop = (armPath.points[armPath.points.length - 1] as Vector3)[1] + depth / 2;
				if (armTop <= height) break;
				armLift -= ARM_LIFT_STEP;
				armPath = armCourse(armLift);
			}
			const foot = (nodes[at] as ConiferNode).radius * g.limbs.arms.radius;
			const armEnd = armPath.points[armPath.points.length - 1] as Vector3;
			arms.push({
				node: at,
				...(perEnd ? { patch: patchAt(armEnd, armPath.heading, 0) } : {}),
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
			patch:
				perEnd || onShell
					? patchAt([end[0], end[1], end[2]], path.heading, reach - width)
					: patchAt(
							[
								end[0] - floor.lies[0] * (under - length / 2),
								floor.middle + depth / 2,
								end[2] - floor.lies[2] * (under - length / 2),
							],
							floor.lies,
							reach - length,
							floor.slope,
						),
		});
	};

	seats.forEach((seat, i) => {
		const place = placeOf[i] as number;
		const at = seat.y / height;
		// A limb is as thick for its trunk as it is long for its level: its reach share's place
		// between the shortest limb's and the longest's.
		const shortest = curveAt(g.limbs.reachShare, 0);
		const long = clamp(
			(curveAt(g.limbs.reachShare, place) - shortest) / Math.max(1e-6, 1 - shortest),
			0,
			1,
		);
		addLimb(
			seat.level,
			seat.slot,
			false,
			seat.y,
			seat.azimuth,
			place,
			curveAt(g.limbs.reachShare, place) * levelReach(seat.y),
			g.limbs.radius[0] + (g.limbs.radius[1] - g.limbs.radius[0]) * long,
			{
				leave: curveAt(g.limbs.leave, at),
				run: curveAt(g.limbs.run, at),
				end: curveAt(g.limbs.end, at),
			},
			PATCH_MOST,
		);
	});

	// The first top limb's patch tops out at the plant's height, and each further one stands a step
	// lower, so the top is a stack of plates.
	let top = trunkTop;
	if (g.top)
		for (const limb of tops)
			addLimb(
				levels.length,
				limb.slot,
				true,
				trunkTop,
				limb.azimuth,
				limb.place,
				limb.span,
				g.top.radius,
				{ leave: g.top.leave, run: g.top.leave / 2, end: g.top.end },
				limb.most,
				limb.slot,
			);
	const tip = trunk[trunk.length - 1] as ConiferNode;
	const patches: ConiferPatch[] = [
		...(tipWidth > 0
			? [
					{
						kind: g.patch.kind,
						limb: -1,
						centre: [tip.x, tip.y, tip.z] as Vector3,
						begins: 0,
						length: tipWidth,
						width: tipWidth,
						depth: tipDepth,
						slope: 0,
						along: [1, 0, 0] as Vector3,
					},
				]
			: []),
		...limbs.map((limb) => limb.patch),
		...limbs.flatMap((limb) => limb.arms.flatMap((arm) => (arm.patch ? [arm.patch] : []))),
	];
	let crownBase = height;
	for (const patch of patches) {
		const fall = (Math.abs(patch.slope) * patch.length) / 2;
		top = Math.max(
			top,
			patch.slope === 0
				? patch.centre[1] + patch.depth / 2
				: patch.centre[1] - patch.depth / 2 + Math.sqrt(patch.depth * patch.depth + fall * fall),
		);
		crownBase = Math.min(crownBase, patch.centre[1] - patch.depth / 2 - fall);
	}
	const rule = g.patch.sockets;
	const shell =
		onShell && rule
			? clumpShell(
					shellPlaces({
						outline,
						lineAt,
						from: shellFrom,
						to: shellTo,
						pitch: Math.max(0.05, rule.pitch),
						rise: Math.max(0.05, rule.rise ?? rule.pitch),
						lean: rule.lift,
						inset: pieceLength * SHELL_FACE,
						length: pieceLength,
						turn: draw(Purpose.ShellTurn) * 2 * PI,
						draw: (row, place) => draw(Purpose.ShellPlace, row, place),
					}),
					rule.clump,
				)
			: [];
	// A shell's foliage stands from its foot to its top.
	if (shell.length > 0) {
		crownBase = Math.min(crownBase, shellFrom);
		top = Math.max(top, shellTo);
	}
	const { twigs, sockets } = socketsOf(record, limbs, patches, trunk, shell, (limb, carrier) =>
		draw(Purpose.TwigSide, limb, carrier),
	);
	// The inner body: a round body on the trunk's line, in steps of the trunk's own, its radius
	// the record's share of the height at each height.
	const body: ConiferNode[] = [];
	if (g.body) {
		const [foot, crown] = curveBounds(g.body.radius);
		const from = foot * height;
		const to = crown * height;
		const steps = Math.max(2, Math.ceil((to - from) / TRUNK_STEP));
		for (let k = 0; k <= steps; k++) {
			const y = from + ((to - from) * k) / steps;
			const [x, z] = lineAt(y);
			body.push({ x, y, z, radius: Math.max(1e-4, curveAt(g.body.radius, y / height) * height) });
		}
	}
	return {
		height: top,
		trunk,
		limbs,
		patches,
		twigs,
		sockets,
		perLevel,
		body,
		crownBase: Math.max(0, crownBase),
	};
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
	// The skeleton's nodes and axis of each limb, of each of its arms and of each twig.
	const limbAt: { axis: number; nodes: number[]; arms: { axis: number; nodes: number[] }[] }[] = [];
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
		const armsAt: { axis: number; nodes: number[] }[] = [];
		limbAt.push({ axis, nodes: limbNodes, arms: armsAt });
		limb.arms.forEach((arm, k) => {
			const armNodes: number[] = [];
			const armAxis = builder.addAxis({
				parent: axis,
				parentNode: limbNodes[arm.node] as number,
				order: 2,
				kind: AXIS_LIMB,
				barkV: runs[arm.node] as number,
				barkU: k % 2 === 0 ? 0 : PI,
			});
			let armLast = limbNodes[arm.node] as number;
			for (const node of arm.nodes) {
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
				armNodes.push(armLast);
			}
			armsAt.push({ axis: armAxis, nodes: armNodes });
		});
	}
	// The inner body is wood of its own, joined to nothing: far thicker than the trunk it stands
	// round, it would otherwise meet the trunk as a fork. Every card level keeps it.
	if (plan.body.length > 1) {
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 1, kind: AXIS_LIMB });
		let last = -1;
		for (const node of plan.body)
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius,
				parent: last,
				axis,
				light: 0,
				age: ageAt(node.y),
			});
	}
	// A twig leaves a limb, an arm or an earlier twig. Its order names its kind of wood: a twig, or
	// a twig that leaves a twig.
	const twigAt: { axis: number; nodes: number[]; order: number }[] = [];
	for (const twig of plan.twigs) {
		const limb = limbAt[twig.limb] as (typeof limbAt)[number];
		const parent = twigAt[twig.twig];
		const carrier =
			parent ?? (twig.arm < 0 ? limb : (limb.arms[twig.arm] as (typeof limb.arms)[number]));
		const parentNode = carrier.nodes[twig.node] as number;
		const order = parent ? parent.order + 1 : TWIG_ORDER;
		const axis = builder.addAxis({
			parent: carrier.axis,
			parentNode,
			order,
			kind: AXIS_LIMB,
		});
		const nodes: number[] = [];
		let last = parentNode;
		for (const node of twig.nodes) {
			last = builder.addNode({
				x: node.x,
				y: node.y,
				z: node.z,
				radius: node.radius,
				parent: last,
				axis,
				light: 1,
				age: 0,
			});
			nodes.push(last);
		}
		twigAt.push({ axis, nodes, order });
	}
	// Each socket is a bud site: its frame runs along its wood, its sky side up.
	const frame = [0, 0, 0, 1];
	for (const socket of plan.sockets) {
		const limb = socket.limb >= 0 ? (limbAt[socket.limb] as (typeof limbAt)[number]) : undefined;
		const wood =
			socket.twig >= 0
				? (twigAt[socket.twig] as (typeof twigAt)[number])
				: !limb
					? { axis: stem, nodes: trunkNodes }
					: socket.arm < 0
						? limb
						: (limb.arms[socket.arm] as (typeof limb.arms)[number]);
		quatFromFrame(
			socket.heading,
			Math.abs(socket.heading[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0],
			frame,
		);
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
			woodRadius: socket.radius,
			socket: {
				scale: socket.scale,
				rank: socket.rank,
				lobe: socket.patch,
				...(socket.piece !== undefined ? { piece: socket.piece } : {}),
			},
		});
	}
	return builder.finish(plan.crownBase);
}

/** The conifer grower. */
export const grower: Grower = {
	grow: growConifer,
};
