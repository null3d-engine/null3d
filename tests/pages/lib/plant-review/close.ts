// The close views whose subject is a piece of the crown that the skeleton and the shoot rows name
// directly: a branch across its own run, a twig with its end clusters, a limb's hanging strands and
// a tuft's flowering heads. Each finds its subject in the plant, frames it at the share of the
// picture that its photograph gives it, and stands on the side from which the least of the rest of
// the plant comes between the lens and the subject. The limbs that leave the stem and the places a
// limb divides are read here too, for the subjects that the solved views frame. Everything reads
// only the skeleton, the shoot rows and the shoot prototypes, so it holds for every species.

import { BUD_FLOWER } from '../../../../packages/vegetation/src/core/graph';
import {
	type AxisPoint,
	chainOf,
	cross,
	dot,
	lengthOf,
	mainStem,
	nodeAt,
	normalize,
	pointAlong,
	stemFoot,
	turnedAbout,
	type V3,
} from './anatomy';
import type { MacroSkeleton, ShootPrototype, ShootRows } from './plant-types';
import {
	type Clutter,
	clearest,
	plantSpheres,
	type Shot,
	type SubjectMark,
	type Weighing,
} from './sight';

/** What a close view reads of the grown plant. */
export interface ClosePlant {
	readonly skeleton: MacroSkeleton;
	readonly shoots: ShootRows;
	readonly prototypes: readonly ShootPrototype[];
	/** A leaf's length in metres, when the species' leaves are blades, which sets a twig's frame. */
	readonly leafLength?: number;
	/** 3 per point: the places the plant's foliage cards draw, for a view that frames a fringe. */
	readonly foliage?: Float32Array;
}

/** A close view's camera and what it framed. */
export interface CloseView extends Shot {
	/** Radians the camera turns about its line of sight, the picture turning counterclockwise. */
	readonly roll?: number;
	/** What the view chose and why, for the page's facts. */
	readonly subject: Readonly<Record<string, unknown>>;
	/** The clutter of the chosen frame, when the view weighed its sides. */
	readonly clutter?: Clutter;
}

/** The frame a close view draws: its vertical field of view in degrees and its width over height. */
export interface Lens {
	readonly fov: number;
	readonly aspect: number;
}

const DEG = Math.PI / 180;
/** Degrees a close camera may look down on its subject: the photographs look level or up. */
const LOOK_DOWN = 12;
/** Degrees within which a limb that leaves the stem carries the stem's own line on. */
const LEADER_ANGLE = 45;
/** The least radius of an arm, against its limb's radius at the fork, for a division to be a fork. */
const FORK_ARM = 0.5;
/** The most forks or limbs a view weighs, nearest its sought thickness first. */
const MOST_SUBJECTS = 24;
/** The share of the frame's height that a twig fills from its base to its farthest cluster. */
const TWIG_FILL = 0.85;
/** Leaf lengths that the frame of a twig view spans. */
const TWIG_LEAVES = 4.5;
/** The most twigs a twig view weighs, the best lit first. */
const MOST_TWIGS = 48;
/** The share of the frame left clear round a framed piece. */
const MARGIN = 0.08;

/**
 * How each view weighs a frame, from its photograph: how much of the frame its subject fills, and
 * how plain the ground behind it is. A cut branch and a twig stand before a plain ground.
 */
const WEIGHINGS = {
	branch: { behind: 1, fill: 0.3, short: 1 },
	twig: { behind: 1, fill: 0.45, short: 1 },
} as const satisfies Record<string, Weighing>;

/**
 * The height of a twig view's cameras over their subject, as the angle up from the subject, in
 * degrees: as far as the photograph looks up at its twig or down on it.
 */
const TWIG_RISE = [-30, LOOK_DOWN] as const;

/** A vector turned about the vertical axis by an angle in radians. */
function yawed(v: readonly number[], angle: number): V3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [
		(v[0] as number) * c + (v[2] as number) * s,
		v[1] as number,
		-(v[0] as number) * s + (v[2] as number) * c,
	];
}

/** The point `metres` from `at` along a direction. */
function step(at: readonly number[], direction: readonly number[], metres: number): V3 {
	return [
		(at[0] as number) + (direction[0] as number) * metres,
		(at[1] as number) + (direction[1] as number) * metres,
		(at[2] as number) + (direction[2] as number) * metres,
	];
}

/** The camera distance at which a frame `height` metres tall at the target fills a lens. */
function distanceFor(height: number, fov: number): number {
	return height / 2 / Math.tan((fov * DEG) / 2);
}

/** The direction from node `a` to node `b`. */
function between(skeleton: MacroSkeleton, a: number, b: number): V3 {
	const p = nodeAt(skeleton, a);
	const q = nodeAt(skeleton, b);
	return normalize([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
}

/** A unit vector square to `v`, level where it can be: across a direction's run. */
function across(v: V3): V3 {
	const level = cross([0, 1, 0], v);
	return Math.hypot(...level) > 1e-3 ? normalize(level) : [1, 0, 0];
}

/**
 * An axis's own direction where it leaves its parent: from the junction to the first of its nodes
 * that stands `clear` metres or more away, so the blend into the parent does not set it.
 */
function departure(skeleton: MacroSkeleton, axis: number, clear: number): V3 {
	const chain = chainOf(skeleton, axis);
	const from = nodeAt(skeleton, chain[0] as number);
	for (const n of chain.slice(1)) {
		const p = nodeAt(skeleton, n);
		if (Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) >= clear)
			return normalize([p[0] - from[0], p[1] - from[1], p[2] - from[2]]);
	}
	return between(skeleton, chain[0] as number, chain[chain.length - 1] as number);
}

/** The node that carries an axis on past `node`, or -1 when the axis ends there. */
function nextOnAxis(skeleton: MacroSkeleton, axis: number, node: number): number {
	const first = skeleton.axes.first[axis] as number;
	const last = skeleton.axes.last[axis] as number;
	for (let n = Math.max(first, node + 1); n <= last; n++)
		if ((skeleton.parent[n] as number) === node) return n;
	return -1;
}

/** A mark of the axes in `alone`, and of those in `grown` with every axis that grows from them. */
function markAxes(
	skeleton: MacroSkeleton,
	alone: readonly number[],
	grown: readonly number[] = [],
): Uint8Array {
	const marked = new Uint8Array(skeleton.axes.count);
	for (const a of grown) if (a >= 0) marked[a] = 1;
	// Parents come before their children in the axis table, so one pass carries the mark out.
	if (grown.length > 0)
		for (let a = 0; a < skeleton.axes.count; a++) {
			const parent = skeleton.axes.parent[a] as number;
			if (parent >= 0 && marked[parent] === 1) marked[a] = 1;
		}
	for (const a of alone) if (a >= 0) marked[a] = 1;
	return marked;
}

/** One subject a view may frame, with the cameras it weighs round it. */
interface Subject<T> {
	readonly target: V3;
	/** The direction the camera looks along, from either side. */
	readonly normal: V3;
	/** The axis the cameras turn about, off the normal. */
	readonly spin: V3;
	readonly distance: number;
	/** What counts as the subject in its frame. */
	readonly mark: SubjectMark;
	/** What the view prefers in a camera of this subject, taken off its score. */
	readonly bonus: (shot: Shot) => number;
	/** The sides of the normal the cameras stand on: both by default. */
	readonly sides?: readonly number[];
	readonly facts: T;
}

/**
 * What a camera that looks square to its subject's normal is worth beside a clear frame: the
 * photographs see a limb, a fork or a twig across its run, not end on.
 */
const SQUARE = 0.25;

/** The degrees the cameras round a subject turn about its spin, and tip up or down. */
const TURNS = [0, -25, 25, -50, 50] as const;
const TIPS = [0, -15, 15, -30] as const;

/**
 * The cameras round a subject: on both sides of its normal, turned about its spin and tipped up or
 * down, each standing within `rise` degrees over or under the subject, as its photograph stands.
 */
function shotsRound<T>(
	subject: Subject<T>,
	turns: readonly number[],
	tips: readonly number[],
	rise: readonly [number, number],
): Shot[] {
	const out: Shot[] = [];
	for (const side of subject.sides ?? [1, -1])
		for (const turn of turns)
			for (const tip of tips) {
				const turned = turnedAbout(
					[subject.normal[0] * side, subject.normal[1] * side, subject.normal[2] * side],
					subject.spin,
					turn * DEG,
				);
				const direction = normalize(
					turnedAbout(turned, across(normalize([turned[0], 0, turned[2]])), tip * DEG),
				);
				// The camera's height over the subject, as an angle: up is looking down on it.
				const over = Math.asin(Math.max(-1, Math.min(1, direction[1]))) / DEG;
				if (over < rise[0] || over > rise[1]) continue;
				out.push({
					position: step(subject.target, direction, subject.distance),
					target: subject.target,
				});
			}
	return out;
}

/** The subject and camera that frame the clearest, each subject judged against the plant round it. */
function bestOf<T>(
	plant: ClosePlant,
	subjects: readonly Subject<T>[],
	lens: Lens,
	weighing: Weighing,
	rise: readonly [number, number],
	turns: readonly number[] = TURNS,
	tips: readonly number[] = TIPS,
): { readonly subject: Subject<T>; readonly shot: Shot; readonly clutter: Clutter } | undefined {
	let best:
		| {
				readonly subject: Subject<T>;
				readonly shot: Shot;
				readonly clutter: Clutter;
				readonly score: number;
		  }
		| undefined;
	for (const subject of subjects) {
		const reach = subject.distance * (1 + Math.tan((lens.fov * DEG) / 2) * lens.aspect);
		const spheres = plantSpheres(
			plant.skeleton,
			plant.shoots,
			plant.prototypes,
			subject.target,
			reach,
		);
		const candidates = shotsRound(subject, turns, tips, rise).map((shot) => {
			const back = normalize([
				shot.position[0] - shot.target[0],
				shot.position[1] - shot.target[1],
				shot.position[2] - shot.target[2],
			]);
			return { ...shot, bonus: subject.bonus(shot) + SQUARE * Math.abs(dot(back, subject.normal)) };
		});
		const choice = clearest(candidates, spheres, lens.fov, lens.aspect, subject.mark, weighing);
		if (choice && (!best || choice.score < best.score))
			best = { subject, shot: choice.candidate, clutter: choice.clutter, score: choice.score };
	}
	return best && { subject: best.subject, shot: best.shot, clutter: best.clutter };
}

/** A limb that leaves the main stem: where, the stem's radius and direction there, and its own. */
export interface Departure {
	readonly axis: number;
	readonly at: V3;
	readonly stem: AxisPoint;
	readonly direction: V3;
	readonly radius: number;
	/** Metres the limb runs from where it leaves. */
	readonly length: number;
	/** Degrees between the stem's line and the limb's. */
	readonly angle: number;
}

/**
 * The limbs that leave the main stem, thickest first, and the one among them that carries the
 * stem's own line on past its fork, if one does.
 */
export function departures(skeleton: MacroSkeleton): {
	readonly limbs: Departure[];
	readonly leader?: Departure;
} {
	const stem = mainStem(skeleton);
	if (stem < 0) return { limbs: [] };
	const { axes } = skeleton;
	const list: Departure[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) !== stem) continue;
		const node = axes.parentNode[a] as number;
		if (node < 0) continue;
		const before = skeleton.parent[node] as number;
		const stemDirection = before >= 0 ? between(skeleton, before, node) : ([0, 1, 0] as V3);
		const stemRadius = skeleton.radius[node] as number;
		const radius = skeleton.radius[axes.first[a] as number] as number;
		const direction = departure(skeleton, a, stemRadius + 2 * radius);
		const angle = Math.acos(Math.max(-1, Math.min(1, dot(direction, stemDirection)))) / DEG;
		const at = nodeAt(skeleton, node);
		list.push({
			axis: a,
			at,
			stem: { at, direction: stemDirection, radius: stemRadius },
			direction,
			radius,
			length: lengthOf(skeleton, a),
			angle,
		});
	}
	// The stem runs on into its thickest child near its own line.
	const leader = list.reduce<Departure | undefined>(
		(best, d) => (d.angle < LEADER_ANGLE && (!best || d.radius > best.radius) ? d : best),
		undefined,
	);
	return {
		limbs: list.filter((d) => d !== leader).sort((a, b) => b.radius - a.radius),
		...(leader && { leader }),
	};
}

/** A limb dividing into two arms. */
export interface Fork {
	readonly node: number;
	readonly at: V3;
	/** The limb that divides and the arm that leaves it. */
	readonly limb: number;
	readonly arm: number;
	/** The limb's radius at the fork, and the radius of the arm. */
	readonly radius: number;
	readonly armRadius: number;
	/** The limb's direction into the fork and on past it, and the arm's. */
	readonly into: V3;
	readonly on: V3;
	readonly out: V3;
	/** Metres from the stem's axis to the fork. */
	readonly reach: number;
}

/**
 * The places where a limb divides into two arms of a size: an axis leaves a limb, not the main
 * stem, at no less than `FORK_ARM` of the limb's radius there, and the limb runs on past it.
 */
export function forks(skeleton: MacroSkeleton): Fork[] {
	const stem = mainStem(skeleton);
	const foot = stemFoot(skeleton);
	const { axes } = skeleton;
	const out: Fork[] = [];
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if (parent < 0 || parent === stem) continue;
		const node = axes.parentNode[a] as number;
		if (node < 0) continue;
		const radius = skeleton.radius[node] as number;
		const armRadius = skeleton.radius[axes.first[a] as number] as number;
		if (armRadius < FORK_ARM * radius) continue;
		const next = nextOnAxis(skeleton, parent, node);
		const before = skeleton.parent[node] as number;
		if (next < 0 || before < 0) continue;
		const at = nodeAt(skeleton, node);
		out.push({
			node,
			at,
			limb: parent,
			arm: a,
			radius,
			armRadius,
			into: between(skeleton, before, node),
			on: between(skeleton, node, next),
			out: departure(skeleton, a, 2 * radius),
			reach: Math.hypot(at[0] - foot[0], at[2] - foot[2]),
		});
	}
	return out;
}

/** What a limb view frames: where along the limb, the wood's radius, and the frame's metres. */
export interface LimbFraming {
	/** The share of the way along the limb that the view looks at. */
	readonly share: number;
	/** The radius of the wood it frames, in metres. */
	readonly thin: number;
	/** The metres the frame's height covers. */
	readonly span: number;
	/** The most degrees the camera stands below the limb, looking up at it. */
	readonly lookUp: number;
}

/** A piece of wood a limb view may frame: its axis, the point it looks at, and its reach. */
interface Piece {
	readonly axis: number;
	readonly point: AxisPoint;
	/** Metres from the stem's axis, across the ground. */
	readonly reach: number;
}

/** The pieces of wood whose radius `share` of the way along stands nearest `thin`, furthest first. */
function limbPieces(skeleton: MacroSkeleton, share: number, thin: number): Piece[] {
	const { axes } = skeleton;
	const foot = stemFoot(skeleton);
	const tolerance = Math.max(0.005, thin * 0.25);
	const pieces: Piece[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) < 0) continue;
		const point = pointAlong(skeleton, a, share);
		if (point.at[1] < 0.5 || Math.abs(point.radius - thin) > tolerance) continue;
		pieces.push({
			axis: a,
			point,
			reach: Math.hypot(point.at[0] - foot[0], point.at[2] - foot[2]),
		});
	}
	return pieces.sort((a, b) => b.reach - a.reach);
}

/** The camera distance at which `span` metres fill a lens with a margin, beside wood of a radius. */
function spanDistance(span: number, radius: number, fov: number): number {
	return distanceFor(span / (1 - 2 * MARGIN), fov) + radius;
}

/**
 * The view of a limb seen across its own run: one branch with its side branches and their shoots,
 * against as plain a ground as the plant gives. It takes the pieces of wood whose radius `share` of
 * the way along stands nearest `thin` metres, the furthest from the stem first, and frames `span`
 * metres of each from the side where the least of the rest of the plant stands in front of it.
 */
export function limbView(
	plant: ClosePlant,
	lens: Lens,
	framing: LimbFraming,
): CloseView | undefined {
	const { skeleton } = plant;
	const foot = stemFoot(skeleton);
	const pieces = limbPieces(skeleton, framing.share, framing.thin);
	const outermost = pieces[0]?.reach ?? 1;
	const distance = spanDistance(framing.span, framing.thin, lens.fov);
	// A branch's photograph stands it against a plain ground, which the crown gives in few places,
	// so the view weighs twice as many pieces as the others weigh subjects.
	const subjects: Subject<Piece>[] = pieces.slice(0, MOST_SUBJECTS * 2).map((piece) => ({
		target: piece.point.at,
		normal: across(piece.point.direction),
		spin: piece.point.direction,
		distance,
		mark: { axes: markAxes(skeleton, [], [piece.axis]), shoots: true, band: framing.span / 2 },
		// The outer crown, and a camera outside it, give the plainest ground.
		bonus: (shot: Shot) =>
			0.05 * (piece.reach / outermost) +
			(Math.hypot(shot.position[0] - foot[0], shot.position[2] - foot[2]) > piece.reach ? 0.03 : 0),
		facts: piece,
	}));
	const found = bestOf(plant, subjects, lens, WEIGHINGS.branch, [-framing.lookUp, LOOK_DOWN]);
	if (!found) return undefined;
	const piece = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a branch with its side branches',
			axis: piece.axis,
			radius: piece.point.radius,
			reach: piece.reach,
			height: piece.point.at[1],
			span: framing.span,
		},
	};
}

/** The direction a shoot row grows: its frame's +Y. */
function shootDirection(rows: ShootRows, row: number): V3 {
	const x = rows.rotation[row * 4] as number;
	const y = rows.rotation[row * 4 + 1] as number;
	const z = rows.rotation[row * 4 + 2] as number;
	const w = rows.rotation[row * 4 + 3] as number;
	return normalize([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]);
}

/**
 * The view of a twig with its end clusters. The frame spans a set number of leaf lengths, as the
 * photograph's does, or the plant's middle shoot where its leaves have no length. It takes the
 * best-lit shoots whose length is nearest what the frame holds, and stands across the shoot on the
 * side where nothing stands in front of it and the least stands behind it, so the twig shows
 * against a plain ground.
 */
export function twigView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { shoots: rows, prototypes } = plant;
	if (rows.count === 0) return undefined;
	const shootLength = (row: number) =>
		(prototypes[rows.prototype[row] as number]?.length ?? 0) * (rows.scale[row] as number);
	let height: number;
	if (plant.leafLength !== undefined) height = TWIG_LEAVES * plant.leafLength;
	else {
		const lengths = Array.from({ length: rows.count }, (_, r) => shootLength(r)).sort(
			(a, b) => a - b,
		);
		height = (lengths[Math.floor(lengths.length / 2)] ?? 0.3) / TWIG_FILL;
	}
	const sought = height * TWIG_FILL;
	const misfit = (row: number) => Math.abs(Math.log(shootLength(row) / sought));
	const chosen = Array.from({ length: rows.count }, (_, r) => r)
		.filter((r) => shootLength(r) > 0)
		.sort((a, b) => misfit(a) - misfit(b))
		.slice(0, MOST_TWIGS * 4)
		.sort((a, b) => (rows.sky[b] as number) - (rows.sky[a] as number))
		.slice(0, MOST_TWIGS);
	const distance = distanceFor(height, lens.fov);
	const subjects: Subject<{ readonly row: number; readonly length: number }>[] = chosen.map(
		(row) => {
			const length = shootLength(row);
			const grows = shootDirection(rows, row);
			const base: V3 = [
				rows.position[row * 3] as number,
				rows.position[row * 3 + 1] as number,
				rows.position[row * 3 + 2] as number,
			];
			return {
				target: step(base, grows, length / 2),
				normal: across(grows),
				spin: grows,
				distance,
				mark: { row, band: length * 0.6 },
				bonus: () => 0,
				facts: { row, length },
			};
		},
	);
	const found = bestOf(plant, subjects, lens, WEIGHINGS.twig, TWIG_RISE, [0, -45, 45, 90]);
	if (!found) return undefined;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a twig with its end clusters',
			row: found.subject.facts.row,
			length: found.subject.facts.length,
			frame: height,
		},
	};
}

/** The frame's height that the strands view covers, in metres: a stretch of drooping shoots. */
const STRANDS_SPAN = 1.4;
/** Metres the carrying limb stands above the frame's middle: the top quarter's lower edge. */
const STRANDS_LIMB_ABOVE = STRANDS_SPAN / 4;
/** The mid-crown band, as shares of the crown's own height above its base. */
const STRANDS_BAND = [0.18, 0.45] as const;
/** The fewest hanging shoots a stretch must carry to be the subject. */
const STRANDS_LEAST = 3;
/** Metres about the carrying limb within which a shoot counts as hanging from the stretch. */
const STRANDS_REACH = 0.3;
/** The most metres below the limb a hanging shoot may stand and still be in the frame. */
const STRANDS_BELOW = 1.0;
/** The shares of a carrying limb that the view weighs as the stretch's middle. */
const STRANDS_SHARES = [0.2, 0.35, 0.5, 0.65, 0.8] as const;
/** What one shoot in the sight line beyond the strand costs a stretch's score. */
const STRANDS_OCCLUDED = 1.5;

/** A stretch of limb that carries hanging shoots, as the strands view finds it. */
interface StrandStretch {
	readonly axis: number;
	readonly point: AxisPoint;
	/** Shoots hanging below the limb within the frame. */
	readonly hanging: number;
	/** Shoots standing in the frame's sight line, before or beyond the strand. */
	readonly occluded: number;
}

/**
 * The view of a limb's hanging shoots: a level camera at mid-crown height at the crown's outer rim,
 * framing about a metre and a half of strand with the carrying limb across the top quarter and the
 * sky behind it, as a drooping-twig photograph shows them. It takes the stretches of limb from
 * which several shoots hang free below the limb and along which the least of the crown stands in
 * the frame, and looks outward from just inside the rim, so the strands hang against the sky.
 */
export function strandsView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { skeleton } = plant;
	const tall = skeleton.height - skeleton.crownBase;
	if (tall <= 0) return undefined;
	const low = skeleton.crownBase + tall * STRANDS_BAND[0];
	const high = skeleton.crownBase + tall * STRANDS_BAND[1];
	const p = skeleton.position;
	let radius = 0;
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const y = p[n * 3 + 1] as number;
		if (y < low || y > high) continue;
		radius = Math.max(radius, Math.hypot(p[n * 3] as number, p[n * 3 + 2] as number));
	}
	if (radius <= 0) return undefined;
	const rows = plant.shoots;
	const distance = distanceFor(STRANDS_SPAN, lens.fov);
	const halfHeight = Math.tan((lens.fov * DEG) / 2);
	const halfWidth = halfHeight * lens.aspect;
	// The shoots a frame of this stretch would hold: below the limb as its fringe, and in the sight
	// line either side of the strand, which should stand against the sky.
	const weigh = (point: AxisPoint): { hanging: number; occluded: number } | undefined => {
		const outward = normalize([point.at[0], 0, point.at[2]]);
		if (!Number.isFinite(outward[0])) return undefined;
		const cards = plant.foliage;
		const count = cards ? cards.length / 3 : rows.count;
		const stride = cards ? 12 : 1;
		const at = (i: number, k: number) =>
			(cards ? (cards[i * 3 + k] as number) : (rows.position[i * 3 + k] as number)) -
			(point.at[k] as number);
		let hanging = 0;
		let occluded = 0;
		for (let i = 0; i < count; i += stride) {
			const dx = at(i, 0);
			const dy = at(i, 1);
			const dz = at(i, 2);
			const along = dx * outward[0] + dz * outward[2];
			const lateral = Math.abs(dx * outward[2] - dz * outward[0]);
			if (lateral <= STRANDS_REACH && -dy > 0.05 && -dy <= STRANDS_BELOW) hanging++;
			if (along + distance <= 0) continue;
			const span = along + distance;
			if (Math.abs(dy) > span * halfHeight || lateral > span * halfWidth) continue;
			occluded++;
		}
		return { hanging, occluded };
	};
	let best: StrandStretch | undefined;
	for (let axis = 0; axis < skeleton.axes.count; axis++) {
		for (const share of STRANDS_SHARES) {
			const point = pointAlong(skeleton, axis, share);
			if (point.at[1] < low || point.at[1] > high) continue;
			if (Math.hypot(point.at[0], point.at[2]) < radius * 0.82) continue;
			if (Math.abs(point.direction[1]) > 0.45) continue;
			const weighed = weigh(point);
			if (!weighed || weighed.hanging < STRANDS_LEAST) continue;
			if (
				!best ||
				weighed.hanging - weighed.occluded * STRANDS_OCCLUDED >
					best.hanging - best.occluded * STRANDS_OCCLUDED
			)
				best = { axis, point, hanging: weighed.hanging, occluded: weighed.occluded };
		}
	}
	if (!best) return undefined;
	const outward = normalize([best.point.at[0], 0, best.point.at[2]]);
	if (!Number.isFinite(outward[0])) return undefined;
	const target: V3 = [best.point.at[0], best.point.at[1] - STRANDS_LIMB_ABOVE, best.point.at[2]];
	// The camera stands level at the rim, looking outward past the strand to the sky.
	const position: V3 = [
		target[0] - outward[0] * distance,
		target[1],
		target[2] - outward[2] * distance,
	];
	return {
		position,
		target,
		subject: {
			kind: 'a limb stretch with hanging shoots',
			hanging: best.hanging,
			occluded: best.occluded,
			height: best.point.at[1],
			frame: STRANDS_SPAN,
		},
	};
}

/** Metres the frame of a spike view spans: one stem's hanging heads, as their photograph frames them. */
const SPIKE_SPAN = 0.36;

/**
 * One flowering stem's hanging heads, seen close and level against the plain ground: the cluster of
 * the plant's flower buds nearest its top. A ground plant's spikes hang below their stems' feet, so
 * the frame's middle sits a little under the buds. Undefined when the plant carries no flower.
 */
export function spikeView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { skeleton } = plant;
	const { buds, axes } = skeleton;
	// Group the flower buds by the stem they hang from: a spike hangs on a stalk whose parent axis
	// is the flowering stem, so the stalk's parent names the group.
	const groups = new Map<number, { x: number; y: number; z: number; n: number }>();
	for (let b = 0; b < buds.count; b++) {
		if (buds.kind[b] !== BUD_FLOWER) continue;
		const stalk = buds.axis[b] as number;
		const stem = axes.parent[stalk] as number;
		const key = stem >= 0 ? stem : stalk;
		const group = groups.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
		group.x += buds.position[b * 3] as number;
		group.y += buds.position[b * 3 + 1] as number;
		group.z += buds.position[b * 3 + 2] as number;
		group.n += 1;
		groups.set(key, group);
	}
	// The highest cluster is the one the photograph frames, seen against the sky in its habit.
	let subject: V3 | undefined;
	let top = -Infinity;
	for (const group of groups.values()) {
		const y = group.y / group.n;
		if (y > top) {
			top = y;
			subject = [group.x / group.n, y, group.z / group.n];
		}
	}
	if (!subject) return undefined;
	const target: V3 = [subject[0], subject[1] - SPIKE_SPAN * 0.28, subject[2]];
	const distance = distanceFor(SPIKE_SPAN, lens.fov);
	const outward = normalize([target[0], 0, target[2]]);
	if (!Number.isFinite(outward[0])) return undefined;
	const position: V3 = [
		target[0] + outward[0] * distance,
		target[1],
		target[2] + outward[2] * distance,
	];
	return {
		position,
		target,
		subject: { kind: "a flowering stem's hanging heads", at: subject, frame: SPIKE_SPAN },
	};
}

/** A close view walked round its target by a turn in radians, as a sheet of turns walks round it. */
export function walkedRound(view: CloseView, turn: number): CloseView {
	if (turn === 0) return view;
	const offset = yawed(
		[
			view.position[0] - view.target[0],
			view.position[1] - view.target[1],
			view.position[2] - view.target[2],
		],
		turn,
	);
	return { ...view, position: step(view.target, offset, 1) };
}
