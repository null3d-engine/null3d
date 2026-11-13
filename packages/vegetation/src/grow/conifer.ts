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
import { curveAt, spreadAt, spreadMean } from '../core/types';
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
/** An arm's radius at its end over its radius where it leaves. */
const ARM_TAPER = 0.5;
/** The most degrees an arm runs above or below level, and the step it lowers by under the plant's height. */
const ARM_LIFT_MOST = 20;
const ARM_LIFT_STEP = 10;
/** The least share of its reach that a limb keeps where the plant's height cuts it short. */
const REACH_LEAST = 0.1;
/**
 * The share of its length that a piece rises above its socket: a piece stands on a level socket
 * tilted up, and its foliage ends a little under its tip's height.
 */
const PIECE_RISE = 0.5;
/** The most socket steps one twig runs. */
const TWIG_STEPS_MOST = 5;
/** The least distance between two sockets of one patch, as a share of the pitch. */
const SOCKET_APART = 0.7;
/** A twig's radius where it leaves over its parent's radius there, at most. */
const TWIG_FOOT = 0.6;
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
	TwigSide: 14,
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
	/** The limb it belongs to, by its index in the plan, or -1 for the patch on the trunk's tip. */
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
 * A twig of the frame: a short level branch that leaves the wood under a patch and carries sockets.
 *
 * @category api/vegetation
 */
export interface ConiferTwig {
	/** The limb it belongs to, the arm of that limb it leaves (-1 for the limb itself) and the node. */
	readonly limb: number;
	readonly arm: number;
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
	 * Its rank in its patch, from 0. The sockets below any rank stand spread over the patch, and the
	 * ends of the limb and its arms take the lowest ranks, so a thinned patch keeps its ends clothed.
	 */
	readonly rank: number;
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

/** The reversed bits of an index below a power of two, which spreads a run of ranks evenly. */
function reversedBits(index: number, bits: number): number {
	let out = 0;
	for (let k = 0; k < bits; k++) if (index & (1 << k)) out |= 1 << (bits - 1 - k);
	return out;
}

/**
 * The sockets of a frame and the twigs that carry them. A patch that every end carries holds one
 * socket, on its end. A patch that a limb's arms spread under is filled: a pair of side twigs, one
 * to each side, leaves the limb's run and each arm every pitch, rising at the record's lift, and
 * each twig carries a socket every pitch along it. No two sockets of a patch stand nearer than a
 * share of the pitch, and a twig that would carry none is not grown, so no wood ends bare.
 */
function socketsOf(
	record: Species,
	limbs: readonly ConiferLimb[],
	patches: readonly ConiferPatch[],
	trunk: readonly ConiferNode[],
	draw: (limb: number, carrier: number) => number,
): { twigs: ConiferTwig[]; sockets: ConiferSocket[] } {
	const g = growthOf(record);
	const twigs: ConiferTwig[] = [];
	const sockets: ConiferSocket[] = [];
	const rule = g.patch.sockets;
	if (!rule) return { twigs, sockets };
	const pitch = Math.max(0.05, rule.pitch);
	const lift = radians(clamp(rule.lift, 0, 60));
	// A twig thins to the radius of the piece's own cut end.
	const piece = record.pieces?.find((candidate) => candidate.name === rule.piece);
	const tipRadius = piece?.stem.radius[0] ?? 0.01;
	const filled = g.patch.each === 'limb';
	/** One patch's sockets before their ranks: the ends first. */
	interface Draft extends Omit<ConiferSocket, 'rank' | 'patch'> {
		readonly end: boolean;
	}
	const rankInto = (patch: number, drafts: readonly Draft[]): void => {
		const ends = drafts.filter((draft) => draft.end);
		const rest = drafts.filter((draft) => !draft.end);
		let bits = 0;
		while (1 << bits < rest.length) bits++;
		const order = rest
			.map((draft, i) => ({ draft, key: reversedBits(i, bits) }))
			.sort((a, b) => a.key - b.key);
		[...ends, ...order.map((entry) => entry.draft)].forEach(({ end: _end, ...socket }, rank) => {
			sockets.push({ ...socket, patch, rank });
		});
	};
	const patchIndex = new Map<ConiferPatch, number>();
	patches.forEach((patch, i) => {
		patchIndex.set(patch, i);
	});
	// The patch on the trunk's tip carries one socket, on the tip.
	patches.forEach((patch, i) => {
		if (patch.limb >= 0) return;
		const tip = trunk[trunk.length - 1] as ConiferNode;
		rankInto(i, [
			{
				end: true,
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
		if (!filled) {
			// One socket on each end, each end its own patch: the end runs on into its piece.
			rankInto(patchIndex.get(limb.patch) as number, [endOf(limb.nodes, -1, trunkFrom, true)]);
			limb.arms.forEach((arm, a) => {
				if (!arm.patch) return;
				rankInto(patchIndex.get(arm.patch) as number, [
					endOf(arm.nodes, a, limb.nodes[arm.node] as ConiferNode, true),
				]);
			});
			return;
		}
		const { centre, width } = limb.patch;
		const inside = (x: number, z: number): boolean => {
			const dx = x - centre[0];
			const dz = z - centre[2];
			return dx * dx + dz * dz <= (width / 2) * (width / 2);
		};
		const drafts: Draft[] = [
			endOf(limb.nodes, -1, trunkFrom),
			...limb.arms.map((arm, a) => endOf(arm.nodes, a, limb.nodes[arm.node] as ConiferNode)),
		];
		const clear = (at: Readonly<Vector3>): boolean =>
			drafts.every((draft) => {
				const dx = draft.at[0] - at[0];
				const dy = draft.at[1] - at[1];
				const dz = draft.at[2] - at[2];
				return dx * dx + dy * dy + dz * dz >= pitch * SOCKET_APART * (pitch * SOCKET_APART);
			});
		// The wood that carries twigs: the limb's run under the patch, then each arm.
		const carriers: {
			readonly arm: number;
			readonly nodes: readonly ConiferNode[];
			readonly from: ConiferNode;
			readonly taken: ReadonlySet<number>;
		}[] = [
			{
				arm: -1,
				nodes: limb.nodes,
				from: trunkFrom,
				taken: new Set(limb.arms.map((arm) => arm.node)),
			},
			...limb.arms.map((arm, a) => ({
				arm: a,
				nodes: arm.nodes,
				from: limb.nodes[arm.node] as ConiferNode,
				taken: new Set<number>(),
			})),
		];
		carriers.forEach((carrier, c) => {
			let side = draw(l, c) < 0.5 ? 1 : -1;
			let since = pitch / 2;
			let before = carrier.from;
			// The carrier's own end carries a socket, so its last node grows no twig.
			for (let i = 0; i < carrier.nodes.length - 1; i++) {
				const node = carrier.nodes[i] as ConiferNode;
				since += Math.sqrt(
					(node.x - before.x) * (node.x - before.x) + (node.z - before.z) * (node.z - before.z),
				);
				before = node;
				if (since < pitch || carrier.taken.has(i) || !inside(node.x, node.z)) continue;
				const along = headingAt(carrier.nodes, i, carrier.from);
				since = 0;
				// A pair of twigs leaves each such node, one to each side, as a pine's side branches
				// leave in a ring at a year's end. The side that leads swaps from one node to the next.
				for (const flank of [side, -side]) {
					const turn = flank * radians(rule.twig);
					const dir: Vector3 = [
						along[0] * cos(turn) - along[2] * sin(turn),
						0,
						along[0] * sin(turn) + along[2] * cos(turn),
					];
					// The twig rises at the record's lift toward the patch's rim, in whole steps of a pitch,
					// a few at most, so its sockets stand a pitch apart along it.
					const run = pitch * cos(lift);
					const rise = pitch * sin(lift);
					let steps = 0;
					while (
						steps < TWIG_STEPS_MOST &&
						inside(node.x + dir[0] * run * (steps + 1), node.z + dir[2] * run * (steps + 1))
					)
						steps++;
					const foot = Math.max(tipRadius, Math.min(node.radius * TWIG_FOOT, tipRadius * 2));
					const nodes: ConiferNode[] = [];
					const made: Draft[] = [];
					for (let k = 1; k <= steps; k++) {
						const at: Vector3 = [
							node.x + dir[0] * run * k,
							node.y + rise * k,
							node.z + dir[2] * run * k,
						];
						nodes.push({
							x: at[0],
							y: at[1],
							z: at[2],
							radius: Math.min(node.radius, foot + (tipRadius - foot) * (k / steps)),
						});
						if (!clear(at) || made.some((other) => other.node === k - 1)) continue;
						made.push({
							end: false,
							twig: twigs.length,
							limb: l,
							arm: carrier.arm,
							node: k - 1,
							radius: (nodes[k - 1] as ConiferNode).radius,
							at,
							heading: dir,
						});
					}
					// The twig ends at its last socket, and a twig with none is not grown.
					const last = made[made.length - 1];
					if (!last) continue;
					twigs.push({ limb: l, arm: carrier.arm, node: i, nodes: nodes.slice(0, last.node + 1) });
					drafts.push(...made);
				}
				side = -side;
			}
		});
		rankInto(patchIndex.get(limb.patch) as number, drafts);
	});
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

	/** The crown's reach in metres at a height, on its wide side. */
	const levelReach = (y: number): number => curveAt(g.limbs.reach, y / height) * height;
	/**
	 * A patch's width in metres, from its limb's place in the length order and its reach. A top
	 * limb's patch runs in nearly to the trunk's line, so the top limbs' patches close the crown's top.
	 */
	const patchWidth = (place: number, reach: number, top = false): number =>
		Math.min(
			(g.patch.width[0] + (g.patch.width[1] - g.patch.width[0]) * place) * height,
			(top ? PATCH_MOST_TOP : PATCH_MOST) * reach,
		);

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
		const reach = curveAt(g.limbs.reachShare, places[n] as number) * levelReach(seat.y);
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
				const reach = share * levelReach(seat.y);
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

	// The top limbs carry on where the trunk divides, evenly round it, the first near the plan's wide
	// side. Each further one reaches a little less.
	const topCount = g.top && dividesAt < 1 ? Math.max(1, Math.round(g.top.limbs)) : 0;
	const topStart = g.limbs.plan.turn + (draw(Purpose.TopTurn) * 2 - 1) * g.limbs.jitter;
	const tops = Array.from({ length: topCount }, (_, slot) => ({
		slot,
		azimuth: topStart + (slot * 360) / topCount,
		place: 1 - slot / (2 * topCount),
		span: levelReach(trunkTop) * (1 - (TOP_SHORTER * slot) / topCount),
	}));

	// The crown's plan. Every limb's reach is stretched by its direction, none along the wide side
	// and by one factor across it, and that factor is found so that the built crown's narrow side is
	// the record's share of its wide side, measured over the patches' far edges.
	const spans = [
		...seats.map((seat, i) => ({
			azimuth: seat.azimuth,
			place: placeOf[i] as number,
			span: curveAt(g.limbs.reachShare, placeOf[i] as number) * levelReach(seat.y),
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
			const width = patchWidth(limb.place, reach, 'slot' in limb);
			const at = (reach - width / 2) * cos(radians(limb.azimuth - g.limbs.plan.turn - quarter));
			low = Math.min(low, at - width / 2);
			high = Math.max(high, at + width / 2);
		}
		return high - low;
	};
	for (let pass = 0; pass < PLAN_PASSES; pass++) {
		const wide = planWidth(0);
		const cross = planWidth(90);
		if (!(wide > 0 && cross > 0)) break;
		across = clamp((across * narrow * wide) / cross, 0.5, 2);
	}

	// The most a patch's foliage rises above its wood: its twigs' rise and the rise of the piece on
	// the highest socket. A patch with no sockets is as deep as the record says.
	const socketRule = g.patch.each === 'limb' ? g.patch.sockets : undefined;
	const socketPiece = record.pieces?.find((candidate) => candidate.name === socketRule?.piece);
	const builtRise = socketRule
		? TWIG_STEPS_MOST *
				Math.max(0.05, socketRule.pitch) *
				sin(radians(clamp(socketRule.lift, 0, 60))) +
			(socketPiece ? spreadMean(socketPiece.stem.length) * PIECE_RISE : 0)
		: Number.POSITIVE_INFINITY;

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
		lower?: number,
	): void => {
		const node = trunkNodeAt(y);
		const start = trunk[node] as ConiferNode;
		const reach = Math.max(start.radius * 2, span * stretch(azimuth));
		const width = patchWidth(place, reach, top);
		// A patch is as deep as its foliage builds: the record's share of its width, and no more than
		// its twigs and pieces rise.
		const depth = Math.min(width * g.patch.depth, builtRise);
		// Under one patch a limb, the wood runs on past the patch's middle. With a patch at each end,
		// the limb stops at the middle of its own.
		const perEnd = g.patch.each === 'end';
		const out = perEnd ? reach - width / 2 : reach - width * (1 - UNDER_PATCH);
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
		// Any other limb whose patch would stand above the plant's height reaches less far, which
		// rounds the crown's top.
		const above = perEnd ? depth / 2 : depth;
		let path =
			lower === undefined
				? coursePath(course)
				: courseTo(course, height - depth * (1 + TOP_STEP * lower));
		if (lower === undefined) {
			const topOf = (walked: Path): number =>
				((walked.points[walked.points.length - 1] as Vector3)[1] as number) + above;
			if (topOf(path) > height) {
				let low = course.out * REACH_LEAST;
				let high = course.out;
				for (let pass = 0; pass < 12; pass++) {
					const mid = (low + high) / 2;
					if (topOf(coursePath({ ...course, out: mid })) > height) high = mid;
					else low = mid;
				}
				path = coursePath({ ...course, out: low });
			}
		}
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
		const under = perEnd ? path.length * ARMS_OVER : width * UNDER_PATCH;
		const patchAt = (centre: Vector3, heading: Vector3, begins: number): ConiferPatch => ({
			kind: g.patch.kind,
			limb: limbs.length,
			centre,
			begins,
			width,
			depth,
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
			let armLift = clamp(rise, -ARM_LIFT_MOST, ARM_LIFT_MOST);
			let armPath = armCourse(armLift);
			// Under one patch a limb, an arm that would end past the patch's rim reaches less far.
			if (!perEnd) {
				const middle: readonly [number, number] = [
					end[0] - path.heading[0] * (under - width / 2),
					end[2] - path.heading[2] * (under - width / 2),
				];
				let reachOut = width * ARM_REACH;
				for (let pass = 0; pass < 8; pass++) {
					const tip = armPath.points[armPath.points.length - 1] as Vector3;
					const off = Math.sqrt(
						(tip[0] - middle[0]) * (tip[0] - middle[0]) +
							(tip[2] - middle[1]) * (tip[2] - middle[1]),
					);
					if (off <= (width / 2) * ARM_INSIDE) break;
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
			patch: perEnd
				? patchAt([end[0], end[1], end[2]], path.heading, reach - width)
				: patchAt(
						[
							end[0] - path.heading[0] * (under - width / 2),
							end[1] + depth / 2,
							end[2] - path.heading[2] * (under - width / 2),
						],
						path.heading,
						reach - width,
					),
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
			curveAt(g.limbs.reachShare, place) * levelReach(seat.y),
			g.limbs.radius[0] + (g.limbs.radius[1] - g.limbs.radius[0]) * place,
			{
				leave: curveAt(g.limbs.leave, at),
				run: curveAt(g.limbs.run, at),
				end: curveAt(g.limbs.end, at),
			},
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
						width: tipWidth,
						depth: tipDepth,
						along: [1, 0, 0] as Vector3,
					},
				]
			: []),
		...limbs.map((limb) => limb.patch),
		...limbs.flatMap((limb) => limb.arms.flatMap((arm) => (arm.patch ? [arm.patch] : []))),
	];
	let crownBase = height;
	for (const patch of patches) {
		top = Math.max(top, patch.centre[1] + patch.depth / 2);
		crownBase = Math.min(crownBase, patch.centre[1] - patch.depth / 2);
	}
	const { twigs, sockets } = socketsOf(record, limbs, patches, trunk, (limb, carrier) =>
		draw(Purpose.TwigSide, limb, carrier),
	);
	return {
		height: top,
		trunk,
		limbs,
		patches,
		twigs,
		sockets,
		perLevel,
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
	const twigAt = plan.twigs.map((twig) => {
		const limb = limbAt[twig.limb] as (typeof limbAt)[number];
		const carrier = twig.arm < 0 ? limb : (limb.arms[twig.arm] as (typeof limb.arms)[number]);
		const parentNode = carrier.nodes[twig.node] as number;
		const axis = builder.addAxis({
			parent: carrier.axis,
			parentNode,
			order: twig.arm < 0 ? 2 : 3,
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
		return { axis, nodes };
	});
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
			socket: { scale: 1, rank: socket.rank, lobe: socket.patch },
		});
	}
	return builder.finish(plan.crownBase);
}

/** The conifer grower. */
export const grower: Grower = {
	grow: growConifer,
};
